import os

import redis

_client = None


def _redis_url() -> str | None:
    url = (os.getenv("REDIS_URL") or os.getenv("NEXUSOPS_REDIS_URL") or "").strip()
    if url:
        return url
    host = (os.getenv("REDIS_HOST") or os.getenv("NEXUSOPS_REDIS_HOST") or "").strip()
    if not host:
        return None
    port = (os.getenv("REDIS_PORT") or os.getenv("NEXUSOPS_REDIS_PORT") or "6379").strip()
    db = (os.getenv("REDIS_DB") or os.getenv("NEXUSOPS_REDIS_DB") or "0").strip()
    password = (os.getenv("REDIS_PASSWORD") or os.getenv("NEXUSOPS_REDIS_PASSWORD") or "").strip()
    auth = f":{password}@" if password else ""
    return f"redis://{auth}{host}:{port}/{db}"


def get_redis():
    global _client
    if _client is not None:
        return _client
    url = _redis_url()
    if not url:
        _client = None
        return None
    try:
        r = redis.Redis.from_url(url, decode_responses=True)
        r.ping()
        _client = r
        return _client
    except Exception:
        _client = None
        return None
