import os
import uuid

from sqlmodel import Session, SQLModel, select

from app.auth.security import hash_password
from app.db.models import Permission, Role, RolePermission, User, UserRole
from app.db.session import engine


def _p_defs():
    return [
        ("RBAC 管理", "rbac:manage", "api"),
        ("概览大屏", "page:overview", "page"),
        ("部署大盘", "page:dashboard", "page"),
        ("审计日志", "page:history", "page"),
        ("系统设置", "page:settings", "page"),
        ("服务器读取", "servers:read", "api"),
        ("服务器管理", "servers:manage", "api"),
        ("服务器监控", "servers:metrics", "api"),
        ("仓库读取", "repos:read", "api"),
        ("仓库管理", "repos:manage", "api"),
        ("实例读取", "deployments:read", "api"),
        ("实例管理", "deployments:manage", "api"),
        ("触发部署", "deploy:trigger", "api"),
        ("配置读取", "configs:read", "api"),
        ("配置管理", "configs:manage", "api"),
        ("审计读取", "history:read", "api"),
        ("审计删除", "history:delete", "api"),
        ("事件读取", "events:read", "api"),
        ("容器监控", "monitor:read", "api"),
    ]


def main():
    SQLModel.metadata.create_all(engine)

    admin_user = (os.getenv("NEXUSOPS_ADMIN_USER") or "admin").strip() or "admin"
    admin_pass = (os.getenv("NEXUSOPS_ADMIN_PASS") or "admin123").strip() or "admin123"
    reset = (os.getenv("NEXUSOPS_ADMIN_RESET") or "").strip() == "1"

    with Session(engine) as session:
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

