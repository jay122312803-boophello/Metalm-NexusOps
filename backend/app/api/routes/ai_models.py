import uuid
from datetime import datetime
from typing import Optional

import anyio
import requests
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import select

from ...auth.deps import require_permission
from ...db.models import AIModelConfig
from ...db.session import run_db
from ...utils.datetime_fmt import iso_app

router = APIRouter()


def _chat_completions_url(base_url: str) -> str:
    b = (base_url or "").strip().rstrip("/")
    if not b:
        return ""
    if b.endswith("/v1"):
        return f"{b}/chat/completions"
    return f"{b}/v1/chat/completions"


class AIModelConfigIn(BaseModel):
    name: str
    model: str
    base_url: str
    api_key: Optional[str] = None
    system_prompt: str = ""
    temperature: float = 0.2
    max_history: int = 10


class AIModelConfigUpdate(BaseModel):
    name: Optional[str] = None
    model: Optional[str] = None
    base_url: Optional[str] = None
    api_key: Optional[str] = None
    system_prompt: Optional[str] = None
    temperature: Optional[float] = None
    max_history: Optional[int] = None


class AIModelConfigOut(BaseModel):
    id: str
    name: str
    model: str
    base_url: str
    system_prompt: str
    temperature: float
    max_history: int
    is_active: bool
    has_key: bool
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


def _validate_payload(p: AIModelConfigIn | AIModelConfigUpdate) -> None:
    if isinstance(p, AIModelConfigIn):
        if not (p.name or "").strip():
            raise HTTPException(400, "Invalid name")
        if not (p.model or "").strip():
            raise HTTPException(400, "Invalid model")
        if not (p.base_url or "").strip():
            raise HTTPException(400, "Invalid base_url")
    if hasattr(p, "temperature") and p.temperature is not None:
        try:
            t = float(p.temperature)
        except Exception:
            raise HTTPException(400, "Invalid temperature")
        if t < 0.0 or t > 2.0:
            raise HTTPException(400, "Invalid temperature")
    if hasattr(p, "max_history") and p.max_history is not None:
        try:
            mh = int(p.max_history)
        except Exception:
            raise HTTPException(400, "Invalid max_history")
        if mh < 1 or mh > 50:
            raise HTTPException(400, "Invalid max_history")


def _to_out(m: AIModelConfig) -> AIModelConfigOut:
    return AIModelConfigOut(
        id=str(m.id),
        name=m.name,
        model=m.model,
        base_url=m.base_url,
        system_prompt=m.system_prompt or "",
        temperature=float(m.temperature or 0.0),
        max_history=int(m.max_history or 0),
        is_active=bool(m.is_active),
        has_key=bool((m.api_key or "").strip()),
        created_at=iso_app(m.created_at),
        updated_at=iso_app(m.updated_at),
    )


@router.get("/models")
async def list_models(user=Depends(require_permission("ai:manage"))):
    def _work(session):
        rows = session.exec(select(AIModelConfig).where(AIModelConfig.is_deleted == False).order_by(AIModelConfig.created_at.desc())).all()
        return [_to_out(x).model_dump() for x in rows]

    return await run_db(_work)


@router.post("/models")
async def create_model(body: AIModelConfigIn, activate: bool = True, user=Depends(require_permission("ai:manage"))):
    _validate_payload(body)
    if activate and not (body.api_key or "").strip():
        raise HTTPException(400, "Missing api_key")

    def _work(session):
        now = datetime.utcnow()
        m = AIModelConfig(
            name=(body.name or "").strip(),
            model=(body.model or "").strip(),
            base_url=(body.base_url or "").strip(),
            api_key=(body.api_key or "").strip(),
            system_prompt=str(body.system_prompt or ""),
            temperature=float(body.temperature),
            max_history=int(body.max_history),
            is_active=False,
            is_deleted=False,
            created_by_user_id=user.id if user else None,
            created_at=now,
            updated_at=now,
        )
        session.add(m)
        session.commit()
        session.refresh(m)

        if activate:
            for other in session.exec(select(AIModelConfig).where(AIModelConfig.id != m.id, AIModelConfig.is_deleted == False, AIModelConfig.is_active == True)).all():
                other.is_active = False
                other.updated_at = now
                session.add(other)
            m.is_active = True
            m.updated_at = now
            session.add(m)
            session.commit()
            session.refresh(m)

        return _to_out(m).model_dump()

    return await run_db(_work)


