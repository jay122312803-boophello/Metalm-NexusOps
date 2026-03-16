import os
from typing import Any

import anyio
import requests
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlmodel import select

from ...auth.deps import get_current_user
from ...chat.service import _chat_completions_url, stream_chat_completions, stream_openai_compatible
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

    if not body.stream:
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
    if active_ready:
        return StreamingResponse(
            stream_openai_compatible(
                base_url=(active.base_url or "").strip(),
                api_key=(active.api_key or "").strip(),
                model=(active.model or "").strip(),
                messages=compact,
                system_prompt=str(active.system_prompt or ""),
                temperature=float(active.temperature or 0.2),
                timeout_s=timeout_s,
            ),
            media_type="text/event-stream",
            headers=headers,
        )
    return StreamingResponse(stream_chat_completions(compact, delay_ms=delay_ms), media_type="text/event-stream", headers=headers)
