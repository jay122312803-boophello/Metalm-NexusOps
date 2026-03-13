import os
import uuid
from datetime import datetime

import requests
from fastapi import APIRouter, HTTPException

from ...db.models import Deployment, DeploymentHistory, Repo, Server
from ...db.session import run_db
from ...schemas import CreateDeploymentRequest, TriggerDeploymentRequest

router = APIRouter()


@router.get("")
async def list_deployments():
    def _work(session):
        rows = session.query(Deployment).order_by(Deployment.created_at.asc()).all()
        return [
            {
                "id": str(d.id),
                "name": d.name,
                "server_id": str(d.server_id),
                "repo_id": str(d.repo_id),
                "created_at": d.created_at.isoformat() if d.created_at else None,
            }
            for d in rows
        ]

    return await run_db(_work)


@router.post("")
async def create_deployment(req: CreateDeploymentRequest):
    data = req.model_dump()

    def _work(session):
        d = Deployment(
            name=data["name"],
            server_id=uuid.UUID(data["server_id"]),
            repo_id=uuid.UUID(data["repo_id"]),
        )
        session.add(d)
        session.commit()
        session.refresh(d)
        return {
            "id": str(d.id),
            "name": d.name,
            "server_id": str(d.server_id),
            "repo_id": str(d.repo_id),
            "created_at": d.created_at.isoformat() if d.created_at else None,
        }

    return await run_db(_work)


@router.delete("/{dep_id}")
async def delete_deployment(dep_id: str):
    def _work(session):
        d = session.get(Deployment, uuid.UUID(dep_id))
        if not d:
            return False
        session.delete(d)
        session.commit()
        return True

    ok = await run_db(_work)
    if not ok:
        raise HTTPException(status_code=404, detail="Deployment not found")
    return {"ok": True}


@router.post("/{dep_id}/trigger")
async def trigger_deployment(dep_id: str, req: TriggerDeploymentRequest = TriggerDeploymentRequest()):
    payload = req.model_dump()

    def _work(session):
        d = session.get(Deployment, uuid.UUID(dep_id))
        if not d:
            raise HTTPException(status_code=404, detail="Deployment not found")

        s = session.get(Server, d.server_id)
        r = session.get(Repo, d.repo_id)
        if not s:
            raise HTTPException(status_code=404, detail="Server configuration not found")
        if not r:
            raise HTTPException(status_code=404, detail="Repository configuration not found")

        project_id = r.project_id or os.getenv("GITLAB_PROJECT")
        if not project_id:
            raise HTTPException(status_code=400, detail="Project ID not configured in repo")

        gitlab_url = (os.getenv("GITLAB_BASE_URL") or "https://gitlab.xuelangyun.com").rstrip("/")
        ref = r.branch or os.getenv("TRIGGER_REF") or "master"

        trigger_token = (r.trigger_token or "").strip() or (os.getenv("TRIGGER_TOKEN") or "").strip() or None
        private_token = (r.private_token or "").strip() or (os.getenv("PRIVATE_TOKEN") or "").strip() or None

        variables = {}
        req_vars = payload.get("variables") or {}
        for k, v in req_vars.items():
            if v is not None and str(v).strip() != "":
                variables[k] = v
        variables["SERVER_HOST"] = s.address
        variables["SERVER_USER"] = s.ssh_user or "metalm"

        verify_tls = (os.getenv("GITLAB_TLS_INSECURE") or "").strip() != "1"

        resp = None
        try:
            if trigger_token:
                url = f"{gitlab_url}/api/v4/projects/{requests.utils.quote(project_id, safe='')}/trigger/pipeline"
                form = {"token": trigger_token, "ref": ref}
                for k, v in variables.items():
                    form[f"variables[{k}]"] = v
                resp = requests.post(url, data=form, verify=verify_tls, timeout=15)
            elif private_token:
                url = f"{gitlab_url}/api/v4/projects/{requests.utils.quote(project_id, safe='')}/pipeline"
                headers = {"PRIVATE-TOKEN": private_token}
                form = {"ref": ref}
                for k, v in variables.items():
                    form[f"variables[{k}]"] = v
                resp = requests.post(url, headers=headers, data=form, verify=verify_tls, timeout=15)
            else:
                raise HTTPException(status_code=400, detail="No token configured for repository")

            resp.raise_for_status()
            data = resp.json()
        except requests.HTTPError:
            status_code = resp.status_code if resp is not None else 500
            body = None
            try:
                body = resp.json() if resp is not None else None
            except Exception:
                body = (resp.text[:2000] if resp is not None else None)
            raise HTTPException(status_code=status_code, detail={"gitlab_error": body})
        except requests.RequestException as e:
            raise HTTPException(status_code=502, detail=str(e))

        h = DeploymentHistory(
            deployment_id=d.id,
            pipeline_id=data.get("id"),
            status=data.get("status"),
            ref=data.get("ref") or ref,
            web_url=data.get("web_url"),
            created_at=datetime.utcnow(),
            server_snapshot={
                "id": str(s.id),
                "name": s.name,
                "address": s.address,
                "ssh_user": s.ssh_user,
                "deploy_path": s.deploy_path,
            },
            repo_snapshot={
                "id": str(r.id),
                "name": r.name,
                "url": r.url,
                "branch": ref,
                "project_id": project_id,
            },
            variables=variables,
        )
        session.add(h)
        session.commit()
        session.refresh(h)

        return {"ok": True, "pipeline": data, "history_id": str(h.id)}

    return await run_db(_work)
