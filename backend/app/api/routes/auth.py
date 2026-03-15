import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlmodel import select

from ...auth.deps import get_current_user
from ...auth.redis_client import get_redis
from ...auth.security import create_access_token, decode_token, verify_password
from ...db.models import Permission, RolePermission, User, UserRole
from ...db.session import run_db

router = APIRouter()


class LoginRequest(BaseModel):
    username: str
    password: str


@router.post("/auth/login")
async def login(req: LoginRequest):
    username = (req.username or "").strip()
    password = req.password or ""
    if not username or not password:
        raise HTTPException(status_code=400, detail="Invalid credentials")

    def _work(session):
        u = session.exec(select(User).where(User.username == username)).first()
        if not u or not u.is_active:
            raise HTTPException(status_code=401, detail="Invalid credentials")
        if not verify_password(password, u.password_hash):
            raise HTTPException(status_code=401, detail="Invalid credentials")
        q = (
            select(Permission.code)
            .select_from(UserRole)
            .join(RolePermission, RolePermission.role_id == UserRole.role_id)
            .join(Permission, Permission.id == RolePermission.permission_id)
            .where(UserRole.user_id == u.id)
        )
        perms = session.exec(q).all()
        return u, perms

    user, perms = await run_db(_work)
    token, jti, ttl = create_access_token(str(user.id))
    r = get_redis()
    if r is not None:
        try:
            r.setex(f"sess:{jti}", ttl, str(user.id))
            r.sadd(f"user_sess:{user.id}", jti)
            r.expire(f"user_sess:{user.id}", ttl)
        except Exception:
            pass

    return {
        "ok": True,
        "token": token,
        "user": {"id": str(user.id), "username": user.username, "display_name": user.display_name, "is_active": user.is_active},
        "permissions": perms,
    }


@router.post("/auth/logout")
async def logout(req: Request, user: User = Depends(get_current_user)):
    r = get_redis()
    if r is not None:
        try:
            token = (req.headers.get("authorization") or "").strip()
            if token.lower().startswith("bearer "):
                token = token[7:].strip()
            payload = decode_token(token) if token else {}
            jti = payload.get("jti")
            if jti:
                r.delete(f"sess:{jti}")
                r.srem(f"user_sess:{user.id}", jti)
        except Exception:
            pass
    return {"ok": True}


@router.get("/auth/me")
async def me(user: User = Depends(get_current_user)):
    def _work(session):
        q = (
            select(Permission.code)
            .select_from(UserRole)
            .join(RolePermission, RolePermission.role_id == UserRole.role_id)
            .join(Permission, Permission.id == RolePermission.permission_id)
            .where(UserRole.user_id == user.id)
        )
        perms = session.exec(q).all()
        return perms

    perms = await run_db(_work)
    return {"ok": True, "user": {"id": str(user.id), "username": user.username, "display_name": user.display_name}, "permissions": perms}
