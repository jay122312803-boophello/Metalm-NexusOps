import os
import time
from typing import Callable, TypeVar

from dotenv import load_dotenv
from sqlmodel import Session, SQLModel, create_engine
from starlette.concurrency import run_in_threadpool
from sqlalchemy import text
load_dotenv()


T = TypeVar("T")


def _dsn() -> str:
    url = (os.getenv("DATABASE_URL") or os.getenv("NEXUSOPS_DATABASE_URL") or "").strip()
    if url:
        if "+psycopg" in url:
            return url
        if url.startswith("postgresql://"):
            return url.replace("postgresql://", "postgresql+psycopg://", 1)
        if url.startswith("postgres://"):
            return url.replace("postgres://", "postgresql+psycopg://", 1)
        return url

    host = (os.getenv("PGHOST") or os.getenv("NEXUSOPS_PG_HOST") or "127.0.0.1").strip()
    port = int((os.getenv("PGPORT") or os.getenv("NEXUSOPS_PG_PORT") or "23012").strip())
    user = (os.getenv("PGUSER") or os.getenv("NEXUSOPS_PG_USER") or "postgres").strip()
    password = (os.getenv("PGPASSWORD") or os.getenv("NEXUSOPS_PG_PASS") or "metalm2024").strip()
    db = (os.getenv("PGDATABASE") or os.getenv("NEXUSOPS_PG_DB") or "nexusops_db").strip()
    return f"postgresql+psycopg://{user}:{password}@{host}:{port}/{db}"


engine = create_engine(_dsn(), pool_pre_ping=True)


def _run_in_session(fn: Callable[[Session], T]) -> T:
    with Session(engine) as session:
        return fn(session)


async def run_db(fn: Callable[[Session], T]) -> T:
    return await run_in_threadpool(_run_in_session, fn)


async def init_db() -> None:
    __import__("app.db.models")

    def _work():
        last_err = None
        for _ in range(30):
            try:
                with engine.begin() as conn:
                    conn.execute(text("SELECT 1"))
                last_err = None
                break
            except Exception as e:
                last_err = e
                time.sleep(1)
        if last_err is not None:
            raise last_err

        SQLModel.metadata.create_all(engine)
        with engine.begin() as conn:
            try:
                conn.execute(text("CREATE EXTENSION IF NOT EXISTS pgcrypto"))
            except Exception:
                pass

            conn.execute(text("ALTER TABLE servers ADD COLUMN IF NOT EXISTS ssh_key text"))
            conn.execute(text("ALTER TABLE servers ADD COLUMN IF NOT EXISTS environment text"))
            conn.execute(text("ALTER TABLE servers ALTER COLUMN environment SET DEFAULT 'OTHER'"))
            conn.execute(text("UPDATE servers SET environment = 'OTHER' WHERE environment IS NULL OR btrim(environment) = ''"))
            conn.execute(
                text(
                    """
                    UPDATE servers
                    SET environment = CASE
                      WHEN name ILIKE '%生产%' OR name ILIKE '%prod%' THEN 'PROD'
                      WHEN name ILIKE '%测试%' OR name ILIKE '%test%' THEN 'TEST'
                      WHEN name ILIKE '%开发%' OR name ILIKE '%dev%' THEN 'DEV'
                      ELSE environment
                    END
                    WHERE environment = 'OTHER'
                    """
                )
            )
            conn.execute(text("ALTER TABLE deployments ADD COLUMN IF NOT EXISTS input_dir text"))
            conn.execute(text("ALTER TABLE deployments ADD COLUMN IF NOT EXISTS dest_dir text"))
            conn.execute(text("ALTER TABLE deployments ADD COLUMN IF NOT EXISTS deploy_script text"))
            conn.execute(text("ALTER TABLE repos ALTER COLUMN branch SET DEFAULT 'master'"))
            conn.execute(text("ALTER TABLE servers ALTER COLUMN ssh_user SET DEFAULT 'metalm'"))
            conn.execute(text("ALTER TABLE servers ALTER COLUMN environment SET NOT NULL"))

            conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_servers_name ON servers (name)"))
            conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_repos_name ON repos (name)"))
            conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_deployments_name ON deployments (name)"))

            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_history_created_at ON deployment_history(created_at DESC)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_history_deployment_id ON deployment_history(deployment_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_history_status ON deployment_history(status)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_deployments_server_id ON deployments(server_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_deployments_repo_id ON deployments(repo_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_task_configs_deployment_id ON task_configs(deployment_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_task_config_snapshots_history_id ON task_config_snapshots(history_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_task_config_snapshot_files_snapshot_id ON task_config_snapshot_files(snapshot_id)"))

    await run_in_threadpool(_work)
