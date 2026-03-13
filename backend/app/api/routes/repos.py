import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException

from ...schemas import CreateRepoRequest
from ...state import storage

router = APIRouter()


@router.get("")
def list_repos():
    return storage.get_all("repos")


@router.post("")
def create_repo(req: CreateRepoRequest):
    item = req.model_dump()
    item["id"] = str(uuid.uuid4())
    item["created_at"] = datetime.now().isoformat()
    storage.add("repos", item)
    return item


@router.delete("/{repo_id}")
def delete_repo(repo_id: str):
    ok = storage.delete("repos", repo_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Repo not found")
    return {"ok": True}

