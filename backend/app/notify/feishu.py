import base64
import hashlib
import hmac
import time

import requests


def _feishu_sign(secret: str) -> tuple[str, str]:
    ts = str(int(time.time()))
    key = f"{ts}\n{secret}".encode("utf-8")
    sig = hmac.new(key, b"", digestmod=hashlib.sha256).digest()
    return ts, base64.b64encode(sig).decode("utf-8")


def send_feishu_text(webhook_url: str, text: str, secret: str | None = None, timeout_seconds: int = 10) -> None:
    url = (webhook_url or "").strip()
    if not url:
        return
    payload: dict = {"msg_type": "text", "content": {"text": text}}
    sec = (secret or "").strip()
    if sec:
        ts, sign = _feishu_sign(sec)
        payload["timestamp"] = ts
        payload["sign"] = sign
    resp = requests.post(url, json=payload, timeout=timeout_seconds)
    resp.raise_for_status()
    try:
        data = resp.json()
        if isinstance(data, dict) and "code" in data and int(data.get("code") or 0) != 0:
            raise RuntimeError(f"Feishu webhook rejected: code={data.get('code')} msg={data.get('msg')}")
    except ValueError:
        pass
