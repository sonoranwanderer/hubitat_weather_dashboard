#!/usr/bin/env bash
set -euo pipefail

ensure_local_test_deps() {
  if [ ! -x "$(dirname "$0")/../node_modules/jest/bin/jest.js" ]; then
    echo "Installing local Jest stub..."
    # npm will vendor the local stub packages without hitting the network
    npm install --no-audit --no-fund >/dev/null
  fi
}

ensure_local_test_deps

echo "Running Jest unit tests..."
node "$(dirname "$0")/../node_modules/jest/bin/jest.js" --config "$(dirname "$0")/../jest.config.js" "$@"

