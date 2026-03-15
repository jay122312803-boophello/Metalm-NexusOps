import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete
from sqlmodel import select

from ...auth.deps import require_permission
from ...auth.redis_client import get_redis
from ...auth.security import hash_password
from ...db.models import Permission, Role, RolePermission, User, UserRole
from ...db.session import run_db

router = APIRouter()


class CreateUserRequest(BaseModel):
    username: str
    password: str
    display_name: str | None = None
    is_active: bool = True


class UpdateUserRequest(BaseModel):
    display_name: str | None = None
    is_active: bool | None = None


class ResetPasswordRequest(BaseModel):
    password: str


class SetUserRolesRequest(BaseModel):
    role_ids: list[str]


class CreateRoleRequest(BaseModel):
    name: str
    code: str


class SetRolePermissionsRequest(BaseModel):
    permission_ids: list[str]


@router.get("/admin/permissions", dependencies=[Depends(require_permission("rbac:manage"))])
async def list_permissions():
    def _work(session):
        rows = session.exec(select(Permission).where(Permission.is_visible == True).order_by(Permission.type.asc(), Permission.code.asc())).all()
        out = []
        for p in rows:
            out.append({"id": str(p.id), "name": p.name, "code": p.code, "type": p.type, "parent_id": str(p.parent_id) if p.parent_id else None})
        return out

    return {"ok": True, "permissions": await run_db(_work)}


@router.get("/admin/roles", dependencies=[Depends(require_permission("rbac:manage"))])
async def list_roles():
    def _work(session):
        roles = session.exec(select(Role).order_by(Role.code.asc())).all()
        role_ids = [r.id for r in roles]
        rp = {}
        if role_ids:
            rows = session.exec(
                select(RolePermission.role_id, RolePermission.permission_id)
                .select_from(RolePermission)
                .join(Permission, Permission.id == RolePermission.permission_id)
                .where(RolePermission.role_id.in_(role_ids), Permission.is_visible == True)
            ).all()
            for rid, pid in rows:
                rp.setdefault(str(rid), []).append(str(pid))
        out = []
        for r in roles:
            out.append({"id": str(r.id), "name": r.name, "code": r.code, "permission_ids": rp.get(str(r.id), [])})
        return out

    return {"ok": True, "roles": await run_db(_work)}


@router.post("/admin/roles", dependencies=[Depends(require_permission("rbac:manage"))])
async def create_role(req: CreateRoleRequest):
    name = (req.name or "").strip()
    code = (req.code or "").strip()
    if not name or not code:
        raise HTTPException(status_code=400, detail="Invalid role")

    def _work(session):
        if session.exec(select(Role).where(Role.code == code)).first():
            raise HTTPException(status_code=400, detail="Role exists")
        r = Role(name=name, code=code, created_at=datetime.utcnow(), updated_at=datetime.utcnow())
        session.add(r)
        session.commit()
        session.refresh(r)
        return {"id": str(r.id), "name": r.name, "code": r.code, "permission_ids": []}

    return {"ok": True, "role": await run_db(_work)}


@router.post("/admin/roles/{role_id}/permissions", dependencies=[Depends(require_permission("rbac:manage"))])
async def set_role_permissions(role_id: str, req: SetRolePermissionsRequest):
    rid = uuid.UUID(role_id)
    pids = [uuid.UUID(x) for x in (req.permission_ids or [])]

    def _work(session):
        r = session.get(Role, rid)
        if not r:
            raise HTTPException(status_code=404, detail="Role not found")
        session.exec(delete(RolePermission).where(RolePermission.role_id == rid))
        for pid in pids:
            session.add(RolePermission(role_id=rid, permission_id=pid))
        r.updated_at = datetime.utcnow()
        session.add(r)
        session.commit()
        return True

    await run_db(_work)
    return {"ok": True}


