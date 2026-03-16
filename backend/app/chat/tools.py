import json
import uuid
from datetime import datetime, timezone
from typing import Annotated, Literal

from langchain_core.tools import tool
from sqlmodel import select, Session

from ..db.models import Deployment, DeploymentHistory, Server, Repo, AIModelConfig
from ..db.session import engine

def _get_user_id(config: dict) -> uuid.UUID:
    """Helper to extract user_id from config"""
    # Try to get from configurable first (LangGraph standard)
    user_id = config.get("configurable", {}).get("user_id")
    if user_id:
        return uuid.UUID(str(user_id))
    
    # Fallback: check if 'user_context' is passed directly in some custom way (less likely in standard ToolNode)
    # But for safety, we just rely on configurable
    raise ValueError("User context required: 'user_id' not found in config")

def _truncate_output(data: dict | list | str, max_len: int = 1000) -> str:
    """Helper to truncate large JSON outputs"""
    s = json.dumps(data, ensure_ascii=False)
    if len(s) > max_len:
        return s[:max_len] + f"... (truncated, total {len(s)} chars)"
    return s

@tool
def get_deployment_status(
    deployment_name: Annotated[str, "The exact name of the deployment project (e.g., 'nexus-ops-backend')."],
    config: Annotated[dict, "Injected configuration"]
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
        with Session(engine) as session:
            # Find deployment by name for this user
            dep = session.exec(
                select(Deployment)
                .where(Deployment.created_by_user_id == user_id)
                .where(Deployment.name == deployment_name)
            ).first()
            
            if not dep:
                return json.dumps({"error": f"Deployment project '{deployment_name}' not found. Please verify the project name."})

            # Get latest history
            hist = session.exec(
                select(DeploymentHistory)
                .where(DeploymentHistory.deployment_id == dep.id)
                .order_by(DeploymentHistory.created_at.desc())
                .limit(1)
            ).first()

            if not hist:
                return json.dumps({"status": "never_deployed", "deployment_id": str(dep.id)})

            result = {
                "deployment_name": dep.name,
                "status": hist.status,
                "last_updated": hist.created_at.isoformat() if hist.created_at else None,
                "pipeline_id": hist.pipeline_id,
                "web_url": hist.web_url,
                "ref": hist.ref
            }
            return _truncate_output(result)
    except Exception as e:
        return json.dumps({"error": f"Internal error querying deployment status: {str(e)}"})

@tool
def list_deployments(
    limit: Annotated[int, "Max number of recent deployments to return. Default is 5."] = 5,
    config: Annotated[dict, "Injected configuration"] = {}
) -> str:
    """
    List the most recent deployment projects for the current user.
    Use this to help the user find valid deployment names if they are unsure.
    """
    try:
        user_id = _get_user_id(config)
        with Session(engine) as session:
            deps = session.exec(
                select(Deployment, Server.name)
                .join(Server, Server.id == Deployment.server_id)
                .where(Deployment.created_by_user_id == user_id)
                .order_by(Deployment.created_at.desc())
                .limit(limit)
            ).all()
            
            result = [
                {
                    "name": d.name,
                    "server": s_name,
                    "created_at": d.created_at.isoformat() if d.created_at else None
                }
                for d, s_name in deps
            ]
            return _truncate_output(result)
    except Exception as e:
        return json.dumps({"error": f"Internal error listing deployments: {str(e)}"})

@tool
def get_server_resources(
    server_name: Annotated[str, "The exact name of the server to inspect (e.g., 'prod-db-01')."],
    config: Annotated[dict, "Injected configuration"]
) -> str:
    """
    Get basic resource information for a server (IP, environment, SSH user).
    Note: Real-time CPU/Memory stats are not currently available via this tool.
    """
    try:
        user_id = _get_user_id(config)
        with Session(engine) as session:
            server = session.exec(
                select(Server)
                .where(Server.created_by_user_id == user_id)
                .where(Server.name == server_name)
            ).first()
            
            if not server:
                return json.dumps({"error": f"Server '{server_name}' not found. Please verify the server name."})
                
            result = {
                "name": server.name,
                "address": server.address,
                "environment": server.environment,
                "ssh_user": server.ssh_user
            }
            return _truncate_output(result)
    except Exception as e:
        return json.dumps({"error": f"Internal error fetching server resources: {str(e)}"})

@tool
def get_system_overview(
    config: Annotated[dict, "Injected configuration"]
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
        # Re-implementing simplified logic from overview.py
        with Session(engine) as session:
            # Count servers
            server_count = session.exec(
                select(Server).where(Server.created_by_user_id == user_id)
            ).all()
            
            # Count today's deployments
            now = datetime.now(timezone.utc)
            today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
            
            deps = session.exec(
                select(DeploymentHistory)
                .join(Deployment)
                .where(Deployment.created_by_user_id == user_id)
                .where(DeploymentHistory.created_at >= today_start)
            ).all()
            
            total = len(deps)
            success = len([d for d in deps if d.status == 'success'])
            
            result = {
                "total_servers": len(server_count),
                "deployments_today": total,
                "success_rate_today": f"{(success/total*100):.1f}%" if total > 0 else "N/A"
            }
            return _truncate_output(result)
    except Exception as e:
        return json.dumps({"error": f"Internal error getting system overview: {str(e)}"})

ALL_TOOLS = [get_deployment_status, list_deployments, get_server_resources, get_system_overview]
