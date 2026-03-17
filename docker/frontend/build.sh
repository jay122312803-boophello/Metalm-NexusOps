#!/usr/bin/env bash
set -euo pipefail

tag_prefix="${1:-dev}"
push_image="${2:-}"

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"

platform="${NEXUSOPS_PLATFORM:-linux/amd64}"
base_image="${NEXUSOPS_BASE_IMAGE:-registry.xuelangyun.com/shuzhi-amd64/alpine:3.20}"
registry_base="${NEXUSOPS_REGISTRY_BASE:-registry.xuelangyun.com/shuzhi-amd64/metalm}"

cd "$ROOT_DIR"

pkg_version="$(grep -E '"version"[[:space:]]*:' frontend/package.json | head -n 1 | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
time_now="$(date "+%Y%m%d")"
git_commit_id="$(git rev-parse --short HEAD 2>/dev/null || echo nogit)"
tag_suffix="${tag_prefix}_${time_now}_${git_commit_id}_${pkg_version}"
tag="${tag_suffix}"
if [ "${tag_prefix}" = "dev" ]; then
  tag="latest"
fi

image="${NEXUSOPS_FRONTEND_IMAGE:-${registry_base}/nexusops-frontend:${tag}}"

echo "$image"

docker build --platform "$platform" -f docker/frontend/Dockerfile -t "$image" --build-arg BASE_IMAGE="$base_image" .

if [ "${push_image}" = "push" ] || [ "${NEXUSOPS_PUSH:-0}" = "1" ]; then
  docker push "$image"
fi
