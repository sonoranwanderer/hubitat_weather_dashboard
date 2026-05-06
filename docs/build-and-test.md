# Build And Test Guide

This guide covers the local toolchain used to build and verify the Hubitat Weather Dashboard repository.

## Required Tools

- **Node.js and npm** - required for JavaScript builds, fixture harnesses, browser-style tests, and Jest unit tests.
- **bash** - required for `tests/run-all.sh`, `build/clean.sh`, and the Docker build wrapper.
- **Groovy** - required for the Hubitat app smoke tests and backup/forecast recovery continuity tests.
- **Docker** - optional; only needed when using `./build/run-docker-build.sh`.

The repository vendors local npm stub packages for `esbuild`, `jsdom`, `jest`, and `jest-environment-jsdom` under `vendor/`. A normal `npm install` should use those local packages instead of downloading the main test/build tools from the public npm registry.

## Install Dependencies

From the repository root:

```bash
npm install
```

`npm test` also checks for the local Jest stub and runs `npm install --no-audit --no-fund` if `node_modules/jest/bin/jest.js` is missing.

## Build

The checked-in dashboard bundle is `dashboard/weather-dashboard.js`. Rebuild it whenever files under `src/` change:

```bash
npm run build
```

`npm run build` runs the Hubitat bundle build and then verifies that `dashboard/weather-dashboard.js` matches the generated output.

Useful build commands:

```bash
npm run build:hubitat
npm run build:watch
npm run build:release
npm run verify:hubitat
npm run clean
```

- `build:hubitat` writes the development Hubitat dashboard bundle.
- `build:watch` rebuilds when source files change.
- `build:release` creates a minified bundle.
- `verify:hubitat` checks that the checked-in bundle matches the current source.
- `clean` removes generated build artifacts.

## Automated Tests

Run the full project test script:

```bash
npm test
```

`npm test` runs `tests/run-all.sh`, which executes:

- Node rendering and layout harnesses.
- Dashboard fixture DOM comparison.
- Unit conversion harnesses for rain, pressure, lightning, and air quality.
- Timer and async error harnesses.
- Hubitat tile adapter harness.
- Maker API endpoint simulation.
- Browser-style preview checks through the local Playwright stub.
- Groovy Hubitat app smoke tests when `groovy` is installed.
- Jest unit tests through the local Jest stub.

## Coverage

Run the local coverage baseline:

```bash
npm run coverage
```

The coverage command runs the same full test script with Node V8 coverage enabled,
then writes `coverage/coverage-summary.json`. JavaScript coverage is measured for
`src/` and `app/` source files. Groovy coverage is reported separately as a
method-reference approximation because the local Hubitat smoke tests do not
instrument Hubitat runtime execution.

If `groovy` is not installed, `npm test` skips the Groovy tests and prints a warning. For changes touching `hubitat/WeatherDashboardApp.groovy`, backup/recovery, configuration import/export, forecasting state, or landing-page preview behavior, install Groovy and rerun `npm test` so those checks execute.

## Targeted Test Runs

Useful targeted commands while developing:

```bash
node tests/dashboard-fixtures-harness.js
node tests/temp-wind-card-harness.js
node tests/layout-base-dimensions-harness.js
node tests/maker-endpoint-simulation.js
node tests/e2e/playwright-refresh.spec.js
groovy tests/hubitat/ui/WeatherDashboardAppLandingSpec.groovy
groovy tests/hubitat/ui/WeatherDashboardBackupForecastSpec.groovy
npm run test:unit
```

To intentionally refresh expected dashboard DOM fixtures after validating the rendered output:

```bash
WDASH_UPDATE_EXPECTED=1 node tests/dashboard-fixtures-harness.js
```

Only update expected fixtures when the rendering change is intentional and has been reviewed.

## Docker Build

If you prefer an isolated build environment, run:

```bash
./build/run-docker-build.sh
```

The Docker wrapper runs the same build and test commands inside a container. Docker is not required for normal local development.

## Manual Dashboard Comparison

Use this checklist for changes that affect payload generation, dashboard layout, or Hubitat browser rendering:

1. Capture the latest payload from **Apps -> Weather Dashboard App -> Diagnostics -> View Latest Payload**.
2. Refresh the Weather Dashboard device so the latest payload is written to the dashboard attributes.
3. Open the dashboard tile that loads `dashboard/weather-dashboard.js`.
4. Compare the rendered readings against the captured payload and check the browser console for errors.
5. If layout settings changed, verify the Temp & Wind card, ambient rotation, and card placement still match the measured payload.

If a regression appears, save the payload JSON and screenshots so the fixture harness can replay the exact state.

## Landing Page Smoke Test

Use this checklist for changes to Maker API preview behavior or app landing-page rendering:

1. Open **Apps -> Weather Dashboard App**.
2. Confirm the landing page renders the embedded preview frame.
3. If the frame reports missing credentials, fill in the Maker API hub base URL, application ID, and token on the configuration page, or intentionally skip the token when validating tokenless operation.
4. Confirm the preview loads `/local/weather-dashboard-app.html` without console errors.
5. Verify the preview URL includes the expected Maker API values saved in the app settings when the preview is opened directly.
