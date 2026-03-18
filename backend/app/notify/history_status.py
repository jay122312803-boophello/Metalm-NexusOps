from __future__ import annotations

from datetime import datetime

from sqlmodel import Session

from ..db.models import DeploymentHistory
from .deploy_notify import build_feishu_text
from ..utils.datetime_fmt import now_app_dt


def update_history_status(session: Session, history_id, new_status: str, web_url: str | None = None):
    h = session.get(DeploymentHistory, history_id)
    if not h:
        return None

    old_status = (h.status or "").strip()
    new_s = (new_status or "").strip()
    new_url = (web_url or "").strip() or None

    changed = False
    if new_s and new_s != old_status:
        h.status = new_s
        changed = True
    if new_url is not None and new_url != (h.web_url or None):
        h.web_url = new_url
        changed = True

    terminal = new_s in {"success", "failed", "canceled", "skipped", "manual"}
    if terminal and h.finished_at is None:
        h.finished_at = now_app_dt()
        changed = True

    notify_payload = None
    vars_ = dict(h.variables or {})
    pending = bool(vars_.get("__feishu_notify_pending")) and not bool(vars_.get("__feishu_notified"))
    if terminal and (old_status != new_s or pending):
        notify_payload = build_feishu_text(session, h.id, new_s)
        if notify_payload:
            if not vars_.get("__feishu_notified"):
                vars_["__feishu_notify_pending"] = True
                h.variables = vars_
                changed = True

    if changed:
        session.add(h)

    return notify_payload
