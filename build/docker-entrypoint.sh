#!/usr/bin/env bash
set -euo pipefail

# Ensure dependencies are installed inside the container before running the build
npm install

if [[ $# -gt 0 ]]; then
  exec "$@"
else
  exec npm run build
fi
