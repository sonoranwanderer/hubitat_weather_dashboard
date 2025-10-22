#!/usr/bin/env bash
set -euo pipefail
node "$(dirname "$0")/temp-wind-card-harness.js"
node "$(dirname "$0")/layout-base-dimensions-harness.js"
