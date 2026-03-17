#!/usr/bin/env bash
set -euo pipefail

tag_prefix="${1:-dev}"
push_image="${2:-}"

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"

platform="${NEXUSOPS_PLATFORM:-linux/amd64}"
base_image="${NEXUSOPS_BASE_IMAGE:-registry.xuelangyun.com/shuzhi-amd64/alpine:3.20}"
registry_base="${NEXUSOPS_REGISTRY_BASE:-registry.xuelangyun.com/shuzhi-amd64/metalm}"

cd "$ROOT_DIR"

pyproject_version="$(sed -n 's/^[[:space:]]*version[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' backend/pyproject.toml | head -n 1)"
time_now="$(date "+%Y%m%d")"
git_commit_id="$(git rev-parse --short HEAD 2>/dev/null || echo nogit)"
tag_suffix="${tag_prefix}_${time_now}_${git_commit_id}_${pyproject_version:-0.0.0}"
tag="${tag_suffix}"
if [ "${tag_prefix}" = "dev" ]; then
  tag="latest"
fi

image="${NEXUSOPS_BACKEND_IMAGE:-${registry_base}/nexusops-backend:${tag}}"

echo "$image"

docker build --platform "$platform" -f docker/backend/Dockerfile -t "$image" --build-arg BASE_IMAGE="$base_image" .

if [ "${push_image}" = "push" ] || [ "${NEXUSOPS_PUSH:-0}" = "1" ]; then
  docker push "$image"
fi
