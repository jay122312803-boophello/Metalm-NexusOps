import os
import posixpath
import uuid
from datetime import datetime

import requests
from fastapi import APIRouter, Depends, HTTPException, Request

from sqlmodel import select

from ...db.models import Deployment, DeploymentHistory, Repo, Server, TaskConfig
from ...db.session import run_db
from ...schemas import CreateDeploymentRequest, TriggerDeploymentRequest, UpdateDeploymentRequest
from ...auth.deps import require_permission
from ...auth.security import create_access_token

router = APIRouter()

def _norm_posix(p: str) -> str:
    s = (p or "").strip().replace("\\", "/")
    if not s:
        return ""
    if not s.startswith("/"):
        return ""
    return posixpath.normpath(s)


def _validate_dest_dir(dest_dir: str | None, deploy_path: str | None) -> str | None:
    if dest_dir is None:
        return None
    raw = str(dest_dir).strip().replace("\\", "/")
    if raw == "":
        return None

    base = _norm_posix(str(deploy_path or ""))
    if not base:
        raise HTTPException(status_code=400, detail="该服务器未配置部署路径，请先在系统设置-服务器管理中设置。")

    cand = _norm_posix(raw)
    if not cand:
        raise HTTPException(status_code=400, detail="服务器目标路径必须为绝对路径（以 / 开头）。")

    prefix = base if base.endswith("/") else f"{base}/"
    if cand == base or cand.startswith(prefix):
        return cand
    raise HTTPException(status_code=400, detail=f"服务器目标路径必须位于服务器部署路径下：{base}")


@router.get("")
async def list_deployments(user=Depends(require_permission("deploy:manage"))):
    def _work(session):
        rows = session.query(Deployment).filter(Deployment.created_by_user_id == user.id).order_by(Deployment.created_at.asc()).all()
        return [
            {
                "id": str(d.id),
                "name": d.name,
                "server_id": str(d.server_id),
                "repo_id": str(d.repo_id),
                "input_dir": d.input_dir,
                "dest_dir": d.dest_dir,
                "deploy_script": d.deploy_script,
                "created_at": d.created_at.isoformat() if d.created_at else None,
            }
            for d in rows
        ]

    return await run_db(_work)


@router.post("")
async def create_deployment(req: CreateDeploymentRequest, user=Depends(require_permission("deploy:manage"))):
    data = req.model_dump()

    def _work(session):
        name = (data.get("name") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="name required")
        exists = session.query(Deployment).filter(Deployment.created_by_user_id == user.id, Deployment.name == name).first()
        if exists:
            raise HTTPException(status_code=409, detail="任务名称已存在，请更换")
        server_id = uuid.UUID(data["server_id"])
        repo_id = uuid.UUID(data["repo_id"])
        s = session.get(Server, server_id)
        r = session.get(Repo, repo_id)
        if not s or s.created_by_user_id != user.id:
            raise HTTPException(status_code=404, detail="Server configuration not found")
        if not r or r.created_by_user_id != user.id:
            raise HTTPException(status_code=404, detail="Repository configuration not found")
        dest_dir = _validate_dest_dir(data.get("dest_dir"), s.deploy_path)
        d = Deployment(
            name=name,
            server_id=server_id,
            repo_id=repo_id,
            input_dir=(data.get("input_dir") or None),
            dest_dir=dest_dir,
            deploy_script=(data.get("deploy_script") or None),
            created_by_user_id=user.id,
        )
        session.add(d)
        session.commit()
        session.refresh(d)
        return {
            "id": str(d.id),
            "name": d.name,
            "server_id": str(d.server_id),
            "repo_id": str(d.repo_id),
            "input_dir": d.input_dir,
            "dest_dir": d.dest_dir,
            "deploy_script": d.deploy_script,
            "created_at": d.created_at.isoformat() if d.created_at else None,
        }

    return await run_db(_work)


@router.get("/{dep_id}")
async def get_deployment(dep_id: str, user=Depends(require_permission("deploy:manage"))):
    def _work(session):
        d = session.get(Deployment, uuid.UUID(dep_id))
        if not d or d.created_by_user_id != user.id:
            raise HTTPException(status_code=404, detail="Deployment not found")
        return {
            "id": str(d.id),
            "name": d.name,
            "server_id": str(d.server_id),
            "repo_id": str(d.repo_id),
            "input_dir": d.input_dir,
            "dest_dir": d.dest_dir,
            "deploy_script": d.deploy_script,
            "created_at": d.created_at.isoformat() if d.created_at else None,
        }

    return await run_db(_work)


