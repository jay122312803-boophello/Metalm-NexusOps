from fastapi import APIRouter, HTTPException

from ...schemas import CreateServerRequest, UpdateServerRequest
from ...db.models import Server
from ...db.session import run_db
import uuid
from sqlalchemy.exc import IntegrityError

router = APIRouter()


@router.get("")
async def list_servers():
    def _work(session):
        rows = session.query(Server).order_by(Server.created_at.asc()).all()
        return [
            {
                "id": str(s.id),
                "name": s.name,
                "address": s.address,
                "ssh_user": s.ssh_user,
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
        s = Server(
            name=name,
            address=data["address"],
            ssh_user=data.get("ssh_user") or "metalm",
            deploy_path=data["deploy_path"],
            description=data.get("description"),
        )
        session.add(s)
        session.commit()
        session.refresh(s)
        return {
            "id": str(s.id),
            "name": s.name,
            "address": s.address,
            "ssh_user": s.ssh_user,
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
            "address": s.address,
            "ssh_user": s.ssh_user,
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
        for k, v in data.items():
            if k == "ssh_user" and v is not None and str(v).strip() == "":
                v = "metalm"
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