@router.get("/admin/users", dependencies=[Depends(require_permission("rbac:manage"))])
async def list_users():
    def _work(session):
        users = session.exec(select(User).order_by(User.username.asc())).all()
        uids = [u.id for u in users]
        ur = {}
        if uids:
            rows = session.exec(select(UserRole.user_id, UserRole.role_id).where(UserRole.user_id.in_(uids))).all()
            for uid, rid in rows:
                ur.setdefault(str(uid), []).append(str(rid))
        out = []
        for u in users:
            out.append(
                {
                    "id": str(u.id),
                    "username": u.username,
                    "display_name": u.display_name,
                    "is_active": u.is_active,
                    "role_ids": ur.get(str(u.id), []),
                }
            )
        return out

    return {"ok": True, "users": await run_db(_work)}


@router.post("/admin/users", dependencies=[Depends(require_permission("rbac:manage"))])
async def create_user(req: CreateUserRequest):
    username = (req.username or "").strip()
    password = req.password or ""
    if not username or not password:
        raise HTTPException(status_code=400, detail="Invalid user")

    def _work(session):
        if session.exec(select(User).where(User.username == username)).first():
            raise HTTPException(status_code=400, detail="User exists")
        u = User(
            username=username,
            password_hash=hash_password(password),
            display_name=req.display_name,
            is_active=bool(req.is_active),
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        session.add(u)
        session.commit()
        session.refresh(u)
        return {"id": str(u.id), "username": u.username, "display_name": u.display_name, "is_active": u.is_active, "role_ids": []}

    return {"ok": True, "user": await run_db(_work)}


@router.put("/admin/users/{user_id}", dependencies=[Depends(require_permission("rbac:manage"))])
async def update_user(user_id: str, req: UpdateUserRequest):
    uid = uuid.UUID(user_id)

    def _work(session):
        u = session.get(User, uid)
        if not u:
            raise HTTPException(status_code=404, detail="User not found")
        if req.display_name is not None:
            u.display_name = req.display_name
        if req.is_active is not None:
            u.is_active = bool(req.is_active)
        u.updated_at = datetime.utcnow()
        session.add(u)
        session.commit()
        return True

    await run_db(_work)
    if req.is_active is not None and not bool(req.is_active):
        r = get_redis()
        if r is not None:
            try:
                key = f"user_sess:{uid}"
                jtis = list(r.smembers(key) or [])
                if jtis:
                    r.delete(*[f"sess:{x}" for x in jtis])
                r.delete(key)
            except Exception:
                pass
    return {"ok": True}


@router.post("/admin/users/{user_id}/reset_password", dependencies=[Depends(require_permission("rbac:manage"))])
async def reset_password(user_id: str, req: ResetPasswordRequest):
    uid = uuid.UUID(user_id)
    if not req.password:
        raise HTTPException(status_code=400, detail="Invalid password")

    def _work(session):
        u = session.get(User, uid)
        if not u:
            raise HTTPException(status_code=404, detail="User not found")
        u.password_hash = hash_password(req.password)
        u.updated_at = datetime.utcnow()
        session.add(u)
        session.commit()
        return True

    await run_db(_work)
    return {"ok": True}


@router.post("/admin/users/{user_id}/roles", dependencies=[Depends(require_permission("rbac:manage"))])
async def set_user_roles(user_id: str, req: SetUserRolesRequest):
    uid = uuid.UUID(user_id)
    rids = [uuid.UUID(x) for x in (req.role_ids or [])]

    def _work(session):
        u = session.get(User, uid)
        if not u:
            raise HTTPException(status_code=404, detail="User not found")
        session.exec(delete(UserRole).where(UserRole.user_id == uid))
        for rid in rids:
            session.add(UserRole(user_id=uid, role_id=rid))
        u.updated_at = datetime.utcnow()
        session.add(u)
        session.commit()
        return True

    await run_db(_work)
    return {"ok": True}


@router.post("/admin/users/{user_id}/kick", dependencies=[Depends(require_permission("rbac:manage"))])
async def kick_user(user_id: str):
    uid = uuid.UUID(user_id)
    r = get_redis()
    if r is not None:
        try:
            key = f"user_sess:{uid}"
            jtis = list(r.smembers(key) or [])
            if jtis:
                r.delete(*[f"sess:{x}" for x in jtis])
            r.delete(key)
        except Exception:
            pass
    return {"ok": True}
