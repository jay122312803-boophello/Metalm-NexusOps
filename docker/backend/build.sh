#!/usr/bin/env sh
set -eu

IMAGE="${NEXUSOPS_BACKEND_IMAGE:-nexusops-backend:latest}"
BASE_IMAGE="${NEXUSOPS_BASE_IMAGE:-registry.xuelangyun.com/shuzhi-amd64/alpine:3.20}"
PLATFORM="${NEXUSOPS_PLATFORM:-}"

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"

args=""
if [ -n "$PLATFORM" ]; then
  args="$args --platform $PLATFORM"
fi

cd "$ROOT_DIR"

sh -c "docker build $args -f docker/backend/Dockerfile -t \"$IMAGE\" --build-arg BASE_IMAGE=\"$BASE_IMAGE\" ."
