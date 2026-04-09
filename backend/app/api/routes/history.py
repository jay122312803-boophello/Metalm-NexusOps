import os
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query

from sqlmodel import select

from ...db.models import Deployment, DeploymentHistory, Repo, Server
from ...db.session import run_db
from ...auth.deps import require_permission
from .configs import ensure_snapshot_if_success
from ...notify.feishu import send_feishu_text
from ...notify.history_status import update_history_status
from ...notify.deploy_notify import mark_notified, mark_notify_error
from ...utils.datetime_fmt import iso_app, iso_now_app
from ...utils.github_api import cancel_workflow_run, get_workflow_run, list_workflow_runs, parse_owner_repo

router = APIRouter()


def _map_github_run(status: str | None, conclusion: str | None) -> str:
    st = (status or "").strip().lower()
    cc = (conclusion or "").strip().lower()
    if st in {"queued", "waiting", "requested"}:
        return "pending"
    if st in {"in_progress"}:
        return "running"
    if st == "completed":
        if cc in {"success"}:
            return "success"
        if cc in {"cancelled", "skipped"}:
            return "canceled"
        if cc in {"failure", "timed_out", "action_required", "stale"}:
            return "failed"
        return "failed"
    return "pending"


def _guess_github_owner_repo_and_token(
    session,
    repo: Repo | None,
    snap: dict | None,
) -> tuple[str | None, str | None, str | None]:
    rr = repo
    try:
        if isinstance(snap, dict):
            ci_repo_id = str(snap.get("ci_repo_id") or "").strip()
            if ci_repo_id:
                rr2 = session.get(Repo, uuid.UUID(ci_repo_id))
                if rr2:
                    rr = rr2
    except Exception:
        pass

    slug = ""
    try:
        if isinstance(snap, dict):
            slug = str((snap.get("ci_project_id") or "")).strip()
    except Exception:
        slug = ""

    owner, repo_name = (None, None)
    if slug:
        owner, repo_name = parse_owner_repo(slug)
    if not owner or not repo_name:
        owner, repo_name = parse_owner_repo((rr.url or "").strip() if rr else "")
    token = ((rr.private_token or "") if rr else "").strip() or (os.getenv("GITHUB_PAT") or "").strip() or (os.getenv("PRIVATE_TOKEN") or "").strip() or None
    return owner, repo_name, token


def _resolve_run_id(owner: str, repo_name: str, token: str, history_id: str) -> tuple[int | None, str | None]:
    runs = list_workflow_runs(
        owner=owner,
        repo=repo_name,
        token=token,
        base_url=(os.getenv("GITHUB_API_BASE_URL") or "https://api.github.com").strip() or "https://api.github.com",
        event="repository_dispatch",
        per_page=30,
    )
    hid = str(history_id)
    for r in runs:
        s = ""
        try:
            s = " ".join(
                [
                    str(r.get("display_title") or ""),
                    str(r.get("name") or ""),
                    str(r.get("head_branch") or ""),
                    str((r.get("head_commit") or {}).get("message") or ""),
                ]
            )
        except Exception:
            s = ""
        if hid and hid in s:
            rid = r.get("id")
            try:
                rid_int = int(rid)
            except Exception:
                rid_int = None
            return rid_int, (r.get("html_url") or None)
    return None, None


