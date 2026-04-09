import json
import shlex
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from starlette.concurrency import run_in_threadpool
from sqlmodel import select

from ...auth.deps import require_permission
from ...db.models import Deployment, DeploymentHistory, Server
from ...db.session import run_db
from ...ssh import ssh_exec

router = APIRouter()
_monitor_cache: dict[str, tuple[float, dict]] = {}
_monitor_cache_ttl_s = 12.0

def _ports_from_inspect(ports_obj) -> str:
    if not isinstance(ports_obj, dict):
        return "-"
    parts = []
    for k, v in ports_obj.items():
        if not v:
            continue
        if isinstance(v, list):
            for it in v:
                hp = (it or {}).get("HostPort")
                hi = (it or {}).get("HostIp")
                if hp:
                    parts.append(f"{hi + ':' if hi else ''}{hp}->{k}")
        else:
            hp = (v or {}).get("HostPort") if isinstance(v, dict) else None
            hi = (v or {}).get("HostIp") if isinstance(v, dict) else None
            if hp:
                parts.append(f"{hi + ':' if hi else ''}{hp}->{k}")
    return ", ".join(parts) if parts else "-"

def _uptime_from_status_text(v: str) -> str | None:
    s = (v or "").strip()
    if not s:
        return None
    idx = s.lower().find("up ")
    if idx < 0:
        return None
    out = s[idx:]
    cut = out.find(" (")
    if cut > 0:
        out = out[:cut]
    return out.strip() or None


def _human_uptime_from_started_at(started_at: str | None) -> str | None:
    raw = (started_at or "").strip()
    if not raw:
        return None
    try:
        ts = raw.replace("Z", "+00:00")
        dt = datetime.fromisoformat(ts)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        sec = int(max(0, (now - dt).total_seconds()))
    except Exception:
        return None
    if sec < 60:
        return f"Up {sec} seconds"
    mins = sec // 60
    if mins < 60:
        return f"Up {mins} minutes"
    hours = mins // 60
    if hours < 48:
        return f"Up {hours} hours"
    days = hours // 24
    return f"Up {days} days"


def _normalize_containers(raw):
    if not isinstance(raw, list) or not raw:
        return raw if isinstance(raw, list) else []
    first = raw[0]
    if isinstance(first, dict) and isinstance(first.get("Config"), dict) and isinstance(first.get("State"), dict):
        out = []
        for it in raw:
            if not isinstance(it, dict):
                continue
            name = str(it.get("Name") or "").lstrip("/") or "-"
            state = str((it.get("State") or {}).get("Status") or "unknown")
            image = str((it.get("Config") or {}).get("Image") or "-")
            ports = _ports_from_inspect((it.get("NetworkSettings") or {}).get("Ports"))
            started_at = str((it.get("State") or {}).get("StartedAt") or "").strip() or None
            uptime = _human_uptime_from_started_at(started_at)
            out.append({"Name": name, "State": state, "Image": image, "Ports": ports, "StartedAt": started_at, "Uptime": uptime})
        return out
    for it in raw:
        if not isinstance(it, dict):
            continue
        if it.get("Uptime"):
            continue
        uptime = None
        for k in ("Status", "status", "RunningFor", "running_for", "Running", "running"):
            if k in it and isinstance(it.get(k), str):
                if k.lower() == "runningfor":
                    uptime = f"Up {it.get(k).strip()}" if it.get(k).strip() else None
                else:
                    uptime = _uptime_from_status_text(it.get(k))
                if uptime:
                    break
        if not uptime and isinstance(it.get("StartedAt"), str):
            uptime = _human_uptime_from_started_at(it.get("StartedAt"))
        if uptime:
            it["Uptime"] = uptime
    return raw


def _parse_compose_ps_output(raw: str):
    s = (raw or "").strip()
    if not s:
        return []
    if s.startswith("["):
        try:
            v = json.loads(s)
            return v if isinstance(v, list) else []
        except Exception:
            return []
    if s.startswith("{"):
        out = []
        for line in s.splitlines():
            line = line.strip()
            if not line:
                continue
            if not line.startswith("{"):
                continue
            try:
                obj = json.loads(line)
                if isinstance(obj, dict):
                    out.append(obj)
            except Exception:
                continue
        return out
    return []