@router.put("/models/{model_id}")
async def update_model(model_id: str, body: AIModelConfigUpdate, activate: bool = False, user=Depends(require_permission("ai:manage"))):
    _validate_payload(body)
    try:
        mid = uuid.UUID(model_id)
    except Exception:
        raise HTTPException(400, "Invalid model id")

    def _work(session):
        m = session.get(AIModelConfig, mid)
        if not m or m.is_deleted:
            raise HTTPException(404, "Model not found")
        now = datetime.utcnow()
        if body.name is not None:
            m.name = (body.name or "").strip()
        if body.model is not None:
            m.model = (body.model or "").strip()
        if body.base_url is not None:
            m.base_url = (body.base_url or "").strip()
        if body.system_prompt is not None:
            m.system_prompt = str(body.system_prompt or "")
        if body.temperature is not None:
            m.temperature = float(body.temperature)
        if body.max_history is not None:
            m.max_history = int(body.max_history)
        if body.api_key is not None:
            k = (body.api_key or "").strip()
            if k:
                m.api_key = k
        if activate:
            if not (m.api_key or "").strip():
                raise HTTPException(400, "Missing api_key")
            if not (m.base_url or "").strip() or not (m.model or "").strip():
                raise HTTPException(400, "Invalid config")
        m.updated_at = now
        session.add(m)
        session.commit()
        session.refresh(m)

        if activate:
            for other in session.exec(select(AIModelConfig).where(AIModelConfig.id != m.id, AIModelConfig.is_deleted == False, AIModelConfig.is_active == True)).all():
                other.is_active = False
                other.updated_at = now
                session.add(other)
            m.is_active = True
            m.updated_at = now
            session.add(m)
            session.commit()
            session.refresh(m)

        return _to_out(m).model_dump()

    return await run_db(_work)


@router.post("/models/{model_id}/activate")
async def activate_model(model_id: str, user=Depends(require_permission("ai:manage"))):
    try:
        mid = uuid.UUID(model_id)
    except Exception:
        raise HTTPException(400, "Invalid model id")

    def _work(session):
        m = session.get(AIModelConfig, mid)
        if not m or m.is_deleted:
            raise HTTPException(404, "Model not found")
        if not (m.api_key or "").strip() or not (m.base_url or "").strip() or not (m.model or "").strip():
            raise HTTPException(400, "Invalid config")
        now = datetime.utcnow()
        for other in session.exec(select(AIModelConfig).where(AIModelConfig.id != m.id, AIModelConfig.is_deleted == False, AIModelConfig.is_active == True)).all():
            other.is_active = False
            other.updated_at = now
            session.add(other)
        m.is_active = True
        m.updated_at = now
        session.add(m)
        session.commit()
        session.refresh(m)
        return _to_out(m).model_dump()

    return await run_db(_work)


@router.delete("/models/{model_id}")
async def delete_model(model_id: str, user=Depends(require_permission("ai:manage"))):
    try:
        mid = uuid.UUID(model_id)
    except Exception:
        raise HTTPException(400, "Invalid model id")

    def _work(session):
        m = session.get(AIModelConfig, mid)
        if not m or m.is_deleted:
            raise HTTPException(404, "Model not found")
        if m.is_active:
            raise HTTPException(400, "Active model cannot be deleted")
        m.is_deleted = True
        m.updated_at = datetime.utcnow()
        session.add(m)
        session.commit()
        return {"ok": True}

    return await run_db(_work)


@router.post("/models/test")
async def test_connection(body: AIModelConfigIn, user=Depends(require_permission("ai:manage"))):
    _validate_payload(body)
    base_url = (body.base_url or "").strip()
    api_key = (body.api_key or "").strip()
    model = (body.model or "").strip()
    if not base_url or not api_key or not model:
        raise HTTPException(400, "Missing base_url/api_key/model")
    url = _chat_completions_url(base_url)
    if not url:
        raise HTTPException(400, "Invalid base_url")
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {
        "model": model,
        "messages": [{"role": "system", "content": str(body.system_prompt or "")}, {"role": "user", "content": "ping"}]
        if (body.system_prompt or "").strip()
        else [{"role": "user", "content": "ping"}],
        "temperature": float(body.temperature),
        "stream": False,
        "max_tokens": 1,
    }
    try:
        r = await anyio.to_thread.run_sync(lambda: requests.post(url, headers=headers, json=payload, timeout=12))
    except Exception:
        raise HTTPException(400, "Connection failed")
    if not r.ok:
        raise HTTPException(400, "Connection failed")
    return {"ok": True}
