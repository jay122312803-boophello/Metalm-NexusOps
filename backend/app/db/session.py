import os
from typing import Callable, TypeVar

from dotenv import load_dotenv
from sqlmodel import Session, create_engine
from starlette.concurrency import run_in_threadpool

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

