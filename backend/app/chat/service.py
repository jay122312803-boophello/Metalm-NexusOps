import json
from collections.abc import AsyncIterator

import anyio


def _sse_data(data: object) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


async def stream_echo_text(text: str, delay_ms: int = 60) -> AsyncIterator[str]:
    delay = max(0.0, float(delay_ms) / 1000.0)
    last_keepalive = anyio.current_time()
    for ch in list(text or ""):
        yield _sse_data({"choices": [{"delta": {"content": ch}}]})
        if delay:
            await anyio.sleep(delay)
        now = anyio.current_time()
        if now - last_keepalive >= 10.0:
            yield ":keepalive\n\n"
            last_keepalive = now
    yield _sse_data({"choices": [{"delta": {"content": ""}}], "finish_reason": "stop"})
    yield "data: [DONE]\n\n"


async def stream_chat_completions(messages: list[dict], delay_ms: int = 60) -> AsyncIterator[str]:
    last_user = ""
    for m in list(messages or [])[::-1]:
        if (m or {}).get("role") == "user":
            last_user = str((m or {}).get("content") or "")
            break
    async for chunk in stream_echo_text(last_user, delay_ms=delay_ms):
        yield chunk
