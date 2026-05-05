# Testing Guide

## Automated Checks

Run the full project test script:

```bash
npm test
```

`tests/run-all.sh` executes the Node harnesses, the browser-style preview checks, the Maker API simulation, the Playwright stub, the Groovy landing-page smoke test when `groovy` is available, and the Jest unit suite.

For targeted runs:

```bash
node tests/temp-wind-card-harness.js
node tests/layout-base-dimensions-harness.js
groovy tests/hubitat/ui/WeatherDashboardAppLandingSpec.groovy
```

Rebuild and verify the checked-in bundle before committing:

```bash
npm run build
npm run verify:hubitat
```

## Manual Dashboard Comparison

1. Capture the latest payload from **Apps → Weather Dashboard App → Diagnostics → View Latest Payload**.
2. Refresh the Weather Dashboard device so the latest payload is written to the dashboard attributes.
3. Open the dashboard tile that loads `dashboard/weather-dashboard.js`.
4. Compare the rendered readings against the captured payload and check the browser console for errors.
5. If you change layout settings, verify the Temp & Wind card, ambient rotation, and card placement still match the measured payload.

If a regression appears, save the payload JSON and any screenshots so the fixture harness can replay the exact state.

## Landing Page Smoke Test

1. Open **Apps → Weather Dashboard App**.
2. Confirm the landing page renders the embedded preview frame.
3. If the frame reports missing credentials, fill in the Maker API hub base URL, application ID, and token on the configuration page.
4. Confirm the preview loads `/local/weather-dashboard-app.html` without console errors.
5. Verify the preview URL includes the Maker API values saved in the app settings when the preview is opened directly.
