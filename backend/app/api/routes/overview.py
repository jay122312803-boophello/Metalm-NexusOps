import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter
from sqlmodel import select

from ...db.models import Deployment, DeploymentHistory, Repo, Server
from ...db.session import run_db

router = APIRouter()


def _env_key(name: str) -> str:
    s = (name or "").lower()
    if "生产" in name or "prod" in s:
        return "PROD"
    if "测试" in name or "test" in s:
        return "TEST"
    if "开发" in name or "dev" in s:
        return "DEV"
    return "OTHER"


@router.get("/overview")
async def get_overview():
    def _work(session):
        now = datetime.utcnow()
        today = now.date()
        yesterday = (now - timedelta(days=1)).date()
        cutoff = (now - timedelta(days=6)).date()
        cutoff_dt = datetime.combine(cutoff, datetime.min.time())

        rows = session.exec(
            select(DeploymentHistory.created_at, DeploymentHistory.status).where(DeploymentHistory.created_at >= cutoff_dt)
        ).all()

        trend = {}
        today_total = 0
        today_success = 0
        yesterday_total = 0
        for created_at, status in rows:
            if not created_at:
                continue
            d = created_at.date()
            if d < cutoff:
                continue
            key = d.isoformat()
            if key not in trend:
                trend[key] = {"date": key, "success": 0, "failed": 0, "total": 0}
            st = (status or "").lower()
            if st == "success":
                trend[key]["success"] += 1
            elif st == "failed":
                trend[key]["failed"] += 1
            trend[key]["total"] += 1

            if d == today:
                today_total += 1
                if st == "success":
                    today_success += 1
            if d == yesterday:
                yesterday_total += 1

        days = []
        for i in range(6, -1, -1):
            d = (today - timedelta(days=i)).isoformat()
            days.append(trend.get(d) or {"date": d, "success": 0, "failed": 0, "total": 0})

        sv_rows = session.exec(select(Server.id, Server.name, Server.environment).order_by(Server.name.asc())).all()
        server_total = len(sv_rows)
        server_online = server_total
        env_dist = {}
        for _, name, env in sv_rows:
            k = (env or "").strip().upper() or _env_key(name or "")
            if k not in {"PROD", "TEST", "DEV", "OTHER"}:
                k = "OTHER"
            env_dist[k] = env_dist.get(k, 0) + 1
        for k in ("PROD", "TEST", "DEV", "OTHER"):
            env_dist.setdefault(k, 0)

        repo_total = session.exec(select(Repo.id)).all()
        repo_count = len(repo_total)

        feed_rows = session.exec(
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
            )
            .join(Deployment, Deployment.id == DeploymentHistory.deployment_id)
            .join(Server, Server.id == Deployment.server_id)
            .join(Repo, Repo.id == Deployment.repo_id)
            .order_by(DeploymentHistory.created_at.desc())
            .limit(20)
        ).all()

        feed = []
        for hid, deployment_id, created_at, status, ref, dep_name, server_name, repo_name, repo_branch, pipeline_id in feed_rows:
            ts = created_at.isoformat() if created_at else None
            branch = (ref or repo_branch or "").strip() or None
            feed.append(
                {
                    "id": str(hid),
                    "deployment_id": str(deployment_id),
                    "created_at": ts,
                    "status": status,
                    "deployment_name": dep_name,
                    "server_name": server_name,
                    "repo_name": repo_name,
                    "branch": branch,
                    "pipeline_id": pipeline_id,
                }
            )

        success_rate = (today_success / today_total) if today_total else None
        delta = today_total - yesterday_total

        return {
            "ok": True,
            "metrics": {
                "deploy_today": today_total,
                "deploy_delta": delta,
                "success_rate_today": success_rate,
                "servers_online": server_online,
                "servers_total": server_total,
                "repos_total": repo_count,
            },
            "trend_7d": days,
            "env_dist": [{"key": k, "count": env_dist[k]} for k in ("PROD", "TEST", "DEV", "OTHER")],
            "feed": feed,
        }

    return await run_db(_work)
