from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv

from .api.router import api_router


def create_app() -> FastAPI:
    load_dotenv()
    app = FastAPI(title="NexusOps API")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(api_router)

    base_dir = Path(__file__).resolve().parents[2]
    dist_dir = base_dir / "frontend" / "dist"
    index_path = dist_dir / "index.html"

    if dist_dir.exists():
        if (dist_dir / "assets").exists():
            app.mount("/assets", StaticFiles(directory=str(dist_dir / "assets")), name="assets")

        @app.get("/")
        def spa_root():
            if index_path.exists():
                return FileResponse(str(index_path))
            return {"ok": False, "detail": "frontend not built"}

        @app.get("/{full_path:path}")
        def spa(full_path: str):
            if full_path.startswith("api/"):
                return {"ok": False, "detail": "Not Found"}
            if index_path.exists():
                return FileResponse(str(index_path))
            return {"ok": False, "detail": "frontend not built"}

    return app


app = create_app()
