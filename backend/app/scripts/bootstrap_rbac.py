import os
import uuid

from sqlmodel import Session, SQLModel, select
from sqlalchemy import text

from app.auth.security import hash_password
from app.db.models import Permission, Role, RolePermission, User, UserRole
from app.db.session import engine


def _p_defs():
    return [
        ("RBAC 管理", "rbac:manage", "api"),
        ("概览大屏", "overview:read", "page"),
        ("部署大盘", "deploy:manage", "page"),
        ("审计日志", "audit:read", "page"),
        ("系统设置", "settings:access", "page"),
        ("基础资源管理", "infra:manage", "api"),
        ("审计管理", "audit:manage", "api"),
        ("容器监控", "monitor:read", "api"),
    ]


def main():
    SQLModel.metadata.create_all(engine)

    admin_user = (os.getenv("NEXUSOPS_ADMIN_USER") or "admin").strip() or "admin"
    admin_pass = (os.getenv("NEXUSOPS_ADMIN_PASS") or "admin123").strip() or "admin123"
    reset = (os.getenv("NEXUSOPS_ADMIN_RESET") or "").strip() == "1"

    with Session(engine) as session:
        session.exec(text("ALTER TABLE permissions ADD COLUMN IF NOT EXISTS is_visible boolean NOT NULL DEFAULT true"))
        session.commit()
        perm_by_code = {}
        for name, code, typ in _p_defs():
            p = session.exec(select(Permission).where(Permission.code == code)).first()
            if not p:
                p = Permission(name=name, code=code, type=typ)
                session.add(p)
                session.commit()
                session.refresh(p)
            perm_by_code[code] = p

        r_admin = session.exec(select(Role).where(Role.code == "admin")).first()
        if not r_admin:
            r_admin = Role(name="管理员", code="admin")
            session.add(r_admin)
            session.commit()
            session.refresh(r_admin)

        u = session.exec(select(User).where(User.username == admin_user)).first()
        if not u:
            u = User(username=admin_user, password_hash=hash_password(admin_pass), display_name="Admin", is_active=True)
            session.add(u)
            session.commit()
            session.refresh(u)
        elif reset:
            u.password_hash = hash_password(admin_pass)
            u.is_active = True
            session.add(u)
            session.commit()

        if not session.exec(select(UserRole).where(UserRole.user_id == u.id, UserRole.role_id == r_admin.id)).first():
            session.add(UserRole(user_id=u.id, role_id=r_admin.id))
            session.commit()

        existing = {
            (str(x.role_id), str(x.permission_id))
            for x in session.exec(select(RolePermission).where(RolePermission.role_id == r_admin.id)).all()
        }
        for p in perm_by_code.values():
            key = (str(r_admin.id), str(p.id))
            if key in existing:
                continue
            session.add(RolePermission(role_id=r_admin.id, permission_id=p.id))
        session.commit()

    print(f"ok: admin={admin_user} role=admin perms={len(perm_by_code)}")


if __name__ == "__main__":
    main()
