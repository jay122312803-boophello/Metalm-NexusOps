import os
import re
import uuid
import shutil
from datetime import datetime

from dotenv import dotenv_values


def _read_text(path: str) -> str:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    except Exception:
        return ""


def _legacy_env_paths(base_dir: str) -> list[str]:
    return [
        os.path.abspath(os.path.join(base_dir, "..", "..", "..", "backend", ".env")),
        os.path.abspath(os.path.join(base_dir, "..", "..", "frontend", ".env")),
    ]


def _infer_deploy_path_from_ci(ci_text: str) -> str | None:
    if not ci_text:
        return None

    m = re.search(r"rsync[^\n]*?:([/][^\s\"']+)", ci_text)
    if m:
        return m.group(1)

    m = re.search(r"\n\s*cd\s+([/][^\s\"']+)", ci_text)
    if m:
        return m.group(1)

    return None


def migrate_legacy_db_if_needed(db_path: str) -> None:
    if os.path.exists(db_path):
        return
    base_dir = os.path.dirname(os.path.abspath(__file__))
    legacy = os.path.abspath(os.path.join(base_dir, "..", "..", "..", "server", "data", "db.json"))
    if os.path.exists(legacy):
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        shutil.copyfile(legacy, db_path)


def ensure_seeded(storage) -> None:
    servers = storage.get_all("servers") or []
    repos = storage.get_all("repos") or []
    deployments = storage.get_all("deployments") or []

    if servers or repos or deployments:
        return

    base_dir = os.path.dirname(os.path.abspath(__file__))
    env = {}
    for p in _legacy_env_paths(base_dir):
        if os.path.exists(p):
            env = dotenv_values(p)
            break

    ci_path = os.path.abspath(os.path.join(base_dir, "..", "..", "..", ".gitlab-ci.yml"))
    ci_text = _read_text(ci_path)

    gitlab_base_url = (env.get("GITLAB_BASE_URL") or "").strip() or "https://gitlab.xuelangyun.com"
    project = (env.get("GITLAB_PROJECT") or "").strip() or "MetaLM/Metalm-NexusOps"
    ref = (env.get("TRIGGER_REF") or "").strip() or "master"

    trigger_token = (env.get("TRIGGER_TOKEN") or "").strip() or None
    private_token = (env.get("PRIVATE_TOKEN") or "").strip() or None

    repo_url = f"{gitlab_base_url.rstrip('/')}/{project}"
    repo_name = project.split("/")[-1] if "/" in project else project

    deploy_path = "/home/metalm/deploy/NexusOps/"
    inferred = _infer_deploy_path_from_ci(ci_text)
    if inferred:
        deploy_path = "/home/metalm/deploy/NexusOps/"

    server = {
        "id": str(uuid.uuid4()),
        "name": "生产环境-01",
        "address": "10.88.36.61",
        "ssh_user": "metalm",
        "deploy_path": deploy_path,
        "description": "User: metalm",
        "created_at": datetime.now().isoformat(),
    }

    repo = {
        "id": str(uuid.uuid4()),
        "name": repo_name or "Metalm-NexusOps",
        "url": repo_url,
        "branch": ref,
        "trigger_token": trigger_token,
        "private_token": private_token,
        "project_id": project,
        "description": None,
        "created_at": datetime.now().isoformat(),
    }

    storage.add("servers", server)
    storage.add("repos", repo)

    deployment = {
        "id": str(uuid.uuid4()),
        "name": "Nexus 智能体部署",
        "server_id": server["id"],
        "repo_id": repo["id"],
        "created_at": datetime.now().isoformat(),
    }
    storage.add("deployments", deployment)
