import io
import os
import uuid
import zipfile
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlmodel import select

from ...auth.deps import require_permission
from ...db.models import Deployment, DeploymentHistory, TaskConfig, TaskConfigSnapshot, TaskConfigSnapshotFile
from ...db.session import run_db

router = APIRouter()


def _validate_rel_path(p: str) -> str:
    path = (p or "").strip().replace("\\", "/")
    if not path:
        raise HTTPException(400, "rel_path required")
    if path.startswith("/"):
        raise HTTPException(400, "rel_path must be relative")
    parts = [x for x in path.split("/") if x]
    if any(x in {".", ".."} for x in parts):
        raise HTTPException(400, "rel_path contains invalid segments")
    return "/".join(parts)


@router.get("/deployments/{dep_id}/configs")
async def list_task_configs(dep_id: str, user=Depends(require_permission("deploy:manage"))):
    def _work(session):
        did = uuid.UUID(dep_id)
        d = session.get(Deployment, did)
        if not d:
            raise HTTPException(404, "Deployment not found")
        rows = session.exec(
            select(TaskConfig).where(TaskConfig.deployment_id == did).order_by(TaskConfig.rel_path.asc())
        ).all()
        return [
            {
                "id": str(c.id),
                "rel_path": c.rel_path,
                "updated_at": c.updated_at.isoformat() if c.updated_at else None,
            }
            for c in rows
        ]

    return await run_db(_work)


@router.post("/deployments/{dep_id}/configs")
async def create_task_config(dep_id: str, body: dict, user=Depends(require_permission("deploy:manage"))):
    rel_path = _validate_rel_path(body.get("rel_path"))

    def _work(session):
        did = uuid.UUID(dep_id)
        d = session.get(Deployment, did)
        if not d:
            raise HTTPException(404, "Deployment not found")

        exists = session.exec(
            select(TaskConfig).where(TaskConfig.deployment_id == did, TaskConfig.rel_path == rel_path)
        ).first()
        if exists:
            raise HTTPException(409, "Config file already exists")

        c = TaskConfig(deployment_id=did, rel_path=rel_path, content="", created_at=datetime.utcnow(), updated_at=datetime.utcnow())
        session.add(c)
        session.commit()
        session.refresh(c)
        return {"id": str(c.id), "rel_path": c.rel_path, "content": c.content, "updated_at": c.updated_at.isoformat()}

    return await run_db(_work)


@router.get("/deployments/{dep_id}/configs/{config_id}")
async def get_task_config(dep_id: str, config_id: str, user=Depends(require_permission("deploy:manage"))):
    def _work(session):
        did = uuid.UUID(dep_id)
        d = session.get(Deployment, did)
        if not d:
            raise HTTPException(404, "Deployment not found")
        cid = uuid.UUID(config_id)
        c = session.get(TaskConfig, cid)
        if not c or c.deployment_id != did:
            raise HTTPException(404, "Config not found")
        return {
            "id": str(c.id),
            "rel_path": c.rel_path,
            "content": c.content,
            "updated_at": c.updated_at.isoformat() if c.updated_at else None,
        }

    return await run_db(_work)


@router.put("/deployments/{dep_id}/configs/{config_id}")
async def update_task_config(dep_id: str, config_id: str, body: dict, user=Depends(require_permission("deploy:manage"))):
    content = body.get("content")
    if content is None:
        raise HTTPException(400, "content required")

    def _work(session):
        did = uuid.UUID(dep_id)
        d = session.get(Deployment, did)
        if not d:
            raise HTTPException(404, "Deployment not found")
        cid = uuid.UUID(config_id)
        c = session.get(TaskConfig, cid)
        if not c or c.deployment_id != did:
            raise HTTPException(404, "Config not found")
        c.content = str(content)
        c.updated_at = datetime.utcnow()
        session.add(c)
        session.commit()
        session.refresh(c)
        return {"ok": True, "updated_at": c.updated_at.isoformat()}

    return await run_db(_work)


