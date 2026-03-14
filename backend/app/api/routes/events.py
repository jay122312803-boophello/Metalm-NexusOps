import json
import os
import uuid
from datetime import datetime

import anyio
import requests
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from sqlmodel import select

from ...db.models import Deployment, DeploymentHistory, Repo, TaskConfig, TaskConfigSnapshot, TaskConfigSnapshotFile
from ...db.session import run_db

router = APIRouter()


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.get("/history/{history_id}/events")
async def history_events(history_id: str):
    hid = uuid.UUID(history_id)

    async def _load_base():
        def _work(session):
            h = session.get(DeploymentHistory, hid)
            if not h:
                return None
            d = session.get(Deployment, h.deployment_id)
            r = session.get(Repo, d.repo_id) if d else None
            cfg_rows = session.exec(select(TaskConfig.rel_path).where(TaskConfig.deployment_id == h.deployment_id)).all()
            cfg_files = [x if isinstance(x, str) else x[0] for x in cfg_rows]
            return {
                "history": h,
                "repo": r,
                "deployment_id": str(h.deployment_id),
                "config_files": cfg_files,
            }

        return await run_db(_work)

    base = await _load_base()
    if not base:
        raise HTTPException(404, "History not found")

    gitlab_url = (os.getenv("GITLAB_BASE_URL") or "https://gitlab.xuelangyun.com").rstrip("/")
    verify_tls = (os.getenv("GITLAB_TLS_INSECURE") or "").strip() != "1"

    async def event_gen():
        last_status = None
        yield _sse(
            "init",
            {
                "history_id": history_id,
                "deployment_id": base["deployment_id"],
                "created_at": base["history"].created_at.isoformat() if base["history"].created_at else None,
                "config_files": base["config_files"],
            },
        )

        if base["config_files"]:
            yield _sse(
                "log",
                {"line": f"====== [NexusOps] 本次部署挂载配置 ({len(base['config_files'])}) ======"},
            )
            for p in base["config_files"][:50]:
                yield _sse("log", {"line": f"- {p}"})

        yield _sse("log", {"line": "====== [NexusOps] 开始监控 CI/CD 状态 ======"})

        while True:
            def _work(session):
                h = session.get(DeploymentHistory, hid)
                if not h:
                    return None
                return {
                    "pipeline_id": h.pipeline_id,
                    "status": h.status,
                    "web_url": h.web_url,
                    "ref": h.ref,
                }

            st = await run_db(_work)
            if not st:
                yield _sse("log", {"line": "!! History not found"})
                break

            status_now = st.get("status") or "unknown"
            if status_now != last_status:
                last_status = status_now
                yield _sse(
                    "status",
                    {
                        "status": status_now,
                        "pipeline_id": st.get("pipeline_id"),
                        "web_url": st.get("web_url"),
                        "ts": datetime.utcnow().isoformat(),
                    },
                )
                yield _sse("log", {"line": f">> Pipeline status: {status_now}"})

            if status_now in {"success", "failed", "canceled"}:
                yield _sse("log", {"line": f"====== [NexusOps] Pipeline finished: {status_now} ======"})
                break

            r = base["repo"]
            pid = st.get("pipeline_id")
            proj = ((r.project_id if r else None) or os.getenv("GITLAB_PROJECT") or "").strip()
            token = ((r.private_token if r else None) or "").strip() or (os.getenv("PRIVATE_TOKEN") or "").strip() or None
            if pid and proj and token:
                url = f"{gitlab_url}/api/v4/projects/{requests.utils.quote(proj, safe='')}/pipelines/{pid}"
                headers = {"PRIVATE-TOKEN": token}
                try:
                    resp = await anyio.to_thread.run_sync(lambda: requests.get(url, headers=headers, verify=verify_tls, timeout=8))
                    if resp.ok:
                        data = resp.json()
                        new_status = data.get("status")
                        new_web_url = data.get("web_url")
                        if new_status and new_status != st.get("status"):
                            def _update_work(session):
                                h = session.get(DeploymentHistory, hid)
                                if not h:
                                    return
                                h.status = new_status
                                h.web_url = new_web_url
                                session.add(h)
                                session.commit()

                            await run_db(_update_work)
                except Exception:
                    pass

            yield ":keepalive\n\n"
            await anyio.sleep(2)

    return StreamingResponse(event_gen(), media_type="text/event-stream")
