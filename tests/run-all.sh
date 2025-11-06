#!/usr/bin/env bash
set -euo pipefail
node "$(dirname "$0")/temp-wind-card-harness.js"
node "$(dirname "$0")/dashboard-fixtures-harness.js"
node "$(dirname "$0")/layout-base-dimensions-harness.js"
node "$(dirname "$0")/rain-units-harness.js"
node "$(dirname "$0")/pressure-units-harness.js"
node "$(dirname "$0")/lightning-units-harness.js"
node "$(dirname "$0")/air-quality-rotation-harness.js"
node "$(dirname "$0")/timer-stub-harness.js"
node "$(dirname "$0")/hubitat-tiles-adapter-harness.js"
node "$(dirname "$0")/maker-endpoint-simulation.js"
node "$(dirname "$0")/e2e/playwright-refresh.spec.js"

if command -v groovy >/dev/null 2>&1; then
  groovy "$(dirname "$0")/hubitat/ui/WeatherDashboardAppLandingSpec.groovy"
else
  echo "Skipping Groovy landing page smoke test (groovy command not found)." >&2
fi

echo "Running Jest unit tests..."
npm run test:unit