@router.get("")
async def get_history(
    user=Depends(require_permission("audit:read")),
    server_id: str | None = Query(default=None),
    status: str | None = Query(default=None),
    deployment_id: str | None = Query(default=None),
):
    def _work(session):
        refresh_rows = session.exec(
            select(
                DeploymentHistory.id,
                DeploymentHistory.pipeline_id,
                DeploymentHistory.status,
                Repo.url,
                Repo.private_token,
                DeploymentHistory.repo_snapshot,
            )
            .join(Deployment, Deployment.id == DeploymentHistory.deployment_id)
            .join(Repo, Repo.id == Deployment.repo_id)
            .where(DeploymentHistory.status.in_(["pending", "running"]), Deployment.created_by_user_id == user.id)
            .order_by(DeploymentHistory.created_at.desc())
            .limit(30)
        ).all()

        for hid, pid, old_status, repo_url, private_token, snap in refresh_rows:
            owner, repo_name, token = _guess_github_owner_repo_and_token(session, None, snap) if snap else (None, None, None)
            if (not owner or not repo_name) and repo_url:
                owner, repo_name = parse_owner_repo(str(repo_url))
                token = (str(private_token or "").strip() or (os.getenv("GITHUB_PAT") or "").strip() or (os.getenv("PRIVATE_TOKEN") or "").strip() or None)
            if not owner or not repo_name or not token:
                continue

            obj = session.get(DeploymentHistory, hid)
            if not obj:
                continue

            run_id = obj.pipeline_id
            web_url = obj.web_url
            if not run_id:
                rid, url2 = _resolve_run_id(owner, repo_name, token, str(hid))
                if rid:
                    obj.pipeline_id = rid
                    if url2:
                        obj.web_url = url2
                    session.add(obj)
                    session.commit()
                    run_id = rid
                    web_url = obj.web_url

            if not run_id:
                continue

            try:
                data = get_workflow_run(
                    owner=owner,
                    repo=repo_name,
                    token=token,
                    run_id=int(run_id),
                    base_url=(os.getenv("GITHUB_API_BASE_URL") or "https://api.github.com").strip() or "https://api.github.com",
                )
                new_status = _map_github_run(data.get("status"), data.get("conclusion"))
                new_web_url = data.get("html_url") or web_url
                if new_status and new_status != old_status:
                    notify_payload = update_history_status(session, obj.id, new_status, new_web_url)
                    session.commit()
                    if notify_payload:
                        url2, secret2, text2 = notify_payload
                        try:
                            send_feishu_text(url2, text2, secret=secret2)
                            mark_notified(session, obj.id)
                        except Exception as e:
                            mark_notify_error(session, obj.id, f"{type(e).__name__}: {str(e)}")
                        session.commit()
            except Exception:
                continue

        sid = None
        if server_id and server_id != "all":
            sid = uuid.UUID(server_id)

        st = None
        if status and status != "all":
            st = status

        did = None
        if deployment_id:
            did = uuid.UUID(deployment_id)

        q = (
            select(DeploymentHistory)
            .join(Deployment, Deployment.id == DeploymentHistory.deployment_id)
            .where(Deployment.created_by_user_id == user.id)
            .order_by(DeploymentHistory.created_at.desc())
        )
        if sid:
            q = q.where(Deployment.server_id == sid)
        if st:
            q = q.where(DeploymentHistory.status == st)
        if did:
            q = q.where(DeploymentHistory.deployment_id == did)
        q = q.limit(500)

        rows = session.exec(q).all()

        servers = session.exec(select(Server.id, Server.name).where(Server.created_by_user_id == user.id).order_by(Server.name.asc())).all()
        server_options = [{"id": str(i), "name": n} for i, n in servers]
        status_options = ["pending", "running", "success", "failed", "canceled"]

        history = []
        for h in rows:
            history.append(
                {
                    "id": str(h.id),
                    "deployment_id": str(h.deployment_id),
                    "pipeline_id": h.pipeline_id,
                    "status": h.status,
                    "ref": h.ref,
                    "web_url": h.web_url,
                    "created_at": iso_app(h.created_at),
                    "finished_at": iso_app(h.finished_at),
                    "server_snapshot": h.server_snapshot,
                    "repo_snapshot": h.repo_snapshot,
                    "variables": h.variables,
                }
            )

        return {"ok": True, "history": history, "filters": {"servers": server_options, "statuses": status_options}}

    return await run_db(_work)


