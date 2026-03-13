import requests
from fastapi import APIRouter, HTTPException, Query

from ...state import storage

router = APIRouter()


@router.get("")
def get_history(
    server_id: str | None = Query(default=None),
    status: str | None = Query(default=None),
):
    history = storage.get_all("history")
    history.sort(key=lambda x: x.get("created_at", ""), reverse=True)

    refresh_targets = []
    for h in history[:30]:
        st = (h.get("status") or "").lower()
        if st not in {"pending", "running"}:
            continue
        repo = h.get("repo_snapshot") or {}
        pid = h.get("pipeline_id")
        proj_id = repo.get("project_id")
        token = repo.get("private_token")
        if pid and proj_id and token:
            refresh_targets.append((h, proj_id, pid, token))

    for h, proj_id, pid, token in refresh_targets:
        try:
            url = f"https://gitlab.xuelangyun.com/api/v4/projects/{requests.utils.quote(proj_id, safe='')}/pipelines/{pid}"
            headers = {"PRIVATE-TOKEN": token}
            resp = requests.get(url, headers=headers, verify=False, timeout=8)
            if resp.ok:
                data = resp.json()
                new_status = data.get("status")
                new_web_url = data.get("web_url")
                if new_status and new_status != h.get("status"):
                    storage.update("history", h.get("id"), {"status": new_status, "web_url": new_web_url})
                    h["status"] = new_status
                    h["web_url"] = new_web_url
        except Exception:
            pass

    filtered = history
    if server_id and server_id != "all":
        filtered = [h for h in filtered if (h.get("server_snapshot") or {}).get("id") == server_id]
    if status and status != "all":
        filtered = [h for h in filtered if str(h.get("status")) == status]

    servers = storage.get_all("servers")
    server_options = [{"id": s.get("id"), "name": s.get("name")} for s in servers if s.get("id") and s.get("name")]
    server_options.sort(key=lambda x: x["name"])

    status_options = [
        "pending",
        "running",
        "success",
        "failed",
        "canceled",
    ]

    return {
        "ok": True,
        "history": filtered,
        "filters": {"servers": server_options, "statuses": status_options},
    }


@router.get("/{history_id}/status")
def check_pipeline_status(history_id: str):
    h = storage.get_by_id("history", history_id)
    if not h:
        raise HTTPException(404, "History not found")

    repo = h.get("repo_snapshot") or {}
    pid = h.get("pipeline_id")
    proj_id = repo.get("project_id")
    token = repo.get("private_token")

    if pid and proj_id and token:
        try:
            url = f"https://gitlab.xuelangyun.com/api/v4/projects/{requests.utils.quote(proj_id, safe='')}/pipelines/{pid}"
            headers = {"PRIVATE-TOKEN": token}
            resp = requests.get(url, headers=headers, verify=False, timeout=8)
            if resp.ok:
                data = resp.json()
                new_status = data.get("status")
                new_web_url = data.get("web_url")
                storage.update("history", history_id, {"status": new_status, "web_url": new_web_url})
                return {"status": new_status, "pipeline": data}
        except Exception:
            pass

    return {"status": h.get("status"), "pipeline": None}
