#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CACHE_ROOT="${PROJECT_ROOT}/.docker"
NODE_MODULES_DIR="${CACHE_ROOT}/node_modules"
NPM_CACHE_DIR="${CACHE_ROOT}/npm-cache"

mkdir -p "${NODE_MODULES_DIR}" "${NPM_CACHE_DIR}"

if command -v docker >/dev/null 2>&1; then
  if docker compose version >/dev/null 2>&1; then
    DOCKER_COMPOSE=(docker compose)
  else
    DOCKER_COMPOSE=(docker-compose)
  fi
else
  echo "Docker is required to run this build workflow." >&2
  exit 1
fi

"${DOCKER_COMPOSE[@]}" -f "${SCRIPT_DIR}/docker-compose.yml" run --rm dashboard-build "$@"
