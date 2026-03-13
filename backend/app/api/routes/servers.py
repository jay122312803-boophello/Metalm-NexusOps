import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException

from ...schemas import CreateServerRequest
from ...state import storage

router = APIRouter()


@router.get("")
def list_servers():
    return storage.get_all("servers")


@router.post("")
def create_server(req: CreateServerRequest):
    item = req.model_dump()
    item["id"] = str(uuid.uuid4())
    item["created_at"] = datetime.now().isoformat()
    storage.add("servers", item)
    return item


@router.delete("/{server_id}")
def delete_server(server_id: str):
    ok = storage.delete("servers", server_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Server not found")
    return {"ok": True}

