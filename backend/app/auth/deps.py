import uuid
from datetime import datetime

from fastapi import Depends, HTTPException, Request
from sqlmodel import select

from ..db.models import Permission, RolePermission, User, UserRole
from ..db.session import run_db
from .redis_client import get_redis
from .security import decode_token, jwt_ttl_seconds


def _bearer_token(req: Request) -> str | None:
    h = (req.headers.get("authorization") or "").strip()
    if not h:
        c = (req.cookies.get("nexusops_token") or "").strip()
        return c or None
    if not h.lower().startswith("bearer "):
        return None
    return h[7:].strip() or None


async def get_current_user(req: Request) -> User:
    token = _bearer_token(req)
    if not token:
        raise HTTPException(status_code=401, detail="Unauthorized")
    try:
        payload = decode_token(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Unauthorized")

    sub = payload.get("sub")
    jti = payload.get("jti")
    if not sub or not jti:
        raise HTTPException(status_code=401, detail="Unauthorized")

    r = get_redis()
    if r is not None:
        key = f"sess:{jti}"
        uid = r.get(key)
        if not uid or uid != str(sub):
            raise HTTPException(status_code=401, detail="Unauthorized")
        try:
            ttl = r.ttl(key)
            if isinstance(ttl, int) and ttl >= 0 and ttl < 3600:
                r.expire(key, jwt_ttl_seconds())
        except Exception:
            pass

    try:
        user_id = uuid.UUID(str(sub))
    except Exception:
        raise HTTPException(status_code=401, detail="Unauthorized")

    def _work(session):
        u = session.get(User, user_id)
        if not u or not u.is_active:
            raise HTTPException(status_code=401, detail="Unauthorized")
        u.updated_at = datetime.utcnow()
        session.add(u)
        session.commit()
        session.refresh(u)
        return u

    return await run_db(_work)


def require_permission(code: str):
    async def _dep(user: User = Depends(get_current_user)) -> User:
        def _work(session):
            q = (
                select(Permission.code)
                .select_from(UserRole)
                .join(RolePermission, RolePermission.role_id == UserRole.role_id)
                .join(Permission, Permission.id == RolePermission.permission_id)
                .where(UserRole.user_id == user.id)
            )
            perms = set(session.exec(q).all())
            if code not in perms:
                raise HTTPException(status_code=403, detail="Forbidden")
            return True
        await run_db(_work)
        return user

    return _dep