@router.put("/{dep_id}")
async def update_deployment(dep_id: str, req: UpdateDeploymentRequest, user=Depends(require_permission("deploy:manage"))):
    data = req.model_dump(exclude_unset=True)

    def _work(session):
        d = session.get(Deployment, uuid.UUID(dep_id))
        if not d or d.created_by_user_id != user.id:
            raise HTTPException(status_code=404, detail="Deployment not found")

        if "name" in data and data["name"] is not None:
            name = str(data["name"]).strip()
            if not name:
                raise HTTPException(status_code=400, detail="name required")
            exists = session.query(Deployment).filter(Deployment.created_by_user_id == user.id, Deployment.name == name, Deployment.id != d.id).first()
            if exists:
                raise HTTPException(status_code=409, detail="任务名称已存在，请更换")
            data["name"] = name

        if "server_id" in data and data["server_id"] is not None:
            sid = uuid.UUID(str(data["server_id"]))
            s = session.get(Server, sid)
            if not s or s.created_by_user_id != user.id:
                raise HTTPException(status_code=404, detail="Server configuration not found")
            data["server_id"] = sid
        if "repo_id" in data and data["repo_id"] is not None:
            rid = uuid.UUID(str(data["repo_id"]))
            r = session.get(Repo, rid)
            if not r or r.created_by_user_id != user.id:
                raise HTTPException(status_code=404, detail="Repository configuration not found")
            data["repo_id"] = rid

        effective_server_id = data.get("server_id") or d.server_id
        s = session.get(Server, effective_server_id)
        if not s or s.created_by_user_id != user.id:
            raise HTTPException(status_code=404, detail="Server configuration not found")
        effective_dest_dir = data["dest_dir"] if "dest_dir" in data else d.dest_dir
        data["dest_dir"] = _validate_dest_dir(effective_dest_dir, s.deploy_path)

        for k, v in data.items():
            if k in {"input_dir", "dest_dir", "deploy_script"} and v is not None and str(v).strip() == "":
                v = None
            setattr(d, k, v)

        session.add(d)
        session.commit()
        session.refresh(d)
        return {"ok": True}

    return await run_db(_work)


@router.delete("/{dep_id}")
async def delete_deployment(dep_id: str, user=Depends(require_permission("deploy:manage"))):
    def _work(session):
        d = session.get(Deployment, uuid.UUID(dep_id))
        if not d or d.created_by_user_id != user.id:
            return False
        session.delete(d)
        session.commit()
        return True

    ok = await run_db(_work)
    if not ok:
        raise HTTPException(status_code=404, detail="Deployment not found")
    return {"ok": True}


