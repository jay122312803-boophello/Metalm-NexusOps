import json
import shlex
import uuid
from datetime import datetime

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
            out.append({"Name": name, "State": state, "Image": image, "Ports": ports})
        return out
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

@router.get("/{dep_id}/monitor", dependencies=[Depends(require_permission("monitor:read"))])
async def monitor_services(dep_id: str):
    did = uuid.UUID(dep_id)
    now = datetime.utcnow().timestamp()
    cached = _monitor_cache.get(dep_id)
    if cached and now - float(cached[0]) < _monitor_cache_ttl_s:
        return cached[1]


    def _work(session):
        d = session.get(Deployment, did)
        if not d:
            raise HTTPException(status_code=404, detail="Deployment not found")
        s = session.get(Server, d.server_id)
        if not s:
            raise HTTPException(status_code=404, detail="Server configuration not found")
        if not getattr(s, "ssh_key", None):
            raise HTTPException(status_code=400, detail="Server SSH key not configured")
        ok_hist = session.exec(
            select(DeploymentHistory.id)
            .where(DeploymentHistory.deployment_id == did)
            .where(DeploymentHistory.status == "success")
            .limit(1)
        ).first()
        if not ok_hist:
            raise HTTPException(status_code=409, detail="Please complete the first successful deployment before monitoring")
        dest_dir = (d.dest_dir or "").strip() or s.deploy_path
        return d, s, dest_dir

    d, s, dest_dir = await run_db(_work)

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
    docker compose ps --format json >/dev/null 2>&1
    if [ $? -eq 0 ]; then
      docker compose ps --format json 2>/dev/null
    else
      docker-compose ps --format json >/dev/null 2>&1
      if [ $? -eq 0 ]; then
        docker-compose ps --format json 2>/dev/null
      else
        ids="$(docker-compose ps -q 2>/dev/null)"
        if [ -n "$ids" ] && command -v docker >/dev/null 2>&1; then
          docker inspect $ids 2>/dev/null || echo "[]"
        else
          echo "[]"
        fi
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
        "groups": groups,
        "ts": datetime.utcnow().isoformat(),
    }
    _monitor_cache[dep_id] = (datetime.utcnow().timestamp(), resp)
    return resp
