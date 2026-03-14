from fastapi import APIRouter, HTTPException

from ...schemas import CreateServerRequest, UpdateServerRequest
from ...db.models import Server
from ...db.session import run_db
import uuid
from sqlalchemy.exc import IntegrityError

router = APIRouter()

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
async def list_servers():
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
async def create_server(req: CreateServerRequest):
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
async def get_server(server_id: str):
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
async def update_server(server_id: str, req: UpdateServerRequest):
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
async def delete_server(server_id: str):
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