@router.get("/{history_id}/status")
async def check_pipeline_status(history_id: str, user=Depends(require_permission("audit:read"))):
    def _work(session):
        h = session.get(DeploymentHistory, uuid.UUID(history_id))
        if not h:
            raise HTTPException(404, "History not found")

        d = session.get(Deployment, h.deployment_id)
        if not d or d.created_by_user_id != user.id:
            raise HTTPException(404, "History not found")
        r = session.get(Repo, d.repo_id) if d else None

        owner, repo_name, token = _guess_github_owner_repo_and_token(session, r, h.repo_snapshot if isinstance(h.repo_snapshot, dict) else None)
        if not owner or not repo_name or not token:
            return {"status": h.status, "pipeline": None}

        run_id = h.pipeline_id
        if not run_id:
            rid, url2 = _resolve_run_id(owner, repo_name, token, str(h.id))
            if rid:
                h.pipeline_id = rid
                if url2:
                    h.web_url = url2
                session.add(h)
                session.commit()
                session.refresh(h)
                run_id = rid

        if run_id:
            try:
                data = get_workflow_run(
                    owner=owner,
                    repo=repo_name,
                    token=token,
                    run_id=int(run_id),
                    base_url=(os.getenv("GITHUB_API_BASE_URL") or "https://api.github.com").strip() or "https://api.github.com",
                )
                new_status = _map_github_run(data.get("status"), data.get("conclusion"))
                new_web_url = data.get("html_url") or h.web_url
                if new_status:
                    notify_payload = update_history_status(session, h.id, new_status, new_web_url)
                    session.commit()
                    if notify_payload:
                        url2, secret2, text2 = notify_payload
                        try:
                            send_feishu_text(url2, text2, secret=secret2)
                            mark_notified(session, h.id)
                        except Exception as e:
                            mark_notify_error(session, h.id, f"{type(e).__name__}: {str(e)}")
                        session.commit()
                return {"status": new_status or h.status, "pipeline": data}
            except Exception:
                pass

        return {"status": h.status, "pipeline": None}

    res = await run_db(_work)
    try:
        if res and res.get("status") == "success":
            await ensure_snapshot_if_success(uuid.UUID(history_id))
    except Exception:
        pass
    return res


@router.delete("/{history_id}")
async def delete_history(history_id: str, user=Depends(require_permission("audit:manage"))):
    def _work(session):
        h = session.get(DeploymentHistory, uuid.UUID(history_id))
        if not h:
            raise HTTPException(status_code=404, detail="History not found")
        d = session.get(Deployment, h.deployment_id)
        if not d or d.created_by_user_id != user.id:
            raise HTTPException(status_code=404, detail="History not found")
        session.delete(h)
        session.commit()
        return {"ok": True}

    return await run_db(_work)


@router.post("/{history_id}/cancel")
async def cancel_history(history_id: str, user=Depends(require_permission("deploy:manage"))):
    def _work(session):
        try:
            hid = uuid.UUID(history_id)
        except Exception:
            raise HTTPException(400, "Invalid history id")

        h = session.get(DeploymentHistory, hid)
        if not h:
            raise HTTPException(status_code=404, detail="History not found")
        d = session.get(Deployment, h.deployment_id)
        if not d or d.created_by_user_id != user.id:
            raise HTTPException(status_code=404, detail="History not found")

        st0 = str(h.status or "").lower().strip()
        if st0 in {"success", "failed", "canceled"}:
            return {"ok": True, "status": h.status, "pipeline_id": h.pipeline_id}

        r = session.get(Repo, d.repo_id) if d else None
        owner, repo_name, token = _guess_github_owner_repo_and_token(session, r, h.repo_snapshot if isinstance(h.repo_snapshot, dict) else None)
        if not owner or not repo_name or not token:
            raise HTTPException(status_code=400, detail="未配置 GitHub repo 或 token，无法取消")

        run_id = h.pipeline_id
        if not run_id:
            rid, url2 = _resolve_run_id(owner, repo_name, token, str(h.id))
            if rid:
                h.pipeline_id = rid
                if url2:
                    h.web_url = url2
                session.add(h)
                session.commit()
                session.refresh(h)
                run_id = rid

        if not run_id:
            raise HTTPException(status_code=400, detail="未获取到 run_id，无法取消")

        try:
            cancel_workflow_run(
                owner=owner,
                repo=repo_name,
                token=token,
                run_id=int(run_id),
                base_url=(os.getenv("GITHUB_API_BASE_URL") or "https://api.github.com").strip() or "https://api.github.com",
            )
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"调用 GitHub 取消失败: {type(e).__name__}: {str(e)}")

        vars_ = dict(h.variables or {})
        who = (getattr(user, "display_name", None) or getattr(user, "username", None) or "").strip()
        if who:
            vars_["__canceled_by"] = who
        vars_["__canceled_at"] = iso_now_app()
        h.variables = vars_
        update_history_status(session, h.id, "canceled", h.web_url)
        session.commit()
        session.refresh(h)
        return {"ok": True, "status": h.status, "pipeline_id": h.pipeline_id}

    return await run_db(_work)
