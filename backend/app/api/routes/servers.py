import json
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from starlette.concurrency import run_in_threadpool

from ...auth.deps import require_permission
from ...schemas import CreateServerRequest, UpdateServerRequest
from ...db.models import Server
from ...db.session import run_db
from sqlalchemy.exc import IntegrityError
from ...ssh import ssh_exec

router = APIRouter()
_metrics_cache: dict[str, tuple[float, dict]] = {}
_metrics_cache_ttl_s = 10.0

def _infer_env(name: str) -> str:
    s = (name or "").lower()
    if "生产" in (name or "") or "prod" in s:
        return "PROD"
    if "测试" in (name or "") or "test" in s:
        return "TEST"
    if "开发" in (name or "") or "dev" in s:
        return "DEV"
    return "OTHER"


def _norm_env(v: str | None, name: str) -> str:
    s = (v or "").strip().upper()
    if s in {"PROD", "TEST", "DEV", "OTHER"}:
        return s
    return _infer_env(name)


@router.get("")
async def list_servers(user=Depends(require_permission("servers:read"))):
    def _work(session):
        rows = session.query(Server).order_by(Server.created_at.asc()).all()
        return [
            {
                "id": str(s.id),
                "name": s.name,
                "environment": (s.environment or "").strip() or _infer_env(s.name),
                "address": s.address,
                "ssh_user": s.ssh_user,
                "ssh_key_configured": bool(s.ssh_key),
                "deploy_path": s.deploy_path,
                "description": s.description,
                "created_at": s.created_at.isoformat() if s.created_at else None,
            }
            for s in rows
        ]

    return await run_db(_work)


@router.post("")
async def create_server(req: CreateServerRequest, user=Depends(require_permission("servers:manage"))):
    data = req.model_dump()
    def _work(session):
        name = (data.get("name") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="name required")
        exists = session.query(Server).filter(Server.name == name).first()
        if exists:
            raise HTTPException(status_code=409, detail="服务器名称已存在，请更换")
        ssh_key = data.get("ssh_key")
        if ssh_key is not None and str(ssh_key).strip() == "":
            ssh_key = None
        env = _norm_env(data.get("environment"), name)
        s = Server(
            name=name,
            environment=env,
            address=data["address"],
            ssh_user=data.get("ssh_user") or "metalm",
            ssh_key=ssh_key,
            deploy_path=data["deploy_path"],
            description=data.get("description"),
        )
        session.add(s)
        session.commit()
        session.refresh(s)
        return {
            "id": str(s.id),
            "name": s.name,
            "environment": (s.environment or "").strip() or _infer_env(s.name),
            "address": s.address,
            "ssh_user": s.ssh_user,
            "ssh_key_configured": bool(s.ssh_key),
            "deploy_path": s.deploy_path,
            "description": s.description,
            "created_at": s.created_at.isoformat() if s.created_at else None,
        }

    return await run_db(_work)


@router.get("/{server_id}")
async def get_server(server_id: str, user=Depends(require_permission("servers:read"))):
    def _work(session):
        s = session.get(Server, uuid.UUID(server_id))
        if not s:
            raise HTTPException(status_code=404, detail="Server not found")
        return {
            "id": str(s.id),
            "name": s.name,
            "environment": (s.environment or "").strip() or _infer_env(s.name),
            "address": s.address,
            "ssh_user": s.ssh_user,
            "ssh_key_configured": bool(s.ssh_key),
            "deploy_path": s.deploy_path,
            "description": s.description,
            "created_at": s.created_at.isoformat() if s.created_at else None,
        }

    return await run_db(_work)


@router.put("/{server_id}")
async def update_server(server_id: str, req: UpdateServerRequest, user=Depends(require_permission("servers:manage"))):
    data = req.model_dump(exclude_unset=True)

    def _work(session):
        s = session.get(Server, uuid.UUID(server_id))
        if not s:
            raise HTTPException(status_code=404, detail="Server not found")
        if "name" in data and data["name"] is not None:
            name = str(data["name"]).strip()
            if not name:
                raise HTTPException(status_code=400, detail="name required")
            exists = session.query(Server).filter(Server.name == name, Server.id != s.id).first()
            if exists:
                raise HTTPException(status_code=409, detail="服务器名称已存在，请更换")
            data["name"] = name
        if "environment" in data:
            data["environment"] = _norm_env(data.get("environment"), data.get("name") or s.name)
        for k, v in data.items():
            if k == "ssh_user" and v is not None and str(v).strip() == "":
                v = "metalm"
            if k == "ssh_key" and v is not None and str(v).strip() == "":
                v = None
            if k == "description" and v is not None and str(v).strip() == "":
                v = None
            setattr(s, k, v)
        session.add(s)
        session.commit()
        session.refresh(s)
        return {"ok": True}

    return await run_db(_work)


@router.delete("/{server_id}")
async def delete_server(server_id: str, user=Depends(require_permission("servers:manage"))):
    def _work(session):
        s = session.get(Server, uuid.UUID(server_id))
        if not s:
            return False
        session.delete(s)
        session.commit()
        return True

    try:
        ok = await run_db(_work)
    except IntegrityError:
        raise HTTPException(status_code=409, detail="该服务器被部署任务引用，无法删除")
    if not ok:
        raise HTTPException(status_code=404, detail="Server not found")
    return {"ok": True}


