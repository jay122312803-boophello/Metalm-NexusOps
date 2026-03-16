import json
import os
import uuid
from datetime import datetime, time, timedelta, timezone
from typing import Annotated
from zoneinfo import ZoneInfo

from langchain_core.tools import InjectedToolArg, tool
from sqlmodel import select, Session

from ..db.models import Deployment, DeploymentHistory, Server
from ..db.session import engine

def _get_user_id(config: dict) -> uuid.UUID:
    """Helper to extract user_id from config"""
    config = config or {}
    user_id = config.get("configurable", {}).get("user_id")
    if user_id:
        return uuid.UUID(str(user_id))
    raise ValueError("User context required: 'user_id' not found in config")

def _truncate_output(data: dict | list | str, max_len: int = 1000) -> str:
    """Helper to truncate large JSON outputs"""
    s = json.dumps(data, ensure_ascii=False)
    if len(s) > max_len:
        return s[:max_len] + f"... (truncated, total {len(s)} chars)"
    return s

def _get_app_tz():
    name = (os.getenv("NEXUSOPS_TZ") or os.getenv("TZ") or "Asia/Shanghai").strip()
    try:
        return ZoneInfo(name)
    except Exception:
        if name in {"Asia/Shanghai", "PRC", "CST"}:
            return timezone(timedelta(hours=8))
        return timezone.utc

def query_deployment_status(*, user_id: uuid.UUID, deployment_name: str) -> dict:
    with Session(engine) as session:
        dep = session.exec(
            select(Deployment)
            .where(Deployment.created_by_user_id == user_id)
            .where(Deployment.name == deployment_name)
        ).first()
        if not dep:
            return {"error": f"Deployment project '{deployment_name}' not found. Please verify the project name."}

        hist = session.exec(
            select(DeploymentHistory)
            .where(DeploymentHistory.deployment_id == dep.id)
            .order_by(DeploymentHistory.created_at.desc())
            .limit(1)
        ).first()
        if not hist:
            return {"status": "never_deployed", "deployment_id": str(dep.id)}

        return {
            "deployment_name": dep.name,
            "status": hist.status,
            "last_updated": hist.created_at.isoformat() if hist.created_at else None,
            "pipeline_id": hist.pipeline_id,
            "web_url": hist.web_url,
            "ref": hist.ref,
        }

def query_list_deployments(*, user_id: uuid.UUID, limit: int = 5) -> list[dict]:
    with Session(engine) as session:
        deps = session.exec(
            select(Deployment, Server.name)
            .join(Server, Server.id == Deployment.server_id)
            .where(Deployment.created_by_user_id == user_id)
            .order_by(Deployment.created_at.desc())
            .limit(limit)
        ).all()
        return [
            {"name": d.name, "server": s_name, "created_at": d.created_at.isoformat() if d.created_at else None}
            for d, s_name in deps
        ]

def query_server_resources(*, user_id: uuid.UUID, server_name: str) -> dict:
    with Session(engine) as session:
        server = session.exec(
            select(Server)
            .where(Server.created_by_user_id == user_id)
            .where(Server.name == server_name)
        ).first()
        if not server:
            return {"error": f"Server '{server_name}' not found. Please verify the server name."}
        return {"name": server.name, "address": server.address, "environment": server.environment, "ssh_user": server.ssh_user}

def query_system_overview(*, user_id: uuid.UUID) -> dict:
    with Session(engine) as session:
        tz = _get_app_tz()
        now_local = datetime.now(timezone.utc).astimezone(tz)
        today = now_local.date()
        cutoff = (now_local - timedelta(days=6)).date()
        cutoff_local_start = datetime.combine(cutoff, time.min, tzinfo=tz)
        cutoff_dt = cutoff_local_start.astimezone(timezone.utc).replace(tzinfo=None)

        rows = session.exec(
            select(DeploymentHistory.created_at, DeploymentHistory.status)
            .join(Deployment, Deployment.id == DeploymentHistory.deployment_id)
            .where(DeploymentHistory.created_at >= cutoff_dt, Deployment.created_by_user_id == user_id)
        ).all()

        today_total = 0
        today_success = 0
        for created_at, status in rows:
            if not created_at:
                continue
            created_utc = created_at if created_at.tzinfo else created_at.replace(tzinfo=timezone.utc)
            d = created_utc.astimezone(tz).date()
            if d < cutoff:
                continue
            st = (status or "").lower()
            if d == today:
                today_total += 1
                if st == "success":
                    today_success += 1

        server_count = session.exec(select(Server).where(Server.created_by_user_id == user_id)).all()
        success_rate = (today_success / today_total) if today_total else None
        return {
            "total_servers": len(server_count),
            "deployments_today": today_total,
            "success_rate_today": f"{(success_rate*100):.1f}%" if success_rate is not None else "N/A",
        }

@tool
def get_deployment_status(
    deployment_name: Annotated[str, "The exact name of the deployment project (e.g., 'nexus-ops-backend')."],
    config: Annotated[dict, InjectedToolArg]
) -> str:
    """
    Get the latest status of a specific deployment by name.
    
    Returns a JSON summary including:
    - status: (success/failed/running)
    - last_updated: Timestamp
    - pipeline_id: CI/CD pipeline ID
    - web_url: Link to the deployment logs
    """
    try:
        user_id = _get_user_id(config)
        result = query_deployment_status(user_id=user_id, deployment_name=deployment_name)
        return _truncate_output(result)
    except Exception as e:
        return json.dumps({"error": f"Internal error querying deployment status: {str(e)}"})

@tool
def list_deployments(
    limit: Annotated[int, "Max number of recent deployments to return. Default is 5."] = 5,
    config: Annotated[dict, InjectedToolArg] = None
) -> str:
    """
    List the most recent deployment projects for the current user.
    Use this to help the user find valid deployment names if they are unsure.
    """
    try:
        user_id = _get_user_id(config)
        result = query_list_deployments(user_id=user_id, limit=limit)
        return _truncate_output(result)
    except Exception as e:
        return json.dumps({"error": f"Internal error listing deployments: {str(e)}"})

@tool
def get_server_resources(
    server_name: Annotated[str, "The exact name of the server to inspect (e.g., 'prod-db-01')."],
    config: Annotated[dict, InjectedToolArg]
) -> str:
    """
    Get basic resource information for a server (IP, environment, SSH user).
    Note: Real-time CPU/Memory stats are not currently available via this tool.
    """
    try:
        user_id = _get_user_id(config)
        result = query_server_resources(user_id=user_id, server_name=server_name)
        return _truncate_output(result)
    except Exception as e:
        return json.dumps({"error": f"Internal error fetching server resources: {str(e)}"})

@tool
def get_system_overview(
    config: Annotated[dict, InjectedToolArg]
) -> str:
    """
    Get a high-level overview of the system status for the current user.
    Includes:
    - Total number of managed servers
    - Number of deployments performed today
    - Success rate of today's deployments
    """
    try:
        user_id = _get_user_id(config)
        result = query_system_overview(user_id=user_id)
        return _truncate_output(result)
    except Exception as e:
        return json.dumps({"error": f"Internal error getting system overview: {str(e)}"})

ALL_TOOLS = [get_deployment_status, list_deployments, get_server_resources, get_system_overview]
