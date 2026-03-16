import os
import re
from typing import Any

import anyio
import requests
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlmodel import select

from ...auth.deps import get_current_user
from ...chat.service import _chat_completions_url, stream_chat_completions, stream_agent_run, stream_tool_then_echo_text
from ...chat.tools import query_list_deployments, query_system_overview
from ...db.models import AIModelConfig
from ...db.session import run_db

router = APIRouter()


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatCompletionsRequest(BaseModel):
    messages: list[ChatMessage]
    stream: bool = True


@router.post("/completions")
async def chat_completions(body: ChatCompletionsRequest, user=Depends(get_current_user)):
    delay_ms = int((os.getenv("NEXUSOPS_COPILOT_ECHO_DELAY_MS") or "60").strip() or "60")
    msgs: list[dict[str, Any]] = [{"role": m.role, "content": m.content} for m in (body.messages or [])]
    timeout_s = int((os.getenv("NEXUSOPS_COPILOT_MODEL_TIMEOUT_S") or "180").strip() or "180")

    def _load_active(session):
        return session.exec(select(AIModelConfig).where(AIModelConfig.is_deleted == False, AIModelConfig.is_active == True)).first()

    active = await run_db(_load_active)
    active_ready = bool(active and (active.base_url or "").strip() and (active.api_key or "").strip() and (active.model or "").strip())

    max_rounds = 10
    try:
        if active and int(active.max_history or 0) > 0:
            max_rounds = int(active.max_history or 10)
    except Exception:
        max_rounds = 10
    max_msgs = max(2, min(100, max_rounds * 2))
    compact = []
    for m in list(msgs or []):
        r = str((m or {}).get("role") or "")
        if r not in {"user", "assistant"}:
            continue
        compact.append({"role": r, "content": str((m or {}).get("content") or "")})
    compact = compact[-max_msgs:]

    last_user = ""
    for m in list(compact)[::-1]:
        if (m or {}).get("role") == "user":
            last_user = str((m or {}).get("content") or "")
            break
    last_user_s = re.sub(r"\s+", " ", (last_user or "")).strip()

    want_overview = ("部署" in last_user_s and "成功率" in last_user_s) or ("系统概览" in last_user_s) or ("概览" in last_user_s)
    want_list_deps = ("部署" in last_user_s) and (("最近" in last_user_s) or ("列出" in last_user_s) or ("哪些" in last_user_s) or ("看看" in last_user_s))

    if not body.stream:
        if want_overview:
            try:
                data = query_system_overview(user_id=user.id)
                if isinstance(data, dict) and data.get("error"):
                    text = f"无法获取系统概览：{data.get('error')}"
                else:
                    text = (
                        f"**今日部署成功率**：{data.get('success_rate_today')}\n"
                        f"**今日部署次数**：{data.get('deployments_today')}\n"
                        f"**服务器总数**：{data.get('total_servers')}"
                    )
            except Exception as e:
                text = f"无法获取系统概览：{str(e)}"
            return {"choices": [{"message": {"role": "assistant", "content": text}}], "finish_reason": "stop"}

        if want_list_deps:
            try:
                rows = query_list_deployments(user_id=user.id, limit=5)
                if not rows:
                    text = "未找到最近部署项目"
                else:
                    lines = []
                    for x in rows:
                        name = str((x or {}).get("name") or "")
                        server = str((x or {}).get("server") or "")
                        created_at = str((x or {}).get("created_at") or "")
                        if created_at:
                            lines.append(f"- {name} @ {server} ({created_at})")
                        else:
                            lines.append(f"- {name} @ {server}")
                    text = "**最近部署项目**：\n" + "\n".join(lines)
            except Exception as e:
                text = f"无法列出最近部署：{str(e)}"
            return {"choices": [{"message": {"role": "assistant", "content": text}}], "finish_reason": "stop"}

        if not active_ready:
            text = ""
            for m in list(compact)[::-1]:
                if (m or {}).get("role") == "user":
                    text = str((m or {}).get("content") or "")
                    break
            return {"choices": [{"message": {"role": "assistant", "content": text}}], "finish_reason": "stop"}

        url = (active.base_url or "").strip()
        headers = {"Authorization": f"Bearer {(active.api_key or '').strip()}", "Content-Type": "application/json"}
        payload = {
            "model": (active.model or "").strip(),
            "messages": ([{"role": "system", "content": str(active.system_prompt or "")}] if (active.system_prompt or "").strip() else []) + compact,
            "temperature": float(active.temperature or 0.2),
            "stream": False,
        }
        try:
            r = await anyio.to_thread.run_sync(lambda: requests.post(_chat_completions_url(url), headers=headers, json=payload, timeout=(12, timeout_s)))
        except Exception:
            return {"choices": [{"message": {"role": "assistant", "content": "模型连接失败，请联系管理员检查模型配置"}}], "finish_reason": "stop"}
        if not r.ok:
            return {"choices": [{"message": {"role": "assistant", "content": "模型请求失败，请联系管理员检查模型配置"}}], "finish_reason": "stop"}
        try:
            data = r.json()
        except Exception:
            data = None
        if isinstance(data, dict):
            return data
        return {"choices": [{"message": {"role": "assistant", "content": "模型响应解析失败"}}], "finish_reason": "stop"}

    headers = {"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"}

    if want_overview:
        try:
            data = query_system_overview(user_id=user.id)
            if isinstance(data, dict) and data.get("error"):
                text = f"无法获取系统概览：{data.get('error')}"
            else:
                text = (
                    f"**今日部署成功率**：{data.get('success_rate_today')}\n"
                    f"**今日部署次数**：{data.get('deployments_today')}\n"
                    f"**服务器总数**：{data.get('total_servers')}"
                )
        except Exception as e:
            text = f"无法获取系统概览：{str(e)}"
        return StreamingResponse(
            stream_tool_then_echo_text(tool_name="get_system_overview", tool_input={}, text=text, delay_ms=delay_ms),
            media_type="text/event-stream",
            headers=headers,
        )

    if want_list_deps:
        try:
            rows = query_list_deployments(user_id=user.id, limit=5)
            if not rows:
                text = "未找到最近部署项目"
            else:
                lines = []
                for x in rows:
                    name = str((x or {}).get("name") or "")
                    server = str((x or {}).get("server") or "")
                    created_at = str((x or {}).get("created_at") or "")
                    if created_at:
                        lines.append(f"- {name} @ {server} ({created_at})")
                    else:
                        lines.append(f"- {name} @ {server}")
                text = "**最近部署项目**：\n" + "\n".join(lines)
        except Exception as e:
            text = f"无法列出最近部署：{str(e)}"
        return StreamingResponse(
            stream_tool_then_echo_text(tool_name="list_deployments", tool_input={"limit": 5}, text=text, delay_ms=delay_ms),
            media_type="text/event-stream",
            headers=headers,
        )

    if active_ready:
        return StreamingResponse(
            stream_agent_run(
                base_url=(active.base_url or "").strip(),
                api_key=(active.api_key or "").strip(),
                model=(active.model or "").strip(),
                messages=compact,
                system_prompt=str(active.system_prompt or ""),
                user_id=str(user.id),
                temperature=float(active.temperature or 0.2),
                timeout_s=timeout_s,
            ),
            media_type="text/event-stream",
            headers=headers,
        )
    return StreamingResponse(stream_chat_completions(compact, delay_ms=delay_ms), media_type="text/event-stream", headers=headers)
