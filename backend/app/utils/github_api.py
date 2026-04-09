from __future__ import annotations

import re
from typing import Any

import requests


def parse_owner_repo(url_or_slug: str) -> tuple[str | None, str | None]:
    s = (url_or_slug or "").strip()
    if not s:
        return None, None

    if re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", s):
        owner, repo = s.split("/", 1)
        return owner, repo.removesuffix(".git")

    s2 = s
    if s2.startswith("git@"):
        s2 = s2.replace(":", "/", 1)
        s2 = s2.replace("git@", "ssh://git@", 1)

    if "github.com" not in s2:
        return None, None

    m = re.search(r"github\.com[:/]+([^/]+)/([^/?#]+)", s2)
    if not m:
        return None, None
    owner = m.group(1)
    repo = m.group(2)
    if repo.endswith(".git"):
        repo = repo[: -len(".git")]
    return owner, repo


def _headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "NexusOps",
    }


def dispatch_repo_event(
    owner: str,
    repo: str,
    token: str,
    event_type: str,
    client_payload: dict[str, Any] | None = None,
    base_url: str = "https://api.github.com",
    timeout: int = 15,
) -> None:
    url = f"{base_url.rstrip('/')}/repos/{owner}/{repo}/dispatches"
    body = {"event_type": event_type, "client_payload": client_payload or {}}
    resp = requests.post(url, headers=_headers(token), json=body, timeout=timeout)
    if not resp.ok:
        try:
            err = resp.json()
        except Exception:
            err = (resp.text or "")[:2000]
        raise RuntimeError(f"GitHub dispatch failed: HTTP {resp.status_code}: {err}")


def list_workflow_runs(
    owner: str,
    repo: str,
    token: str,
    base_url: str = "https://api.github.com",
    event: str | None = None,
    per_page: int = 30,
    timeout: int = 15,
) -> list[dict[str, Any]]:
    qs = f"?per_page={int(per_page)}"
    if event:
        qs += f"&event={requests.utils.quote(event, safe='')}"
    url = f"{base_url.rstrip('/')}/repos/{owner}/{repo}/actions/runs{qs}"
    resp = requests.get(url, headers=_headers(token), timeout=timeout)
    if not resp.ok:
        try:
            err = resp.json()
        except Exception:
            err = (resp.text or "")[:2000]
        raise RuntimeError(f"GitHub list runs failed: HTTP {resp.status_code}: {err}")
    data = resp.json() or {}
    runs = data.get("workflow_runs")
    return runs if isinstance(runs, list) else []


def get_workflow_run(
    owner: str,
    repo: str,
    token: str,
    run_id: int,
    base_url: str = "https://api.github.com",
    timeout: int = 15,
) -> dict[str, Any]:
    url = f"{base_url.rstrip('/')}/repos/{owner}/{repo}/actions/runs/{int(run_id)}"
    resp = requests.get(url, headers=_headers(token), timeout=timeout)
    if not resp.ok:
        try:
            err = resp.json()
        except Exception:
            err = (resp.text or "")[:2000]
        raise RuntimeError(f"GitHub get run failed: HTTP {resp.status_code}: {err}")
    data = resp.json()
    return data if isinstance(data, dict) else {}


def cancel_workflow_run(
    owner: str,
    repo: str,
    token: str,
    run_id: int,
    base_url: str = "https://api.github.com",
    timeout: int = 15,
) -> None:
    url = f"{base_url.rstrip('/')}/repos/{owner}/{repo}/actions/runs/{int(run_id)}/cancel"
    resp = requests.post(url, headers=_headers(token), timeout=timeout)
    if not resp.ok:
        try:
            err = resp.json()
        except Exception:
            err = (resp.text or "")[:2000]
        raise RuntimeError(f"GitHub cancel run failed: HTTP {resp.status_code}: {err}")


def download_workflow_logs_zip(
    owner: str,
    repo: str,
    token: str,
    run_id: int,
    base_url: str = "https://api.github.com",
    timeout: int = 30,
) -> bytes:
    url = f"{base_url.rstrip('/')}/repos/{owner}/{repo}/actions/runs/{int(run_id)}/logs"
    resp = requests.get(url, headers=_headers(token), timeout=timeout, allow_redirects=True)
    if not resp.ok:
        try:
            err = resp.json()
        except Exception:
            err = (resp.text or "")[:2000]
        raise RuntimeError(f"GitHub download logs failed: HTTP {resp.status_code}: {err}")
    return resp.content or b""
