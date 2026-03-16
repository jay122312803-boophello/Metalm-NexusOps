import json
import os
import uuid
from datetime import date, datetime, time, timedelta, timezone
from typing import Annotated
from zoneinfo import ZoneInfo

from langchain_core.tools import InjectedToolArg, tool
from sqlmodel import select, Session

from ..db.models import Deployment, DeploymentHistory, Repo, Server, TaskConfig
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

def query_list_servers(*, user_id: uuid.UUID, limit: int = 50) -> list[dict]:
    with Session(engine) as session:
        rows = session.exec(
            select(Server.id, Server.name, Server.environment, Server.address, Server.ssh_user)
            .where(Server.created_by_user_id == user_id)
            .order_by(Server.name.asc())
            .limit(limit)
        ).all()
        out = []
        for sid, name, env, address, ssh_user in rows:
            out.append(
                {
                    "id": str(sid),
                    "name": name,
                    "environment": env,
                    "address": address,
                    "ssh_user": ssh_user,
                }
            )
        return out

def _parse_iso_date(s: str) -> date | None:
    v = (s or "").strip()
    if not v:
        return None
    try:
        return datetime.fromisoformat(v).date()
    except Exception:
        return None

def query_deploy_stats_range(*, user_id: uuid.UUID, start_date: str, end_date: str, environment: str = "ALL") -> dict:
    tz = _get_app_tz()
    now_local = datetime.now(timezone.utc).astimezone(tz)
    d1 = _parse_iso_date(start_date) or now_local.date()
    d2 = _parse_iso_date(end_date) or d1
    if d2 < d1:
        d1, d2 = d2, d1
    start_local = datetime.combine(d1, time.min, tzinfo=tz)
    end_local = datetime.combine(d2, time.max, tzinfo=tz)
    start_dt = start_local.astimezone(timezone.utc).replace(tzinfo=None)
    end_dt = end_local.astimezone(timezone.utc).replace(tzinfo=None)
    env = (environment or "ALL").strip().upper()
    if env not in {"DEV", "TEST", "PROD", "OTHER", "ALL"}:
        env = "ALL"

    with Session(engine) as session:
        q = (
            select(DeploymentHistory.created_at, DeploymentHistory.status)
            .join(Deployment, Deployment.id == DeploymentHistory.deployment_id)
            .join(Server, Server.id == Deployment.server_id)
            .where(Deployment.created_by_user_id == user_id)
            .where(DeploymentHistory.created_at >= start_dt)
            .where(DeploymentHistory.created_at <= end_dt)
        )
        if env != "ALL":
            q = q.where(Server.environment == env)
        rows = session.exec(q).all()
        total = 0
        success = 0
        failed = 0
        for created_at, status in rows:
            if not created_at:
                continue
            created_utc = created_at if created_at.tzinfo else created_at.replace(tzinfo=timezone.utc)
            if created_utc < start_local.astimezone(timezone.utc) or created_utc > end_local.astimezone(timezone.utc):
                continue
            total += 1
            st = (status or "").lower()
            if st == "success":
                success += 1
            elif st == "failed":
                failed += 1
        rate = (success / total) if total else None
        return {
            "start_date": d1.isoformat(),
            "end_date": d2.isoformat(),
            "environment": env,
            "deploy_total": total,
            "deploy_success": success,
            "deploy_failed": failed,
            "success_rate": f"{(rate*100):.1f}%" if rate is not None else "N/A",
        }

def query_list_task_configs(*, user_id: uuid.UUID, deployment_name: str) -> dict:
    with Session(engine) as session:
        d = session.exec(
            select(Deployment)
            .where(Deployment.created_by_user_id == user_id)
            .where(Deployment.name == deployment_name)
        ).first()
        if not d:
            return {"ok": False, "error": "Deployment not found"}
        rows = session.exec(
            select(TaskConfig.rel_path).where(TaskConfig.deployment_id == d.id).order_by(TaskConfig.rel_path.asc())
        ).all()
        files = [x if isinstance(x, str) else x[0] for x in rows]
        return {"ok": True, "deployment_id": str(d.id), "deployment_name": d.name, "files": files}

