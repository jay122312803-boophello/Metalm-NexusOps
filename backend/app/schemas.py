from __future__ import annotations

from datetime import datetime
from typing import Optional, Dict, Any

from pydantic import BaseModel


class Server(BaseModel):
    id: Optional[str] = None
    name: str
    address: str
    ssh_user: str = "metalm"
    deploy_path: str
    description: Optional[str] = None
    created_at: Optional[str] = None


class Repo(BaseModel):
    id: Optional[str] = None
    name: str
    url: str
    branch: str = "master"
    trigger_token: Optional[str] = None
    private_token: Optional[str] = None
    project_id: Optional[str] = None
    description: Optional[str] = None
    created_at: Optional[str] = None


class Deployment(BaseModel):
    id: Optional[str] = None
    name: str
    server_id: str
    repo_id: str
    created_at: Optional[str] = None


class History(BaseModel):
    id: Optional[str] = None
    deployment_id: str
    pipeline_id: Optional[int] = None
    status: Optional[str] = None
    ref: Optional[str] = None
    web_url: Optional[str] = None
    created_at: Optional[str] = None
    finished_at: Optional[str] = None
    server_snapshot: Optional[dict] = None
    repo_snapshot: Optional[dict] = None
    variables: Optional[Dict[str, Any]] = None


class CreateServerRequest(BaseModel):
    name: str
    address: str
    ssh_user: str = "metalm"
    deploy_path: str
    description: Optional[str] = None


class CreateRepoRequest(BaseModel):
    name: str
    url: str
    branch: str = "master"
    trigger_token: Optional[str] = None
    private_token: Optional[str] = None
    project_id: Optional[str] = None
    description: Optional[str] = None


class CreateDeploymentRequest(BaseModel):
    name: str
    server_id: str
    repo_id: str


class TriggerDeploymentRequest(BaseModel):
    variables: Optional[Dict[str, Any]] = None