@router.post("/{dep_id}/trigger")
async def trigger_deployment(dep_id: str, request: Request, req: TriggerDeploymentRequest = TriggerDeploymentRequest(), user=Depends(require_permission("deploy:manage"))):
    payload = req.model_dump()
    api_base = (os.getenv("NEXUSOPS_PUBLIC_API_BASE_URL") or os.getenv("NEXUSOPS_API_BASE_URL") or "").rstrip("/")
    if not api_base:
        forwarded = (request.headers.get("forwarded") or "").split(",")[0].strip()
        f_proto = ""
        f_host = ""
        if forwarded:
            parts = [x.strip() for x in forwarded.split(";") if x.strip()]
            for p in parts:
                if "=" not in p:
                    continue
                k, v = p.split("=", 1)
                k = k.strip().lower()
                v = v.strip().strip('"')
                if k == "proto" and not f_proto:
                    f_proto = v
                if k == "host" and not f_host:
                    f_host = v

        xf_proto = (request.headers.get("x-forwarded-proto") or "").split(",")[0].strip()
        xf_host = (request.headers.get("x-forwarded-host") or "").split(",")[0].strip()
        xf_port = (request.headers.get("x-forwarded-port") or "").split(",")[0].strip()
        host = f_host or xf_host or (request.headers.get("host") or "").strip()
        scheme = f_proto or xf_proto or request.url.scheme
        if host:
            if xf_port and ":" not in host:
                try:
                    p = int(xf_port)
                    if (scheme == "http" and p != 80) or (scheme == "https" and p != 443):
                        host = f"{host}:{p}"
                except ValueError:
                    pass
            api_base = f"{scheme}://{host}".rstrip("/")

    def _work(session):
        d = session.get(Deployment, uuid.UUID(dep_id))
        if not d or d.created_by_user_id != user.id:
            raise HTTPException(status_code=404, detail="Deployment not found")

        s = session.get(Server, d.server_id)
        r = session.get(Repo, d.repo_id)
        if not s or s.created_by_user_id != user.id:
            raise HTTPException(status_code=404, detail="Server configuration not found")
        if not r or r.created_by_user_id != user.id:
            raise HTTPException(status_code=404, detail="Repository configuration not found")

        src_ref = r.branch or os.getenv("TRIGGER_REF") or "master"

        ci_project = (os.getenv("NEXUSOPS_CI_PROJECT") or "").strip()
        ci_repo = None
        if not ci_project:
            ci_repo = session.exec(
                select(Repo)
                .where(Repo.created_by_user_id == user.id)
                .where(Repo.name == "Metalm-NexusOps")
            ).first()
            if not ci_repo:
                ci_repo = session.exec(
                    select(Repo)
                    .where(Repo.created_by_user_id == user.id)
                    .where(Repo.url.contains("Metalm-NexusOps"))
                ).first()

        use_ci_repo = bool(
            ci_repo
            and (ci_repo.project_id or "").strip()
            and (((ci_repo.trigger_token or "").strip()) or ((ci_repo.private_token or "").strip()))
        )

        project_id = (
            ci_project
            or ((ci_repo.project_id or "").strip() if use_ci_repo else "")
            or (r.project_id or "")
            or os.getenv("GITLAB_PROJECT")
        )
        if not project_id:
            raise HTTPException(status_code=400, detail="Project ID not configured in repo")

        gitlab_url = (os.getenv("GITLAB_BASE_URL") or "https://gitlab.xuelangyun.com").rstrip("/")
        trigger_ref = ((ci_repo.branch or "").strip() if use_ci_repo else "") or src_ref

        if ci_project:
            trigger_token = (os.getenv("NEXUSOPS_CI_TRIGGER_TOKEN") or os.getenv("TRIGGER_TOKEN") or "").strip() or None
            private_token = (os.getenv("NEXUSOPS_CI_PRIVATE_TOKEN") or os.getenv("PRIVATE_TOKEN") or "").strip() or None
        elif use_ci_repo:
            trigger_token = (ci_repo.trigger_token or "").strip() or None
            private_token = (ci_repo.private_token or "").strip() or None
        else:
            trigger_token = (r.trigger_token or "").strip() or (os.getenv("TRIGGER_TOKEN") or "").strip() or None
            private_token = (r.private_token or "").strip() or (os.getenv("PRIVATE_TOKEN") or "").strip() or None

        variables = {}
        req_vars = payload.get("variables") or {}
        for k, v in req_vars.items():
            if v is not None and str(v).strip() != "":
                variables[k] = v
        if "NEXUSOPS_MANUAL_DEPLOY" not in variables:
            variables["NEXUSOPS_MANUAL_DEPLOY"] = "1"
        variables["SERVER_HOST"] = s.address
        variables["SERVER_USER"] = s.ssh_user or "metalm"
        if getattr(s, "ssh_key", None):
            variables["SERVER_SSH_KEY"] = s.ssh_key
        variables["INPUT_DIR"] = (d.input_dir or "").strip() or "./"
        variables["DEST_DIR"] = (d.dest_dir or "").strip() or s.deploy_path
        if d.deploy_script:
            variables["CUSTOM_DEPLOY_SCRIPT"] = d.deploy_script
        variables["NEXUSOPS_SOURCE_REPO_URL"] = (r.url or "").strip()
        variables["NEXUSOPS_SOURCE_REPO_REF"] = src_ref
        if not variables["NEXUSOPS_SOURCE_REPO_URL"]:
            raise HTTPException(status_code=400, detail="Repository URL not configured")
        if (r.private_token or "").strip():
            variables["NEXUSOPS_GIT_HTTP_TOKEN"] = (r.private_token or "").strip()

        verify_tls = (os.getenv("GITLAB_TLS_INSECURE") or "").strip() != "1"

        h = DeploymentHistory(
            deployment_id=d.id,
            pipeline_id=None,
            status="pending",
            ref=src_ref,
            web_url=None,
            created_at=datetime.utcnow(),
            server_snapshot={
                "id": str(s.id),
                "name": s.name,
                "address": s.address,
                "ssh_user": s.ssh_user,
                "deploy_path": s.deploy_path,
            },
            repo_snapshot={
                "id": str(r.id),
                "name": r.name,
                "url": r.url,
                "branch": src_ref,
                "project_id": (r.project_id or "").strip() or None,
                "ci_project_id": project_id,
                "ci_ref": trigger_ref,
                "ci_repo_id": str(ci_repo.id) if use_ci_repo and ci_repo else None,
            },
            variables={},
        )
        session.add(h)
        session.commit()
        session.refresh(h)

        variables["NEXUSOPS_HISTORY_ID"] = str(h.id)
        if api_base:
            variables["NEXUSOPS_API_URL"] = api_base
            variables["NEXUSOPS_API_BASE_URL"] = api_base
            if "NEXUSOPS_CONFIG_ZIP_URL" not in variables:
                variables["NEXUSOPS_CONFIG_ZIP_URL"] = f"{api_base}/api/deployments/{d.id}/configs.zip"

        try:
            token, _, _ = create_access_token(str(user.id))
            variables["NEXUSOPS_API_TOKEN"] = token
        except Exception:
            pass

        variables_for_history = {k: v for k, v in variables.items() if k not in {"SERVER_SSH_KEY", "NEXUSOPS_GIT_HTTP_TOKEN", "NEXUSOPS_API_TOKEN"}}
        h.variables = variables_for_history
        session.add(h)
        session.commit()

        cfg_rows = session.exec(select(TaskConfig.rel_path, TaskConfig.content).where(TaskConfig.deployment_id == d.id)).all()
        config_files = [rp for rp, _ in cfg_rows]
        try:
            from ...db.models import TaskConfigSnapshot, TaskConfigSnapshotFile

            snap = TaskConfigSnapshot(history_id=h.id, deployment_id=d.id, created_at=datetime.utcnow())
            session.add(snap)
            session.commit()
            session.refresh(snap)
            for rel_path, content in cfg_rows:
                session.add(
                    TaskConfigSnapshotFile(
                        snapshot_id=snap.id,
                        rel_path=rel_path,
                        content=content or "",
                        created_at=datetime.utcnow(),
                    )
                )
            session.commit()
        except Exception:
            pass

        resp = None
        try:
            if trigger_token:
                url = f"{gitlab_url}/api/v4/projects/{requests.utils.quote(project_id, safe='')}/trigger/pipeline"
                form = {"token": trigger_token, "ref": trigger_ref}
                for k, v in variables.items():
                    form[f"variables[{k}]"] = str(v)
                resp = requests.post(url, data=form, verify=verify_tls, timeout=15)
            elif private_token:
                url = f"{gitlab_url}/api/v4/projects/{requests.utils.quote(project_id, safe='')}/pipeline"
                headers = {"PRIVATE-TOKEN": private_token}
                form = {"ref": trigger_ref}
                for k, v in variables.items():
                    form[f"variables[{k}]"] = str(v)
                resp = requests.post(url, headers=headers, data=form, verify=verify_tls, timeout=15)
            else:
                raise HTTPException(status_code=400, detail="No token configured for repository")

            resp.raise_for_status()
            data = resp.json()
        except requests.HTTPError:
            status_code = resp.status_code if resp is not None else 500
            body = None
            try:
                body = resp.json() if resp is not None else None
            except Exception:
                body = (resp.text[:2000] if resp is not None else None)
            h.status = "failed"
            session.add(h)
            session.commit()
            raise HTTPException(status_code=status_code, detail={"gitlab_error": body})
        except requests.RequestException as e:
            h.status = "failed"
            session.add(h)
            session.commit()
            raise HTTPException(status_code=502, detail=str(e))

        h.pipeline_id = data.get("id")
        h.status = data.get("status")
        h.ref = src_ref
        h.web_url = data.get("web_url")
        session.add(h)
        session.commit()
        session.refresh(h)

        return {"ok": True, "pipeline": data, "history_id": str(h.id), "config_files": config_files}

    return await run_db(_work)
