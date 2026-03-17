from __future__ import annotations

from datetime import datetime

from sqlmodel import Session

from ..db.models import Deployment, DeploymentHistory, Repo, Server


def _terminal_status(s: str) -> bool:
    return s in {"success", "failed", "canceled", "skipped", "manual"}


def _status_title(s: str) -> str:
    if s == "success":
        return "🟢 成功"
    if s == "failed":
        return "🔴 失败"
    if s == "canceled":
        return "🟡 已取消"
    return f"ℹ️ {s}"


def build_feishu_text(session: Session, history_id, new_status: str) -> tuple[str, str | None, str] | None:
    h = session.get(DeploymentHistory, history_id)
    if not h:
        return None
    d = session.get(Deployment, h.deployment_id)
    if not d:
        return None

    url = (getattr(d, "feishu_webhook_url", None) or "").strip()
    if not url:
        return None

    vars_ = h.variables or {}
    if vars_.get("__feishu_notified"):
        return None

    send_flag = vars_.get("__send_notification_flag")
    if send_flag is False:
        return None

    if new_status == "success" and not bool(getattr(d, "notify_on_success", True)):
        return None
    if new_status == "failed" and not bool(getattr(d, "notify_on_failed", False)):
        return None
    if new_status not in {"success", "failed"}:
        return None

    s = session.get(Server, d.server_id)
    r = session.get(Repo, d.repo_id)
    who = (vars_.get("__triggered_by") or "").strip()
    desc = (vars_.get("__deploy_description") or "").strip()

    lines: list[str] = []
    lines.append(f"[{_status_title(new_status)}] 容器部署通知")
    lines.append(f"任务名称：{d.name}")
    if s:
        addr = (s.address or "").strip() or "-"
        ssh_user = (s.ssh_user or "").strip() or "metalm"
        lines.append(f"目标服务器：{ssh_user} @ {addr}")
    if r:
        branch = (r.branch or "").strip() or "master"
        lines.append(f"发布分支：{branch}")
        if (r.name or "").strip():
            lines.append(f"仓库：{r.name}")
    if who:
        lines.append(f"触发人：{who}")
    if getattr(h, "pipeline_id", None):
        lines.append(f"Pipeline：#{h.pipeline_id}")
    if getattr(h, "web_url", None):
        lines.append(f"链接：{h.web_url}")
    if desc:
        lines.append(f"部署描述：{desc}")

    secret = (getattr(d, "feishu_secret", None) or "").strip() or None
    return url, secret, "\n".join(lines)


def mark_notified(session: Session, history_id) -> None:
    h = session.get(DeploymentHistory, history_id)
    if not h:
        return
    vars_ = dict(h.variables or {})
    if vars_.get("__feishu_notified"):
        return
    vars_["__feishu_notified"] = True
    vars_["__feishu_notified_at"] = datetime.utcnow().isoformat()
    vars_.pop("__feishu_notify_pending", None)
    vars_.pop("__feishu_notify_last_error", None)
    vars_.pop("__feishu_notify_last_error_at", None)
    h.variables = vars_
    session.add(h)


def mark_notify_error(session: Session, history_id, err: str) -> None:
    h = session.get(DeploymentHistory, history_id)
    if not h:
        return
    vars_ = dict(h.variables or {})
    if vars_.get("__feishu_notified"):
        return
    vars_["__feishu_notify_pending"] = True
    vars_["__feishu_notify_last_error"] = (err or "")[:500]
    vars_["__feishu_notify_last_error_at"] = datetime.utcnow().isoformat()
    h.variables = vars_
    session.add(h)
