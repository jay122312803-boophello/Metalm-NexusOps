from fastapi import APIRouter

from .routes import ai_models, auth, chat, configs, deployments, events, history, monitor, overview, repos, servers
from .routes import admin_rbac

api_router = APIRouter()

api_router.include_router(auth.router, prefix="/api", tags=["auth"])
api_router.include_router(admin_rbac.router, prefix="/api", tags=["admin"])
api_router.include_router(ai_models.router, prefix="/api/admin/ai", tags=["ai"])
api_router.include_router(chat.router, prefix="/api/v1/chat", tags=["chat"])
api_router.include_router(servers.router, prefix="/api/servers", tags=["servers"])
api_router.include_router(repos.router, prefix="/api/repos", tags=["repos"])
api_router.include_router(deployments.router, prefix="/api/deployments", tags=["deployments"])
api_router.include_router(monitor.router, prefix="/api/deployments", tags=["monitor"])
api_router.include_router(history.router, prefix="/api/history", tags=["history"])
api_router.include_router(overview.router, prefix="/api", tags=["overview"])
api_router.include_router(configs.router, prefix="/api", tags=["configs"])
api_router.include_router(events.router, prefix="/api", tags=["events"])