def query_list_history(*, user_id: uuid.UUID, days: int = 7, status: str = "all", limit: int = 50) -> dict:
    tz = _get_app_tz()
    now_local = datetime.now(timezone.utc).astimezone(tz)
    cutoff = (now_local - timedelta(days=max(0, int(days) - 1))).date()
    cutoff_local_start = datetime.combine(cutoff, time.min, tzinfo=tz)
    cutoff_dt = cutoff_local_start.astimezone(timezone.utc).replace(tzinfo=None)
    st = (status or "all").strip().lower()
    with Session(engine) as session:
        q = (
            select(
                DeploymentHistory.id,
                DeploymentHistory.deployment_id,
                DeploymentHistory.created_at,
                DeploymentHistory.status,
                DeploymentHistory.ref,
                Deployment.name,
                Server.name,
                Repo.name,
                Repo.branch,
                DeploymentHistory.pipeline_id,
                DeploymentHistory.web_url,
            )
            .join(Deployment, Deployment.id == DeploymentHistory.deployment_id)
            .join(Server, Server.id == Deployment.server_id)
            .join(Repo, Repo.id == Deployment.repo_id)
            .where(Deployment.created_by_user_id == user_id)
            .where(DeploymentHistory.created_at >= cutoff_dt)
            .order_by(DeploymentHistory.created_at.desc())
            .limit(max(1, min(200, int(limit))))
        )
        if st != "all":
            q = q.where(DeploymentHistory.status == st)
        rows = session.exec(q).all()
        items = []
        for hid, deployment_id, created_at, status_now, ref, dep_name, server_name, repo_name, repo_branch, pipeline_id, web_url in rows:
            ts = None
            if created_at:
                created_utc = created_at if created_at.tzinfo else created_at.replace(tzinfo=timezone.utc)
                ts = created_utc.isoformat()
            branch = (ref or repo_branch or "").strip() or None
            items.append(
                {
                    "history_id": str(hid),
                    "deployment_id": str(deployment_id),
                    "created_at": ts,
                    "status": status_now,
                    "deployment_name": dep_name,
                    "server_name": server_name,
                    "repo_name": repo_name,
                    "branch": branch,
                    "pipeline_id": pipeline_id,
                    "web_url": web_url,
                }
            )
        return {"ok": True, "days": int(days), "status": st, "items": items}

def query_history_detail(*, user_id: uuid.UUID, history_id: str) -> dict:
    try:
        hid = uuid.UUID(str(history_id))
    except Exception:
        return {"ok": False, "error": "Invalid history_id"}
    with Session(engine) as session:
        h = session.get(DeploymentHistory, hid)
        if not h:
            return {"ok": False, "error": "History not found"}
        d = session.get(Deployment, h.deployment_id)
        if not d or d.created_by_user_id != user_id:
            return {"ok": False, "error": "History not found"}
        s = session.get(Server, d.server_id)
        r = session.get(Repo, d.repo_id)
        tail = ""
        try:
            ss = h.server_snapshot or {}
            tail = str(ss.get("log_tail") or "")
        except Exception:
            tail = ""
        lines = [x for x in tail.splitlines() if x]
        tail_last = "\n".join(lines[-200:]) if lines else ""
        return {
            "ok": True,
            "history_id": str(h.id),
            "deployment_id": str(h.deployment_id),
            "deployment_name": d.name,
            "server_name": s.name if s else None,
            "repo_name": r.name if r else None,
            "created_at": h.created_at.isoformat() if h.created_at else None,
            "status": h.status,
            "pipeline_id": h.pipeline_id,
            "web_url": h.web_url,
            "ref": h.ref,
            "log_tail": tail_last,
        }

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
    deployment_name: Annotated[str, "部署项目名称（如：nexus-ops-backend）。"],
    config: Annotated[dict, InjectedToolArg]
) -> str:
    """
    查询某个部署项目最新一次部署状态。
    返回字段包含：status、last_updated、pipeline_id、web_url、ref。
    """
    try:
        user_id = _get_user_id(config)
        result = query_deployment_status(user_id=user_id, deployment_name=deployment_name)
        return _truncate_output(result)
    except Exception as e:
        return json.dumps({"error": f"Internal error querying deployment status: {str(e)}"})

@tool
def list_deployments(
    config: Annotated[dict, InjectedToolArg],
    limit: Annotated[int, "最多返回多少个最近部署项目（默认 5）。"] = 5,
) -> str:
    """
    列出当前账号最近的部署项目，用于在用户不知道项目名时给出候选列表。
    返回字段包含：name、server、created_at。
    """
    try:
        user_id = _get_user_id(config)
        result = query_list_deployments(user_id=user_id, limit=limit)
        return _truncate_output(result)
    except Exception as e:
        return json.dumps({"error": f"Internal error listing deployments: {str(e)}"})

