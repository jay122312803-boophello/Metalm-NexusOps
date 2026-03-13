from pydantic import BaseModel, HttpUrl
from typing import Optional, List
from datetime import datetime
import uuid

class Server(BaseModel):
    id: str = str(uuid.uuid4())
    name: str
    address: str
    ssh_user: str = "metalm"
    deploy_path: str
    description: Optional[str] = None
    created_at: datetime = datetime.now()

class Repo(BaseModel):
    id: str = str(uuid.uuid4())
    name: str
    url: str
    branch: str = "master"
    trigger_token: Optional[str] = None
    private_token: Optional[str] = None
    project_id: Optional[str] = None  # GitLab Project ID (e.g. MetaLM/Metalm-NexusOps)
    description: Optional[str] = None
    created_at: datetime = datetime.now()

class Deployment(BaseModel):
    id: str = str(uuid.uuid4())
    name: str
    server_id: str
    repo_id: str
    created_at: datetime = datetime.now()

class History(BaseModel):
    id: str = str(uuid.uuid4())
    deployment_id: str
    pipeline_id: int
    status: str
    web_url: str
    created_at: datetime = datetime.now()
    server_snapshot: Optional[dict] = None
    repo_snapshot: Optional[dict] = None
    variables: Optional[dict] = None

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
    variables: Optional[dict] = None  # e.g. {"IMAGE_TAG": "v1.2.0"}
