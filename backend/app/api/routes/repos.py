from fastapi import APIRouter, HTTPException

from ...schemas import CreateRepoRequest
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
        r = Repo(
            name=data["name"],
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
