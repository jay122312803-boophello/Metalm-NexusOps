import os
from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ...auth.deps import get_current_user
from ...chat.service import stream_chat_completions

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

    if not body.stream:
        text = ""
        for m in list(msgs)[::-1]:
            if (m or {}).get("role") == "user":
                text = str((m or {}).get("content") or "")
                break
        return {"choices": [{"message": {"role": "assistant", "content": text}}], "finish_reason": "stop"}

    headers = {"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"}
    return StreamingResponse(stream_chat_completions(msgs, delay_ms=delay_ms), media_type="text/event-stream", headers=headers)

