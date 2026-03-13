import uuid
from datetime import datetime

import requests
from fastapi import APIRouter, HTTPException

from ...schemas import CreateDeploymentRequest, TriggerDeploymentRequest
from ...state import storage

router = APIRouter()


@router.get("")
def list_deployments():
    return storage.get_all("deployments")


@router.post("")
def create_deployment(req: CreateDeploymentRequest):
    item = req.model_dump()
    item["id"] = str(uuid.uuid4())
    item["created_at"] = datetime.now().isoformat()
    storage.add("deployments", item)
    return item


@router.delete("/{dep_id}")
def delete_deployment(dep_id: str):
    ok = storage.delete("deployments", dep_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Deployment not found")
    return {"ok": True}


@router.post("/{dep_id}/trigger")
def trigger_deployment(dep_id: str, req: TriggerDeploymentRequest = TriggerDeploymentRequest()):
    dep = storage.get_by_id("deployments", dep_id)
    if not dep:
        raise HTTPException(status_code=404, detail="Deployment not found")

    repo_id = dep.get("repo_id")
    server_id = dep.get("server_id")
    if not repo_id:
        raise HTTPException(status_code=400, detail="Deployment missing repo_id")

    repo = storage.get_by_id("repos", repo_id)
    if not repo:
        raise HTTPException(status_code=404, detail="Repository configuration not found")

    server = storage.get_by_id("servers", server_id) if server_id else None
    if not server:
        raise HTTPException(status_code=404, detail="Server configuration not found")

    project_id = repo.get("project_id")
    if not project_id:
        raise HTTPException(status_code=400, detail="Project ID not configured in repo")

    gitlab_url = "https://gitlab.xuelangyun.com"

    variables = {}
    if req.variables:
        variables.update({k: v for k, v in req.variables.items() if v is not None and str(v).strip() != ""})

    variables["SERVER_HOST"] = server.get("address")
    variables["SERVER_USER"] = server.get("ssh_user") or "metalm"

    resp = None
    try:
        if repo.get("trigger_token"):
            url = f"{gitlab_url}/api/v4/projects/{requests.utils.quote(project_id, safe='')}/trigger/pipeline"
            data = {"token": repo.get("trigger_token"), "ref": repo.get("branch", "master")}
            for k, v in variables.items():
                data[f"variables[{k}]"] = v
            resp = requests.post(url, data=data, verify=False, timeout=15)
        elif repo.get("private_token"):
            url = f"{gitlab_url}/api/v4/projects/{requests.utils.quote(project_id, safe='')}/pipeline"
            headers = {"PRIVATE-TOKEN": repo.get("private_token")}
            payload = {"ref": repo.get("branch", "master")}
            for k, v in variables.items():
                payload[f"variables[{k}]"] = v
            resp = requests.post(url, headers=headers, data=payload, verify=False, timeout=15)
        else:
            raise HTTPException(status_code=400, detail="No token configured for repository")

        resp.raise_for_status()
        data = resp.json()

        history_item = {
            "id": str(uuid.uuid4()),
            "deployment_id": dep_id,
            "pipeline_id": data.get("id"),
            "status": data.get("status"),
            "ref": data.get("ref"),
            "web_url": data.get("web_url"),
            "created_at": datetime.now().isoformat(),
            "server_snapshot": server,
            "repo_snapshot": repo,
            "variables": variables,
        }
        storage.add("history", history_item)

        return {"ok": True, "pipeline": data, "history_id": history_item["id"]}
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

