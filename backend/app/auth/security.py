import os
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt_sha256"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return pwd_context.verify(password, password_hash)
    except Exception:
        return False


def jwt_secret() -> str:
    s = (os.getenv("NEXUSOPS_JWT_SECRET") or os.getenv("JWT_SECRET") or "").strip()
    return s or "nexusops-change-me"


def jwt_ttl_seconds() -> int:
    raw = (os.getenv("NEXUSOPS_JWT_TTL_SECONDS") or "").strip()
    try:
        n = int(raw)
        if n > 0:
            return n
    except Exception:
        pass
    return 24 * 3600


def create_access_token(user_id: str, jti: str | None = None) -> tuple[str, str, int]:
    now = datetime.now(timezone.utc)
    ttl = jwt_ttl_seconds()
    exp = now + timedelta(seconds=ttl)
    token_id = jti or str(uuid.uuid4())
    payload = {
        "sub": str(user_id),
        "jti": token_id,
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
    }
    token = jwt.encode(payload, jwt_secret(), algorithm="HS256")
    return token, token_id, ttl


def decode_token(token: str) -> dict:
    return jwt.decode(token, jwt_secret(), algorithms=["HS256"])
