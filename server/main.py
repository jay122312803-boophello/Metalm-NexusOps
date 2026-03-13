import os
import requests
from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import uuid
from datetime import datetime
from storage import storage

app = FastAPI()

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Models
from models import (
    Server, Repo, Deployment, History, 
    CreateServerRequest, CreateRepoRequest, CreateDeploymentRequest, TriggerDeploymentRequest
)


# --- API Routes ---

# Servers
@app.get("/api/servers", response_model=List[Server])
def get_servers():
    return storage.get_all("servers")

@app.post("/api/servers", response_model=Server)
def create_server(server: Server):
    server.id = str(uuid.uuid4())
    server.created_at = datetime.now().isoformat()
    storage.add("servers", server.dict())
    return server

@app.delete("/api/servers/{server_id}")
def delete_server(server_id: str):
    storage.delete("servers", server_id)
    return {"ok": True}

# Repos
@app.get("/api/repos", response_model=List[Repo])
def get_repos():
    return storage.get_all("repos")

@app.post("/api/repos", response_model=Repo)
def create_repo(repo: Repo):
    # Auto-extract project ID from URL if not provided (simple heuristic)
    # e.g., https://gitlab.com/group/project -> group%2Fproject
    if not repo.project_id and repo.url:
        try:
            parts = repo.url.rstrip('/').split('/')
            if len(parts) >= 2:
                repo.project_id = f"{parts[-2]}/{parts[-1]}"
        except:
            pass
            
    repo.id = str(uuid.uuid4())
    repo.created_at = datetime.now().isoformat()
    storage.add("repos", repo.dict())
    return repo

@app.delete("/api/repos/{repo_id}")
def delete_repo(repo_id: str):
    storage.delete("repos", repo_id)
    return {"ok": True}

# Deployments (Cards)
@app.get("/api/deployments", response_model=List[Deployment])
def get_deployments():
    return storage.get_all("deployments")

@app.post("/api/deployments", response_model=Deployment)
def create_deployment(dep: Deployment):
    dep.id = str(uuid.uuid4())
    dep.created_at = datetime.now().isoformat()
    storage.add("deployments", dep.dict())
    return dep

@app.delete("/api/deployments/{dep_id}")
def delete_deployment(dep_id: str):
    storage.delete("deployments", dep_id)
    return {"ok": True}

# GitLab Actions
@app.post("/api/deployments/{dep_id}/trigger")
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

    # Use repo config to trigger
    project_id = repo.get("project_id")
    if not project_id:
        raise HTTPException(status_code=400, detail="Project ID not configured in repo")

    gitlab_url = "https://gitlab.xuelangyun.com" # Could be configurable too
    
    try:
        variables = None
        if req.variables:
            variables = {k: v for k, v in req.variables.items() if v is not None and str(v).strip() != ""}
        if variables is None:
            variables = {}

        variables["SERVER_HOST"] = server.get("address")
        variables["SERVER_USER"] = server.get("ssh_user") or "metalm"

        resp = None
        if repo.get("trigger_token"):
            url = f"{gitlab_url}/api/v4/projects/{requests.utils.quote(project_id, safe='')}/trigger/pipeline"
            data = {
                "token": repo.get("trigger_token"),
                "ref": repo.get("branch", "master")
            }
            # Add custom variables
            if variables:
                for k, v in variables.items():
                    data[f"variables[{k}]"] = v
            
            resp = requests.post(url, data=data, verify=False)
        elif repo.get("private_token"):
            url = f"{gitlab_url}/api/v4/projects/{requests.utils.quote(project_id, safe='')}/pipeline"
            headers = {"PRIVATE-TOKEN": repo.get("private_token")}
            
            # Prepare payload
            payload = {"ref": repo.get("branch", "master")}
            if variables:
                for k, v in variables.items():
                    payload[f"variables[{k}]"] = v

            resp = requests.post(url, headers=headers, data=payload, verify=False)
        else:
             raise HTTPException(status_code=400, detail="No token configured for repository")

        resp.raise_for_status()
        data = resp.json()
        
        # Record history
        history_item = {
            "id": str(uuid.uuid4()),
            "deployment_id": dep_id,
            "pipeline_id": data.get("id"),
            "status": data.get("status"),
            "ref": data.get("ref"),
            "web_url": data.get("web_url"),
            "created_at": datetime.now().isoformat(),
            "server_snapshot": storage.get_by_id("servers", server_id) if server_id else None,
            "repo_snapshot": repo,
            "variables": variables
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

@app.get("/api/history/{history_id}/status")
def check_pipeline_status(history_id: str):
    h = storage.get_by_id("history", history_id)
    if not h:
        raise HTTPException(404, "History not found")
    
    # Check if we can update status from GitLab
    repo = h.get("repo_snapshot") or {}
    pid = h.get("pipeline_id")
    proj_id = repo.get("project_id")
    
    if pid and proj_id and repo.get("private_token"):
         try:
            url = f"https://gitlab.xuelangyun.com/api/v4/projects/{requests.utils.quote(proj_id, safe='')}/pipelines/{pid}"
            headers = {"PRIVATE-TOKEN": repo.get("private_token")}
            resp = requests.get(url, headers=headers, verify=False)
            if resp.ok:
                data = resp.json()
                # Update status
                new_status = data.get("status")
                new_web_url = data.get("web_url")
                storage.update("history", history_id, {"status": new_status, "web_url": new_web_url})
                return {"status": new_status, "pipeline": data}
         except:
             pass
    
    return {"status": h.get("status"), "pipeline": None}


@app.get("/api/history")
def get_history():
    history = storage.get_all("history")
    history.sort(key=lambda x: x.get("created_at", ""), reverse=True)

    refresh_targets = []
    for h in history[:30]:
        status = (h.get("status") or "").lower()
        if status not in {"pending", "running"}:
            continue
        repo = h.get("repo_snapshot") or {}
        pid = h.get("pipeline_id")
        proj_id = repo.get("project_id")
        token = repo.get("private_token")
        if pid and proj_id and token:
            refresh_targets.append((h, proj_id, pid, token))

    for h, proj_id, pid, token in refresh_targets:
        try:
            url = f"https://gitlab.xuelangyun.com/api/v4/projects/{requests.utils.quote(proj_id, safe='')}/pipelines/{pid}"
            headers = {"PRIVATE-TOKEN": token}
            resp = requests.get(url, headers=headers, verify=False, timeout=8)
            if resp.ok:
                data = resp.json()
                new_status = data.get("status")
                new_web_url = data.get("web_url")
                if new_status and new_status != h.get("status"):
                    storage.update("history", h.get("id"), {"status": new_status, "web_url": new_web_url})
                    h["status"] = new_status
                    h["web_url"] = new_web_url
        except Exception:
            pass

    return {"ok": True, "history": history}

# Serve UI
app.mount("/", StaticFiles(directory="../ui", html=True), name="ui")

if __name__ == "__main__":
    import uvicorn
    # Allow self-signed certs for internal gitlab
    import ssl
    try:
        _create_unverified_https_context = ssl._create_unverified_context
    except AttributeError:
        pass
    else:
        ssl._create_default_https_context = _create_unverified_https_context
    
    uvicorn.run(app, host="0.0.0.0", port=8000)