@router.get("/{dep_id}/monitor")
async def monitor_services(dep_id: str, user=Depends(require_permission("monitor:read"))):
    did = uuid.UUID(dep_id)
    now = datetime.utcnow().timestamp()
    cached = _monitor_cache.get(dep_id)
    if cached and now - float(cached[0]) < _monitor_cache_ttl_s:
        return cached[1]


    def _work(session):
        d = session.get(Deployment, did)
        if not d or d.created_by_user_id != user.id:
            raise HTTPException(status_code=404, detail="Deployment not found")
        s = session.get(Server, d.server_id)
        if not s or s.created_by_user_id != user.id:
            raise HTTPException(status_code=404, detail="Server configuration not found")
        if not getattr(s, "ssh_key", None):
            raise HTTPException(status_code=400, detail="Server SSH key not configured")
        ok_hist = session.exec(
            select(DeploymentHistory.id, DeploymentHistory.created_at)
            .where(DeploymentHistory.deployment_id == did)
            .where(DeploymentHistory.status == "success")
            .order_by(DeploymentHistory.created_at.desc())
            .limit(1)
        ).first()
        if not ok_hist:
            raise HTTPException(status_code=409, detail="Please complete the first successful deployment before monitoring")
        dest_dir = (d.dest_dir or "").strip() or s.deploy_path
        hid, deploy_at = ok_hist
        return d, s, dest_dir, hid, deploy_at

    d, s, dest_dir, last_deploy_history_id, last_deploy_at = await run_db(_work)

    dest_q = shlex.quote(dest_dir)
    script = f"""
set +e
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
DEST_DIR={dest_q}
if [ ! -d "$DEST_DIR" ]; then
  echo "DEST_DIR not found: $DEST_DIR" 1>&2
  exit 3
fi
find "$DEST_DIR" -type f \\( -name "docker-compose.yml" -o -name "docker-compose.yaml" \\) -print0 | while IFS= read -r -d '' f; do
  work_dir="$(dirname "$f")"
  echo "##PATH##$work_dir"
  if cd "$work_dir" 2>/dev/null; then
    ids="$(docker compose ps -q 2>/dev/null || true)"
    if [ -n "$ids" ] && command -v docker >/dev/null 2>&1; then
      docker inspect $ids 2>/dev/null || echo "[]"
    else
      ids="$(docker-compose ps -q 2>/dev/null || true)"
      if [ -n "$ids" ] && command -v docker >/dev/null 2>&1; then
        docker inspect $ids 2>/dev/null || echo "[]"
      else
        echo "[]"
      fi
    fi
  else
    echo "[]"
  fi
  echo "##END##"
done
""".strip()

    try:
        code, out, err = await run_in_threadpool(
            ssh_exec, s.address, s.ssh_user or "metalm", s.ssh_key, script, timeout=18.0
        )
    except HTTPException:
        raise
    except Exception as e:
        msg = str(e) if e is not None else ""
        msg = msg.replace("\n", " ").strip()
        if len(msg) > 200:
            msg = msg[:200] + "..."
        detail = f"SSH monitoring failed: {type(e).__name__}" + (f": {msg}" if msg else "")
        raise HTTPException(status_code=502, detail=detail) from e

    if code != 0:
        e = (err or "").strip().replace("\n", " ")
        if len(e) > 220:
            e = e[:220] + "..."
        raise HTTPException(status_code=502, detail=f"Remote command failed (exit {code}): {e or 'unknown error'}")

    groups = []
    buf_path = None
    buf_json = []
    for line in (out or "").splitlines():
        if line.startswith("##PATH##"):
            if buf_path is not None:
                raw = "\n".join(buf_json).strip()
                try:
                    containers = _normalize_containers(_parse_compose_ps_output(raw))
                except Exception:
                    containers = []
                groups.append({"compose_path": buf_path, "containers": containers})
            buf_path = line[len("##PATH##") :].strip()
            buf_json = []
            continue
        if line.strip() == "##END##":
            if buf_path is not None:
                raw = "\n".join(buf_json).strip()
                try:
                    containers = _normalize_containers(_parse_compose_ps_output(raw))
                except Exception:
                    containers = []
                groups.append({"compose_path": buf_path, "containers": containers})
            buf_path = None
            buf_json = []
            continue
        if buf_path is not None:
            buf_json.append(line)

    if buf_path is not None:
        raw = "\n".join(buf_json).strip()
        try:
            containers = _normalize_containers(_parse_compose_ps_output(raw))
        except Exception:
            containers = []
        groups.append({"compose_path": buf_path, "containers": containers})

    groups = [g for g in groups if g.get("compose_path")]
    groups.sort(key=lambda x: str(x.get("compose_path")))

    resp = {
        "ok": True,
        "deployment_id": str(d.id),
        "server_id": str(s.id),
        "dest_dir": dest_dir,
        "last_deploy_at": last_deploy_at.isoformat() if last_deploy_at else None,
        "last_deploy_history_id": str(last_deploy_history_id) if last_deploy_history_id else None,
        "groups": groups,
        "ts": datetime.utcnow().isoformat(),
    }
    _monitor_cache[dep_id] = (datetime.utcnow().timestamp(), resp)
    return resp
