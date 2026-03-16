import json
from collections.abc import AsyncIterator

import anyio
import requests


def _sse_data(data: object) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


def _chat_completions_url(base_url: str) -> str:
    b = (base_url or "").strip().rstrip("/")
    if not b:
        return ""
    if b.endswith("/v1"):
        return f"{b}/chat/completions"
    return f"{b}/v1/chat/completions"


async def stream_openai_compatible(
    *,
    base_url: str,
    api_key: str,
    model: str,
    messages: list[dict],
    system_prompt: str = "",
    temperature: float = 0.2,
    timeout_s: int = 180,
) -> AsyncIterator[str]:
    url = _chat_completions_url(base_url)
    if not url:
        async for chunk in stream_echo_text("模型配置无效：Base URL 为空"):
            yield chunk
        return

    msg_list: list[dict] = []
    sp = (system_prompt or "").strip()
    if sp:
        msg_list.append({"role": "system", "content": sp})
    for m in list(messages or []):
        r = str((m or {}).get("role") or "")
        if r not in {"user", "assistant"}:
            continue
        msg_list.append({"role": r, "content": str((m or {}).get("content") or "")})

    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json", "Accept": "text/event-stream"}
    payload = {"model": model, "messages": msg_list, "temperature": float(temperature), "stream": True}

    send, recv = anyio.create_memory_object_stream[str](200)

    def _worker():
        try:
            with requests.post(url, headers=headers, json=payload, stream=True, timeout=(12, timeout_s)) as r:
                if not r.ok:
                    raise RuntimeError("upstream_error")
                for raw in r.iter_lines(decode_unicode=True):
                    if raw is None:
                        continue
                    line = str(raw)
                    if not line:
                        continue
                    if line.startswith("data:"):
                        anyio.from_thread.run(send.send, f"{line}\n\n")
                        if line.strip() == "data: [DONE]":
                            break
                    elif line.startswith(":"):
                        anyio.from_thread.run(send.send, f"{line}\n\n")
        except Exception:
            anyio.from_thread.run(send.send, _sse_data({"choices": [{"delta": {"content": "模型连接失败，请联系管理员检查模型配置"}}]}))
            anyio.from_thread.run(send.send, "data: [DONE]\n\n")
        finally:
            anyio.from_thread.run(send.aclose)

    async with anyio.create_task_group() as tg:
        tg.start_soon(anyio.to_thread.run_sync, _worker)
        async with recv:
            async for chunk in recv:
                yield chunk


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
