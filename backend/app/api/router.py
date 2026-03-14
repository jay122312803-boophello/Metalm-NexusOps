from fastapi import APIRouter

from .routes import configs, deployments, events, history, repos, servers

api_router = APIRouter()

api_router.include_router(servers.router, prefix="/api/servers", tags=["servers"])
api_router.include_router(repos.router, prefix="/api/repos", tags=["repos"])
api_router.include_router(deployments.router, prefix="/api/deployments", tags=["deployments"])
api_router.include_router(history.router, prefix="/api/history", tags=["history"])
api_router.include_router(configs.router, prefix="/api", tags=["configs"])
api_router.include_router(events.router, prefix="/api", tags=["events"])
