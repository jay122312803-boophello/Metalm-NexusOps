from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional, Dict

from sqlalchemy import Column
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class Server(SQLModel, table=True):
    __tablename__ = "servers"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    name: str
    address: str
    ssh_user: str = Field(default="metalm")
    deploy_path: str
    description: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class Repo(SQLModel, table=True):
    __tablename__ = "repos"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    name: str
    url: str
    branch: str = Field(default="master")
    project_id: Optional[str] = None
    trigger_token: Optional[str] = None
    private_token: Optional[str] = None
    description: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class Deployment(SQLModel, table=True):
    __tablename__ = "deployments"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    name: str
    server_id: uuid.UUID
    repo_id: uuid.UUID
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class DeploymentHistory(SQLModel, table=True):
    __tablename__ = "deployment_history"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    deployment_id: uuid.UUID
    pipeline_id: Optional[int] = None
    status: Optional[str] = None
    ref: Optional[str] = None
    web_url: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    finished_at: Optional[datetime] = None

    server_snapshot: Optional[Dict[str, Any]] = Field(default=None, sa_column=Column(JSONB))
    repo_snapshot: Optional[Dict[str, Any]] = Field(default=None, sa_column=Column(JSONB))
    variables: Optional[Dict[str, Any]] = Field(default=None, sa_column=Column(JSONB))

