import os
import uuid

import requests
from fastapi import APIRouter, Depends, HTTPException, Query

from sqlmodel import select

from ...db.models import Deployment, DeploymentHistory, Repo, Server
from ...db.session import run_db
from ...auth.deps import require_permission
from .configs import ensure_snapshot_if_success

router = APIRouter()


@router.get("", dependencies=[Depends(require_permission("history:read"))])
async def get_history(
    server_id: str | None = Query(default=None),
    status: str | None = Query(default=None),
    deployment_id: str | None = Query(default=None),
):
    def _work(session):
        gitlab_url = (os.getenv("GITLAB_BASE_URL") or "https://gitlab.xuelangyun.com").rstrip("/")
        verify_tls = (os.getenv("GITLAB_TLS_INSECURE") or "").strip() != "1"

        refresh_rows = session.exec(
            select(
                DeploymentHistory.id,
                DeploymentHistory.pipeline_id,
                DeploymentHistory.status,
                Repo.project_id,
                Repo.private_token,
            )
            .join(Deployment, Deployment.id == DeploymentHistory.deployment_id)
            .join(Repo, Repo.id == Deployment.repo_id)
            .where(DeploymentHistory.status.in_(["pending", "running"]))
            .order_by(DeploymentHistory.created_at.desc())
            .limit(30)
        ).all()

        for hid, pid, old_status, proj_id, private_token in refresh_rows:
            proj = (proj_id or os.getenv("GITLAB_PROJECT") or "").strip()
            token = (private_token or "").strip() or (os.getenv("PRIVATE_TOKEN") or "").strip() or None
            if not pid or not proj or not token:
                continue
            url = f"{gitlab_url}/api/v4/projects/{requests.utils.quote(proj, safe='')}/pipelines/{pid}"
            headers = {"PRIVATE-TOKEN": token}
            try:
                resp = requests.get(url, headers=headers, verify=verify_tls, timeout=8)
                if not resp.ok:
                    continue
                data = resp.json()
                new_status = data.get("status")
                new_web_url = data.get("web_url")
                if new_status and new_status != old_status:
                    obj = session.get(DeploymentHistory, hid)
                    if obj:
                        obj.status = new_status
                        obj.web_url = new_web_url
                        session.add(obj)
                        session.commit()
            except Exception:
                continue

        sid = None
        if server_id and server_id != "all":
            sid = uuid.UUID(server_id)

        st = None
        if status and status != "all":
            st = status

        did = None
        if deployment_id:
            did = uuid.UUID(deployment_id)

        q = (
            select(DeploymentHistory)
            .join(Deployment, Deployment.id == DeploymentHistory.deployment_id)
            .order_by(DeploymentHistory.created_at.desc())
        )
        if sid:
            q = q.where(Deployment.server_id == sid)
        if st:
            q = q.where(DeploymentHistory.status == st)
        if did:
            q = q.where(DeploymentHistory.deployment_id == did)
        q = q.limit(500)

        rows = session.exec(q).all()

        servers = session.exec(select(Server.id, Server.name).order_by(Server.name.asc())).all()
        server_options = [{"id": str(i), "name": n} for i, n in servers]
        status_options = ["pending", "running", "success", "failed", "canceled"]

        history = []
        for h in rows:
            history.append(
                {
                    "id": str(h.id),
                    "deployment_id": str(h.deployment_id),
                    "pipeline_id": h.pipeline_id,
                    "status": h.status,
                    "ref": h.ref,
                    "web_url": h.web_url,
                    "created_at": h.created_at.isoformat() if h.created_at else None,
                    "finished_at": h.finished_at.isoformat() if h.finished_at else None,
                    "server_snapshot": h.server_snapshot,
                    "repo_snapshot": h.repo_snapshot,
                    "variables": h.variables,
                }
            )

        return {"ok": True, "history": history, "filters": {"servers": server_options, "statuses": status_options}}

    return await run_db(_work)


@router.get("/{history_id}/status", dependencies=[Depends(require_permission("history:read"))])
async def check_pipeline_status(history_id: str):
    def _work(session):
        gitlab_url = (os.getenv("GITLAB_BASE_URL") or "https://gitlab.xuelangyun.com").rstrip("/")
        verify_tls = (os.getenv("GITLAB_TLS_INSECURE") or "").strip() != "1"

        h = session.get(DeploymentHistory, uuid.UUID(history_id))
        if not h:
            raise HTTPException(404, "History not found")

        d = session.get(Deployment, h.deployment_id)
        r = session.get(Repo, d.repo_id) if d else None

        pid = h.pipeline_id
        proj = ((r.project_id if r else None) or os.getenv("GITLAB_PROJECT") or "").strip()
        token = ((r.private_token if r else None) or "").strip() or (os.getenv("PRIVATE_TOKEN") or "").strip() or None

        if pid and proj and token:
            url = f"{gitlab_url}/api/v4/projects/{requests.utils.quote(proj, safe='')}/pipelines/{pid}"
            headers = {"PRIVATE-TOKEN": token}
            try:
                resp = requests.get(url, headers=headers, verify=verify_tls, timeout=8)
                if resp.ok:
                    data = resp.json()
                    new_status = data.get("status")
                    new_web_url = data.get("web_url")
                    if new_status:
                        h.status = new_status
                        h.web_url = new_web_url
                        session.add(h)
                        session.commit()
                    return {"status": new_status or h.status, "pipeline": data}
            except Exception:
                pass

        return {"status": h.status, "pipeline": None}

    res = await run_db(_work)
    try:
        if res and res.get("status") == "success":
            await ensure_snapshot_if_success(uuid.UUID(history_id))
    except Exception:
        pass
    return res


@router.delete("/{history_id}", dependencies=[Depends(require_permission("history:delete"))])
async def delete_history(history_id: str):
    def _work(session):
        h = session.get(DeploymentHistory, uuid.UUID(history_id))
        if not h:
            raise HTTPException(status_code=404, detail="History not found")
        session.delete(h)
        session.commit()
        return {"ok": True}

    return await run_db(_work)