@router.get("/{server_id}/metrics")
async def get_server_metrics(server_id: str, user=Depends(require_permission("servers:metrics"))):
    sid = uuid.UUID(server_id)
    now = datetime.utcnow().timestamp()
    cached = _metrics_cache.get(server_id)
    if cached and now - float(cached[0]) < _metrics_cache_ttl_s:
        return cached[1]

    def _work(session):
        s = session.get(Server, sid)
        if not s:
            raise HTTPException(status_code=404, detail="Server not found")
        if not (s.ssh_user or "").strip():
            raise HTTPException(status_code=400, detail="Server ssh_user not configured")
        if not getattr(s, "ssh_key", None):
            raise HTTPException(status_code=400, detail="Server SSH key not configured")
        return s

    s = await run_db(_work)

    script = r"""
set +e
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"

cpu_usage() {
  if [ ! -r /proc/stat ]; then
    echo "0"
    return
  fi
  read -r cpu a b c d e f g h i j < /proc/stat
  t1=$((a+b+c+d+e+f+g+h))
  i1=$((d+e))
  sleep 0.3
  read -r cpu a b c d e f g h i j < /proc/stat
  t2=$((a+b+c+d+e+f+g+h))
  i2=$((d+e))
  dt=$((t2-t1))
  di=$((i2-i1))
  if [ "$dt" -le 0 ]; then
    echo "0"
    return
  fi
  awk -v dt="$dt" -v di="$di" 'BEGIN{printf "%.2f", (1-(di/dt))*100}'
}

mem_json() {
  if [ -r /proc/meminfo ]; then
    total_kb=$(awk '/^MemTotal:/{print $2}' /proc/meminfo)
    avail_kb=$(awk '/^MemAvailable:/{print $2}' /proc/meminfo)
    if [ -z "$total_kb" ] || [ -z "$avail_kb" ] || [ "$total_kb" -le 0 ]; then
      echo '{"total":0,"used":0,"percent":0}'
      return
    fi
    used_kb=$((total_kb-avail_kb))
    awk -v t="$total_kb" -v u="$used_kb" 'BEGIN{printf "{\"total\":%d,\"used\":%d,\"percent\":%.2f}", t, u, (u/t)*100}'
    return
  fi
  if command -v free >/dev/null 2>&1; then
    read total used free <<< $(free -m | awk 'NR==2{print $2,$3,$4}')
    if [ -z "$total" ] || [ "$total" -le 0 ]; then
      echo '{"total":0,"used":0,"percent":0}'
      return
    fi
    awk -v t="$total" -v u="$used" 'BEGIN{printf "{\"total\":%d,\"used\":%d,\"percent\":%.2f}", t, u, (u/t)*100}'
    return
  fi
  echo '{"total":0,"used":0,"percent":0}'
}

disk_json() {
  df -P / 2>/dev/null | awk 'NR==2{printf "{\"total\":\"%s\",\"used\":\"%s\",\"avail\":\"%s\",\"percent\":\"%s\"}", $2,$3,$4,$5}'
}

uptime_str() {
  u="$(uptime -p 2>/dev/null)"
  if [ -n "$u" ]; then
    printf "%s" "$u" | sed 's/"/'\''/g'
    return
  fi
  if [ -r /proc/uptime ]; then
    secs=$(awk '{print int($1)}' /proc/uptime)
    printf "up %ss" "$secs" | sed 's/"/'\''/g'
    return
  fi
  echo "unknown"
}

load_str() {
  if [ -r /proc/loadavg ]; then
    awk '{print $1","$2","$3}' /proc/loadavg | sed 's/"/'\''/g'
    return
  fi
  uptime 2>/dev/null | awk -F'load average:' 'NF>1{gsub(" ","",$2);print $2}' | sed 's/"/'\''/g'
}

net_json() {
  if [ -r /proc/net/dev ]; then
    awk -F'[: ]+' 'NR>2 && $1!="lo" {rx+=$2; tx+=$10} END{printf "{\"rx\":%d,\"tx\":%d}", rx, tx}' /proc/net/dev
    return
  fi
  echo '{"rx":0,"tx":0}'
}

cpu=$(cpu_usage)
mem=$(mem_json)
disk=$(disk_json)
upt=$(uptime_str)
load=$(load_str)
net=$(net_json)

printf "{"
printf "\"cpu_usage\":%s," "$cpu"
printf "\"memory\":%s," "$mem"
printf "\"disk\":%s," "$disk"
printf "\"uptime\":\"%s\"," "$upt"
printf "\"load\":\"%s\"," "$load"
printf "\"network\":%s" "$net"
printf "}\n"
""".strip()

    try:
        code, out, err = await run_in_threadpool(
            ssh_exec, s.address, s.ssh_user or "metalm", s.ssh_key, script, timeout=14.0
        )
    except Exception as e:
        msg = str(e).replace("\n", " ").strip()
        if len(msg) > 200:
            msg = msg[:200] + "..."
        detail = f"SSH metrics failed: {type(e).__name__}" + (f": {msg}" if msg else "")
        raise HTTPException(status_code=502, detail=detail) from e

    if code != 0:
        e = (err or "").strip().replace("\n", " ")
        if len(e) > 220:
            e = e[:220] + "..."
        raise HTTPException(status_code=502, detail=f"Remote command failed (exit {code}): {e or 'unknown error'}")

    raw = (out or "").strip()
    try:
        payload = json.loads(raw)
    except Exception:
        raise HTTPException(status_code=502, detail="Remote output is not valid JSON")

    resp = {
        "ok": True,
        "server_id": str(s.id),
        "ts": datetime.utcnow().isoformat(),
        "metrics": payload,
    }
    _metrics_cache[server_id] = (datetime.utcnow().timestamp(), resp)
    return resp