@router.put("/deployments/{dep_id}/configs/{config_id}/rename")
async def rename_task_config(dep_id: str, config_id: str, body: dict, user=Depends(require_permission("deploy:manage"))):
    rel_path = _validate_rel_path(body.get("rel_path"))

    def _work(session):
        did = uuid.UUID(dep_id)
        d = session.get(Deployment, did)
        if not d:
            raise HTTPException(404, "Deployment not found")
        cid = uuid.UUID(config_id)
        c = session.get(TaskConfig, cid)
        if not c or c.deployment_id != did:
            raise HTTPException(404, "Config not found")
        if c.rel_path == rel_path:
            return {"ok": True, "rel_path": c.rel_path, "updated_at": c.updated_at.isoformat() if c.updated_at else None}

        exists = session.exec(
            select(TaskConfig).where(TaskConfig.deployment_id == did, TaskConfig.rel_path == rel_path)
        ).first()
        if exists:
            raise HTTPException(409, "Config file already exists")

        c.rel_path = rel_path
        c.updated_at = datetime.utcnow()
        session.add(c)
        session.commit()
        session.refresh(c)
        return {"ok": True, "rel_path": c.rel_path, "updated_at": c.updated_at.isoformat() if c.updated_at else None}

    return await run_db(_work)


@router.delete("/deployments/{dep_id}/configs/{config_id}")
async def delete_task_config(dep_id: str, config_id: str, user=Depends(require_permission("deploy:manage"))):
    def _work(session):
        did = uuid.UUID(dep_id)
        d = session.get(Deployment, did)
        if not d:
            raise HTTPException(404, "Deployment not found")
        cid = uuid.UUID(config_id)
        c = session.get(TaskConfig, cid)
        if not c or c.deployment_id != did:
            return False
        session.delete(c)
        session.commit()
        return True

    ok = await run_db(_work)
    if not ok:
        raise HTTPException(404, "Config not found")
    return {"ok": True}


@router.post("/deployments/{dep_id}/configs/clear")
async def clear_task_configs(dep_id: str, user=Depends(require_permission("deploy:manage"))):
    def _work(session):
        did = uuid.UUID(dep_id)
        d = session.get(Deployment, did)
        if not d:
            raise HTTPException(404, "Deployment not found")
        rows = session.exec(select(TaskConfig).where(TaskConfig.deployment_id == did)).all()
        for c in rows:
            session.delete(c)
        session.commit()
        return {"ok": True, "deleted": len(rows)}

    return await run_db(_work)


