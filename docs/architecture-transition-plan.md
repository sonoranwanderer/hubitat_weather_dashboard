# Architecture Transition Plan

This roadmap guides the evolution from the current Hubitat Dashboard tile delivery to a dual-surface architecture that also supports an app-hosted experience. Each phase concludes with explicit functional or QA validation so progress can be verified before the next stage begins.

## Phase 0 — Snapshot current implementation into `/v2`

:::task-stub{title="Archive current dashboard implementation into v2 folder"}
1. Create `/v2/dashboard`, `/v2/assets`, and `/v2/hubitat` directories that mirror the existing project structure.
2. Copy `dashboard/weather-dashboard.js`, related JavaScript/CSS assets, and the Hubitat app and driver Groovy files into the matching `/v2` locations.
3. Run a checksum or recursive diff between the live directories and their `/v2` counterparts to confirm the snapshot is exact, recording the verification in project notes or the commit message.
:::

## Phase 1 — Baseline auditing & testing foundation

:::task-stub{title="Establish reproducible baselines for dashboard data and rendering"}
1. Export representative `state.lastPayloadJson` samples from `hubitat/apps/WeatherDashboardApp.groovy` and store them under `tests/fixtures/`.
2. Extend the JavaScript unit harness (e.g., `tests/dashboard.test.js`) to replay those fixtures against the legacy `dashboard/weather-dashboard.js` implementation.
3. Document manual Hubitat tile verification steps in `docs/testing.md` for reference when comparing future builds against the archived baseline.
:::

## Phase 2 — Isolate presentation logic from Hubitat tile plumbing

Phase 2 introduces a new `src/` workspace specifically for the refactored weather dashboard JavaScript. Limit that directory to renderer code, adapters, and shared helpers that belong to the dashboard bundle. Continue to keep Groovy apps/drivers in `hubitat/`, legacy deployment assets in `dashboard/`, and any unrelated tooling in their existing top-level directories until a later phase explicitly directs otherwise.

> **Important:** Only move weather-dashboard JavaScript modules into `src/`. Do **not** migrate Groovy sources, historical assets, or other utilities until a subsequent phase widens the scope. Holding this boundary prevents churn in the archived `/v2` snapshot and leaves the legacy bundles untouched for current deployments.

:::task-stub{title="Refactor weather dashboard into adapter + shared renderer"}
1. Split `dashboard/weather-dashboard.js` into `src/render/` (layout/formatting) and `src/adapters/hubitat-tiles.js` (tile scraping) modules in the repository root.
2. Introduce a lightweight bundler (Rollup or esbuild) configured in `package.json` to produce the Hubitat tile bundle alongside future targets from the shared sources.
3. Update unit tests to exercise the shared renderer directly and add JSDOM-based tests for the Hubitat adapter to validate DOM interactions.
:::

## Phase 3 — Expose a consolidated JSON endpoint for Maker API pulls

:::task-stub{title="Publish consolidated weather payload via WeatherDashboardApp"}
1. Add a `mappings` GET endpoint in `hubitat/apps/WeatherDashboardApp.groovy` that returns the full dashboard JSON with Maker API token validation.
2. Ensure payload snapshots are persisted in `state` and refreshed on schedule so the endpoint stays within Hubitat size limits.
3. Extend Groovy or HTTP simulation tests to cover authentication failures and successful payload retrieval.
:::

## Phase 4 — Build standalone Maker API–driven web bundle

:::task-stub{title="Implement Maker API-driven standalone dashboard bundle"}
1. Add `app/weather-dashboard-app.js` that bootstraps the shared renderer, fetches JSON from the new endpoint, and handles polling/backoff.
2. Support configuration (query string or inline JSON) for hub IP, Maker token, and device IDs, including validation feedback for invalid inputs.
3. Create browser-based tests (Playwright or Cypress under `tests/e2e/`) that mock the endpoint and validate refresh behavior over time.
:::

## Phase 5 — Integrate the standalone bundle into WeatherDashboardApp

:::task-stub{title="Embed standalone dashboard inside WeatherDashboardApp UI"}
1. Modify `hubitat/apps/WeatherDashboardApp.groovy` to render a landing `dynamicPage` with an `<iframe>` or `render()` block loading `/local/weather-dashboard-app.html`, plus navigation buttons to setup and diagnostics pages.
2. Store Maker API credentials in app preferences and inject them into the embedded bundle (e.g., via query parameters or inline script variables).
3. Add manual regression steps and, if feasible, Groovy UI tests to confirm navigation and embedded rendering within the Hubitat admin UI.
:::

## Phase 6 — Deployment & regression hardening

:::task-stub{title="Automate builds, linting, and cross-environment verification"}
1. Expand `package.json` scripts and CI workflows (e.g., `.github/workflows/ci.yml`) to run linting, unit tests, and bundle builds.
2. Document in `docs/deployment.md` how to upload refreshed assets, configure Maker API access, and roll back to the legacy dashboard if needed.
3. Run the full test suite against staged hubs (where available) and record results to support release readiness.
:::