@tool
def get_server_resources(
    server_name: Annotated[str, "服务器名称（如：生产环境-01、prod-db-01）。"],
    config: Annotated[dict, InjectedToolArg]
) -> str:
    """
    查询服务器基础信息（来自平台数据库，不做远端采集）。
    返回字段包含：name、address、environment、ssh_user。
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
    查询系统概览（与概览页口径一致：按系统时区折算到“今天”）。
    返回字段包含：deployments_today、success_rate_today、total_servers。
    """
    try:
        user_id = _get_user_id(config)
        result = query_system_overview(user_id=user_id)
        return _truncate_output(result)
    except Exception as e:
        return json.dumps({"error": f"Internal error getting system overview: {str(e)}"})

@tool
def list_servers(
    config: Annotated[dict, InjectedToolArg],
    limit: Annotated[int, "最多返回多少台服务器（默认 20）。"] = 20,
) -> str:
    """
    列出当前账号管理的服务器清单（名称、环境、地址等基础信息）。
    当用户不知道服务器名称时使用。
    """
    try:
        user_id = _get_user_id(config)
        result = query_list_servers(user_id=user_id, limit=int(limit))
        return _truncate_output(result)
    except Exception as e:
        return json.dumps({"error": f"Internal error listing servers: {str(e)}"})

@tool
def get_deploy_stats(
    config: Annotated[dict, InjectedToolArg],
    start_date: Annotated[str, "开始日期（YYYY-MM-DD）。为空则默认今天。"] = "",
    end_date: Annotated[str, "结束日期（YYYY-MM-DD）。为空则默认等于开始日期。"] = "",
    environment: Annotated[str, "环境过滤：DEV/TEST/PROD/OTHER/ALL（默认 ALL）。"] = "ALL",
) -> str:
    """
    查询指定日期范围的部署统计（与概览页口径一致：按系统时区折算到日期）。
    适用于“某天/某段时间部署了多少次、成功率多少”。
    返回字段包含：deploy_total、deploy_success、deploy_failed、success_rate、start_date、end_date、environment。
    """
    try:
        user_id = _get_user_id(config)
        result = query_deploy_stats_range(user_id=user_id, start_date=start_date, end_date=end_date, environment=environment)
        return _truncate_output(result)
    except Exception as e:
        return json.dumps({"error": f"Internal error getting deploy stats: {str(e)}"})

@tool
def list_deployment_task_configs(
    config: Annotated[dict, InjectedToolArg],
    deployment_name: Annotated[str, "部署名称（必填）。"] = "",
) -> str:
    """
    查询某个部署当前的配置文件清单（TaskConfig 列表）。
    用于回答“该部署挂载了哪些配置文件”。
    """
    try:
        user_id = _get_user_id(config)
        result = query_list_task_configs(user_id=user_id, deployment_name=str(deployment_name or "").strip())
        return _truncate_output(result, max_len=2000)
    except Exception as e:
        return json.dumps({"error": f"Internal error listing deployment configs: {str(e)}"})

@tool
def list_audit_deployments(
    config: Annotated[dict, InjectedToolArg],
    days: Annotated[int, "查询最近 N 天的部署审计记录（默认 7）。"] = 7,
    status: Annotated[str, "状态过滤：success/failed/running/pending/canceled/all（默认 all）。"] = "all",
    limit: Annotated[int, "最多返回多少条（默认 50）。"] = 50,
) -> str:
    """
    查询审计日志（部署历史）列表。
    返回字段包含：history_id、deployment_name、server_name、repo_name、branch、status、created_at、pipeline_id、web_url。
    """
    try:
        user_id = _get_user_id(config)
        result = query_list_history(user_id=user_id, days=int(days), status=str(status or "all"), limit=int(limit))
        return _truncate_output(result, max_len=3000)
    except Exception as e:
        return json.dumps({"error": f"Internal error listing audit deployments: {str(e)}"})

@tool
def get_audit_deployment_detail(
    config: Annotated[dict, InjectedToolArg],
    history_id: Annotated[str, "部署历史 ID（UUID）。"] = "",
) -> str:
    """
    查询某条审计记录详情（部署/服务器/仓库信息、状态、pipeline，以及保存的日志尾部）。
    log_tail 最多返回 200 行。
    """
    try:
        user_id = _get_user_id(config)
        result = query_history_detail(user_id=user_id, history_id=str(history_id or "").strip())
        return _truncate_output(result, max_len=4000)
    except Exception as e:
        return json.dumps({"error": f"Internal error getting audit detail: {str(e)}"})

ALL_TOOLS = [
    get_deployment_status,
    list_deployments,
    get_server_resources,
    get_system_overview,
    list_servers,
    get_deploy_stats,
    list_deployment_task_configs,
    list_audit_deployments,
    get_audit_deployment_detail,
]