def _zip_bytes(files: list[tuple[str, str]]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for rel_path, content in files:
            zf.writestr(rel_path, content or "")
    return buf.getvalue()


@router.get("/deployments/{dep_id}/configs.zip")
async def download_current_configs_zip(dep_id: str, user=Depends(require_permission("deploy:manage"))):
    def _work(session):
        did = uuid.UUID(dep_id)
        d = session.get(Deployment, did)
        if not d:
            raise HTTPException(404, "Deployment not found")
        rows = session.exec(select(TaskConfig.rel_path, TaskConfig.content).where(TaskConfig.deployment_id == did)).all()
        files = [(rp, ct or "") for rp, ct in rows]
        return _zip_bytes(files)

    data = await run_db(_work)
    headers = {"Content-Disposition": f'attachment; filename="deployment-{dep_id}-configs.zip"'}
    return StreamingResponse(io.BytesIO(data), media_type="application/zip", headers=headers)


@router.get("/history/{history_id}/configs")
async def list_snapshot_configs(history_id: str, user=Depends(require_permission("audit:read"))):
    hid = uuid.UUID(history_id)
    try:
        await ensure_snapshot(hid)
    except Exception:
        pass

    def _work(session):
        h = session.get(DeploymentHistory, hid)
        if not h:
            raise HTTPException(404, "History not found")
        d = session.get(Deployment, h.deployment_id)
        if not d:
            raise HTTPException(404, "History not found")
        snap = session.exec(select(TaskConfigSnapshot).where(TaskConfigSnapshot.history_id == hid)).first()
        if not snap:
            return {"ok": True, "readonly": True, "snapshot_ready": False, "files": []}
        rows = session.exec(
            select(TaskConfigSnapshotFile).where(TaskConfigSnapshotFile.snapshot_id == snap.id).order_by(TaskConfigSnapshotFile.rel_path.asc())
        ).all()
        return {
            "ok": True,
            "readonly": True,
            "snapshot_ready": True,
            "files": [
                {"id": str(f.id), "rel_path": f.rel_path, "updated_at": f.created_at.isoformat() if f.created_at else None}
                for f in rows
            ],
        }

    return await run_db(_work)


@router.get("/history/{history_id}/configs/{file_id}")
async def get_snapshot_config(history_id: str, file_id: str, user=Depends(require_permission("audit:read"))):
    def _work(session):
        hid = uuid.UUID(history_id)
        fid = uuid.UUID(file_id)
        h = session.get(DeploymentHistory, hid)
        if not h:
            raise HTTPException(404, "History not found")
        d = session.get(Deployment, h.deployment_id)
        if not d:
            raise HTTPException(404, "History not found")
        snap = session.exec(select(TaskConfigSnapshot).where(TaskConfigSnapshot.history_id == hid)).first()
        if not snap:
            raise HTTPException(404, "Snapshot not ready")
        f = session.get(TaskConfigSnapshotFile, fid)
        if not f or f.snapshot_id != snap.id:
            raise HTTPException(404, "Config not found")
        return {"id": str(f.id), "rel_path": f.rel_path, "content": f.content}

    return await run_db(_work)


@router.get("/history/{history_id}/configs.zip")
async def download_snapshot_configs_zip(history_id: str, user=Depends(require_permission("audit:read"))):
    def _work(session):
        hid = uuid.UUID(history_id)
        h = session.get(DeploymentHistory, hid)
        if not h:
            raise HTTPException(404, "History not found")
        d = session.get(Deployment, h.deployment_id)
        if not d:
            raise HTTPException(404, "History not found")
        snap = session.exec(select(TaskConfigSnapshot).where(TaskConfigSnapshot.history_id == hid)).first()
        if not snap:
            raise HTTPException(404, "Snapshot not ready")
        rows = session.exec(
            select(TaskConfigSnapshotFile.rel_path, TaskConfigSnapshotFile.content).where(TaskConfigSnapshotFile.snapshot_id == snap.id)
        ).all()
        files = [(rp, ct or "") for rp, ct in rows]
        return _zip_bytes(files)

    data = await run_db(_work)
    headers = {"Content-Disposition": f'attachment; filename="history-{history_id}-configs.zip"'}
    return StreamingResponse(io.BytesIO(data), media_type="application/zip", headers=headers)


async def ensure_snapshot_if_success(history_id: uuid.UUID) -> None:
    def _work(session):
        hid = history_id
        h = session.get(DeploymentHistory, hid)
        if not h or h.status != "success":
            return
        _ensure_snapshot(session, hid, h.deployment_id)

    await run_db(_work)


async def ensure_snapshot(history_id: uuid.UUID) -> None:
    def _work(session):
        hid = history_id
        h = session.get(DeploymentHistory, hid)
        if not h:
            return
        _ensure_snapshot(session, hid, h.deployment_id)

    await run_db(_work)


def _ensure_snapshot(session, history_id: uuid.UUID, deployment_id: uuid.UUID) -> None:
    exists = session.exec(select(TaskConfigSnapshot).where(TaskConfigSnapshot.history_id == history_id)).first()
    if exists:
        return
    d = session.get(Deployment, deployment_id)
    if not d:
        return
    snap = TaskConfigSnapshot(history_id=history_id, deployment_id=d.id, created_at=datetime.utcnow())
    session.add(snap)
    session.commit()
    session.refresh(snap)

    rows = session.exec(select(TaskConfig.rel_path, TaskConfig.content).where(TaskConfig.deployment_id == d.id)).all()
    for rel_path, content in rows:
        session.add(
            TaskConfigSnapshotFile(
                snapshot_id=snap.id,
                rel_path=rel_path,
                content=content or "",
                created_at=datetime.utcnow(),
            )
        )
    session.commit()
