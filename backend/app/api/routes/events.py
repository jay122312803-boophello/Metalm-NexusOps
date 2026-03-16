import json
import os
import uuid
from datetime import datetime

import anyio
import requests
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlmodel import select

from ...auth.deps import require_permission
from ...db.models import Deployment, DeploymentHistory, Repo, TaskConfig, TaskConfigSnapshot, TaskConfigSnapshotFile
from ...db.session import run_db
from .configs import ensure_snapshot, ensure_snapshot_if_success

router = APIRouter()


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


async def _append_history_log_tail(history_id: uuid.UUID, lines: list[str]) -> None:
    if not lines:
        return

    def _work(session):
        h = session.get(DeploymentHistory, history_id)
        if not h:
            return
        ss = h.server_snapshot or {}
        tail = str(ss.get("log_tail") or "")
        add = "\n".join([str(x) for x in lines if x is not None and str(x) != ""]).strip("\n")
        if add:
            tail = f"{tail}\n{add}" if tail else add
        limit = 200000
        if len(tail) > limit:
            tail = tail[-limit:]
        ss["log_tail"] = tail
        h.server_snapshot = ss
        session.add(h)
        session.commit()

    await run_db(_work)


@router.get("/history/{history_id}/events")
async def history_events(history_id: str, user=Depends(require_permission("audit:read"))):
    hid = uuid.UUID(history_id)
    try:
        await ensure_snapshot(hid)
    except Exception:
        pass

    async def _load_base():
        def _work(session):
            h = session.get(DeploymentHistory, hid)
            if not h:
                return None
            d = session.get(Deployment, h.deployment_id)
            if not d or d.created_by_user_id != user.id:
                return None
            r = session.get(Repo, d.repo_id) if d else None
            ci_repo = None
            try:
                snap = h.repo_snapshot or {}
                if isinstance(snap, dict):
                    ci_repo_id = str(snap.get("ci_repo_id") or "").strip()
                    if ci_repo_id:
                        ci_repo = session.get(Repo, uuid.UUID(ci_repo_id))
            except Exception:
                ci_repo = None
            snap = session.exec(select(TaskConfigSnapshot).where(TaskConfigSnapshot.history_id == hid)).first()
            if snap:
                cfg_rows = session.exec(
                    select(TaskConfigSnapshotFile.rel_path).where(TaskConfigSnapshotFile.snapshot_id == snap.id).order_by(TaskConfigSnapshotFile.rel_path.asc())
                ).all()
            else:
                cfg_rows = session.exec(select(TaskConfig.rel_path).where(TaskConfig.deployment_id == h.deployment_id)).all()
            cfg_files = [x if isinstance(x, str) else x[0] for x in cfg_rows]
            return {
                "history": h,
                "repo": r,
                "ci_repo": ci_repo,
                "deployment_id": str(h.deployment_id),
                "config_files": cfg_files,
            }

        return await run_db(_work)

    base = await _load_base()
    if not base:
        raise HTTPException(404, "History not found")

    gitlab_url = (os.getenv("GITLAB_BASE_URL") or "https://gitlab.xuelangyun.com").rstrip("/")
    verify_tls = (os.getenv("GITLAB_TLS_INSECURE") or "").strip() != "1"
    enable_trace = (os.getenv("NEXUSOPS_SSE_TRACE") or "1").strip() != "0"

    async def event_gen():
        try:
            last_status = None
            last_pipeline_id = None
            last_job_poll_ts = 0.0
            jobs: list[dict] = []
            job_offsets: dict[int, int] = {}
            job_announced: set[int] = set()
            pending_logs: list[str] = []
            last_flush_ts = anyio.current_time()
            warned_missing_pipeline = False
            warned_missing_proj = False
            warned_missing_token = False
            warned_jobs_fetch = False
            warned_trace_fetch: set[int] = set()

            saved_tail = ""
            try:
                ss = base["history"].server_snapshot or {}
                saved_tail = str(ss.get("log_tail") or "")
            except Exception:
                saved_tail = ""
            persist_enabled = True
            try:
                if saved_tail and (base["history"].status or "") in {"success", "failed", "canceled"}:
                    persist_enabled = False
            except Exception:
                pass

            async def _flush(force: bool = False):
                nonlocal last_flush_ts
                if not persist_enabled:
                    pending_logs.clear()
                    return
                if not pending_logs:
                    return
                now = anyio.current_time()
                if not force and (len(pending_logs) < 120 and now - last_flush_ts < 3.0):
                    return
                await _append_history_log_tail(hid, pending_logs)
                pending_logs.clear()
                last_flush_ts = now

            def _log(line: str) -> str:
                pending_logs.append(line)
                return _sse("log", {"line": line})

            yield _sse(
                "init",
                {
                    "history_id": history_id,
                    "deployment_id": base["deployment_id"],
                    "created_at": base["history"].created_at.isoformat() if base["history"].created_at else None,
                    "config_files": base["config_files"],
                    "pipeline_id": base["history"].pipeline_id,
                    "status": base["history"].status,
                },
            )

            if saved_tail:
                yield _log("====== [NexusOps] 历史日志回放 ======")
                for line in saved_tail.splitlines()[-2000:]:
                    if line:
                        yield _log(line)
                yield _log("====== [NexusOps] 历史日志回放结束 ======")
                await _flush(force=True)


            if base["config_files"]:
                yield _log(f"====== [NexusOps] 本次部署挂载配置 ({len(base['config_files'])}) ======")
                for p in base["config_files"][:50]:
                    yield _log(f"- {p}")

            yield _log("====== [NexusOps] 开始监控 CI/CD 状态 ======")
            await _flush(force=True)

            async def _gitlab_get(url: str, token: str, headers: dict | None = None):
                h = {"PRIVATE-TOKEN": token}
                if headers:
                    h.update(headers)
                return await anyio.to_thread.run_sync(
                    lambda: requests.get(url, headers=h, verify=verify_tls, timeout=12)
                )

            async def _refresh_jobs(proj: str, pid: int, token: str) -> list[dict]:
                url = f"{gitlab_url}/api/v4/projects/{requests.utils.quote(proj, safe='')}/pipelines/{pid}/jobs?per_page=100"
                resp = await _gitlab_get(url, token)
                if not resp.ok:
                    return []
                data = resp.json()
                return data if isinstance(data, list) else []

            async def _read_job_trace(proj: str, job_id: int, token: str, start: int) -> tuple[str, int]:
                url = f"{gitlab_url}/api/v4/projects/{requests.utils.quote(proj, safe='')}/jobs/{job_id}/trace"
                resp = await _gitlab_get(url, token, headers={"Range": f"bytes={start}-"})
                if resp.status_code == 416:
                    return "", start
                if not resp.ok:
                    return "", start
                raw = resp.content or b""
                if start > 0 and resp.status_code == 200:
                    raw = raw[start:] if start < len(raw) else b""
                    return raw.decode("utf-8", errors="replace"), max(start, len(resp.content or b""))
                return raw.decode("utf-8", errors="replace"), start + len(raw)

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
                    yield _sse("done", {"reason": "not_found", "ts": datetime.utcnow().isoformat()})
                    break

                status_now = st.get("status") or "unknown"
                pipeline_id = st.get("pipeline_id")
                if status_now != last_status:
                    last_status = status_now
                    yield _sse(
                        "status",
                        {
                            "status": status_now,
                            "pipeline_id": pipeline_id,
                            "web_url": st.get("web_url"),
                            "ts": datetime.utcnow().isoformat(),
                        },
                    )
                    yield _log(f">> Pipeline status: {status_now}")
                    await _flush(force=True)

                rr = base.get("ci_repo") or base.get("repo")
                proj = ((rr.project_id if rr else None) or os.getenv("GITLAB_PROJECT") or "").strip()
                token = ((rr.private_token if rr else None) or "").strip() or (os.getenv("PRIVATE_TOKEN") or "").strip() or None

                if enable_trace and not pipeline_id and not warned_missing_pipeline:
                    warned_missing_pipeline = True
                    yield _log("!! 未获取到 pipeline_id，无法回放/拉取 CI/CD 日志")
                    await _flush()
                if enable_trace and pipeline_id and not proj and not warned_missing_proj:
                    warned_missing_proj = True
                    yield _log("!! 未配置 GitLab Project ID，无法回放/拉取 CI/CD 日志")
                    await _flush()
                if enable_trace and pipeline_id and proj and not token and not warned_missing_token:
                    warned_missing_token = True
                    yield _log("!! 未配置 GitLab PRIVATE_TOKEN，无法获取 CI/CD 任务日志")
                    await _flush()

                if enable_trace and pipeline_id and proj and token:
                    if last_pipeline_id != pipeline_id:
                        jobs = []
                        job_offsets = {}
                        job_announced = set()
                        last_pipeline_id = pipeline_id
                        last_job_poll_ts = 0.0
                        warned_jobs_fetch = False
                        warned_trace_fetch = set()

                    now = anyio.current_time()
                    if not jobs or now - last_job_poll_ts >= 5.0:
                        url = f"{gitlab_url}/api/v4/projects/{requests.utils.quote(proj, safe='')}/pipelines/{int(pipeline_id)}/jobs?per_page=100"
                        resp = await _gitlab_get(url, token)
                        if not resp.ok:
                            if not warned_jobs_fetch:
                                warned_jobs_fetch = True
                                yield _log(f"!! 拉取 GitLab jobs 失败: HTTP {resp.status_code}")
                                await _flush()
                            jobs = []
                        else:
                            data = resp.json()
                            jobs = data if isinstance(data, list) else []
                        last_job_poll_ts = now

                    emitted = 0
                    for j in jobs:
                        jid = int(j.get("id") or 0)
                        if not jid:
                            continue
                        if jid not in job_offsets:
                            job_offsets[jid] = 0
                        if jid not in job_announced:
                            name = (j.get("name") or "job").strip()
                            stj = (j.get("status") or "").strip() or "unknown"
                            yield _log(f"====== [GitLab Job] {name} ({stj}) ======")
                            job_announced.add(jid)

                        url = f"{gitlab_url}/api/v4/projects/{requests.utils.quote(proj, safe='')}/jobs/{jid}/trace"
                        resp = await _gitlab_get(url, token, headers={"Range": f"bytes={job_offsets[jid]}-"})
                        if resp.status_code == 416:
                            chunk = ""
                            next_off = job_offsets[jid]
                        elif not resp.ok:
                            if jid not in warned_trace_fetch:
                                warned_trace_fetch.add(jid)
                                yield _log(f"!! 拉取 GitLab trace 失败(job {jid}): HTTP {resp.status_code}")
                            chunk = ""
                            next_off = job_offsets[jid]
                        else:
                            raw = resp.content or b""
                            if job_offsets[jid] > 0 and resp.status_code == 200:
                                raw = raw[job_offsets[jid] :] if job_offsets[jid] < len(raw) else b""
                                chunk = raw.decode("utf-8", errors="replace")
                                next_off = max(job_offsets[jid], len(resp.content or b""))
                            else:
                                chunk = raw.decode("utf-8", errors="replace")
                                next_off = job_offsets[jid] + len(raw)
                        job_offsets[jid] = next_off
                        if not chunk:
                            continue
                        for line in chunk.splitlines():
                            if not line:
                                continue
                            yield _log(line)
                            emitted += 1
                            if emitted >= 400:
                                break
                        if emitted >= 400:
                            break
                    await _flush()
                elif not enable_trace:
                    yield _log("!! 已禁用 CI/CD trace 拉取（NEXUSOPS_SSE_TRACE=0）")
                    await _flush()

                if status_now in {"success", "failed", "canceled"}:
                    if status_now == "success":
                        try:
                            await ensure_snapshot_if_success(hid)
                        except Exception:
                            pass
                    yield _log(f"====== [NexusOps] Pipeline finished: {status_now} ======")
                    await _flush(force=True)
                    yield _sse("done", {"status": status_now, "ts": datetime.utcnow().isoformat()})
                    break

                pid = pipeline_id
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
        except anyio.get_cancelled_exc_class():
            try:
                await _append_history_log_tail(hid, pending_logs)
            except Exception:
                pass
            return
        except Exception as e:
            try:
                yield _sse("log", {"line": f"!! SSE error: {type(e).__name__}: {str(e)[:200]}"})
            except Exception:
                pass
            try:
                await _append_history_log_tail(hid, pending_logs)
            except Exception:
                pass
            return

    headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    return StreamingResponse(event_gen(), media_type="text/event-stream", headers=headers)
