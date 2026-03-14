from fastapi import APIRouter, HTTPException

from ...schemas import CreateRepoRequest, UpdateRepoRequest
from ...db.models import Repo
from ...db.session import run_db
import uuid
from sqlalchemy.exc import IntegrityError

router = APIRouter()


@router.get("")
async def list_repos():
    def _work(session):
        rows = session.query(Repo).order_by(Repo.created_at.asc()).all()
        return [
            {
                "id": str(r.id),
                "name": r.name,
                "url": r.url,
                "branch": r.branch,
                "project_id": r.project_id,
                "auth": {"trigger": bool(r.trigger_token), "private": bool(r.private_token)},
                "description": r.description,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ]

    return await run_db(_work)


@router.post("")
async def create_repo(req: CreateRepoRequest):
    data = req.model_dump()
    def _work(session):
        name = (data.get("name") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="name required")
        exists = session.query(Repo).filter(Repo.name == name).first()
        if exists:
            raise HTTPException(status_code=409, detail="仓库名称已存在，请更换")
        r = Repo(
            name=name,
            url=data["url"],
            branch=data.get("branch") or "master",
            project_id=data.get("project_id"),
            trigger_token=(data.get("trigger_token") or None),
            private_token=(data.get("private_token") or None),
            description=data.get("description"),
        )
        session.add(r)
        session.commit()
        session.refresh(r)
        return {
            "id": str(r.id),
            "name": r.name,
            "url": r.url,
            "branch": r.branch,
            "project_id": r.project_id,
            "auth": {"trigger": bool(r.trigger_token), "private": bool(r.private_token)},
            "description": r.description,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }

    return await run_db(_work)


@router.get("/{repo_id}")
async def get_repo(repo_id: str):
    def _work(session):
        r = session.get(Repo, uuid.UUID(repo_id))
        if not r:
            raise HTTPException(status_code=404, detail="Repo not found")
        return {
            "id": str(r.id),
            "name": r.name,
            "url": r.url,
            "branch": r.branch,
            "project_id": r.project_id,
            "trigger_token": None,
            "private_token": None,
            "auth": {"trigger": bool(r.trigger_token), "private": bool(r.private_token)},
            "description": r.description,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }

    return await run_db(_work)


@router.put("/{repo_id}")
async def update_repo(repo_id: str, req: UpdateRepoRequest):
    data = req.model_dump(exclude_unset=True)

    def _work(session):
        r = session.get(Repo, uuid.UUID(repo_id))
        if not r:
            raise HTTPException(status_code=404, detail="Repo not found")

        if "name" in data and data["name"] is not None:
            name = str(data["name"]).strip()
            if not name:
                raise HTTPException(status_code=400, detail="name required")
            exists = session.query(Repo).filter(Repo.name == name, Repo.id != r.id).first()
            if exists:
                raise HTTPException(status_code=409, detail="仓库名称已存在，请更换")
            data["name"] = name

        for k, v in data.items():
            if k in {"trigger_token", "private_token"}:
                if v is None:
                    continue
                if str(v).strip() == "":
                    v = None
            if k in {"project_id", "description"} and v is not None and str(v).strip() == "":
                v = None
            if k == "branch" and v is not None and str(v).strip() == "":
                v = "master"
            setattr(r, k, v)

        session.add(r)
        session.commit()
        session.refresh(r)
        return {"ok": True, "auth": {"trigger": bool(r.trigger_token), "private": bool(r.private_token)}}

    return await run_db(_work)


@router.delete("/{repo_id}")
async def delete_repo(repo_id: str):
    def _work(session):
        r = session.get(Repo, uuid.UUID(repo_id))
        if not r:
            return False
        session.delete(r)
        session.commit()
        return True

    try:
        ok = await run_db(_work)
    except IntegrityError:
        raise HTTPException(status_code=409, detail="该仓库被部署任务引用，无法删除")
    if not ok:
        raise HTTPException(status_code=404, detail="Repo not found")
    return {"ok": True}
