# Testing Guide

## Automated checks

Run the lightweight Node harnesses to confirm the legacy `/dashboard/weather-dashboard.js` script can consume each recorded payload and render the core cards without errors:

```bash
npm test
```

The suite replays every JSON payload stored in `tests/fixtures/` to confirm rendering stays in sync with Hubitat output.

To exercise the archived `/v2` snapshot instead, set the `WDASH_VARIANT` environment variable when invoking the harness:

```bash
WDASH_VARIANT=v2 npm test
```

## Manual Hubitat tile comparison

1. **Capture the latest payload**
   - In Hubitat, open **Apps → Weather Dashboard App → Diagnostics → Latest Payload**.
   - Copy the JSON shown under *Latest Payload*; this is the `state.lastPayloadJson` value that feeds the dashboard.
2. **Prepare comparison tiles**
   - Navigate to your Hubitat Dashboard and open it for editing.
   - Add (or duplicate) two tiles that both point at the *Weather Dashboard* virtual device.
   - Set each tile to use the `attribute` template and select `tile-0` so that the script injection runs.
3. **Pin the script version for each tile**
   - For the first tile, keep the existing script reference to `/dashboard/weather-dashboard.js` (the legacy build).
   - For the second tile, edit the injected HTML so the `<script>` tag instead references `/v2/dashboard/weather-dashboard.js` from the same repository.
   - Ensure the supporting data tiles (`tile-1`, and `tile-2`/`tile-3` if present) remain untouched so both tiles consume identical payload data.
4. **Refresh the device data**
   - On the *Weather Dashboard* device page, run **Refresh** (or trigger a manual app refresh) so the copied payload is written to the dashboard attributes.
   - Confirm that the JSON shown in the diagnostics page matches what you exported earlier.
5. **Inspect the rendered output**
   - Exit dashboard edit mode and view both tiles side-by-side.
   - Verify readings (temperature, wind, pressure, rain, air quality, ambient rotation, lightning, etc.) match the captured payload across the legacy and `/v2` tiles.
   - Check the browser console for errors on either tile and confirm unit selectors react the same way when toggled.
6. **Record observations**
   - Note any visual or behavioral differences before and after switching script URLs.
   - If regressions appear, save the payload JSON alongside screenshots so it can be replayed with the automated fixture harness for debugging.

Following these steps keeps manual dashboard comparisons aligned with the archived `/v2` JavaScript and the recorded `state.lastPayloadJson` fixtures.

## Weather Dashboard App landing page regression

1. **Open the app landing page**
   - Navigate to **Apps → Weather Dashboard App** inside Hubitat.
   - Confirm the landing page renders a full-width preview frame instead of jumping directly into configuration options.
2. **Verify the embedded dashboard preview**
   - If the iframe reports missing credentials, open **Configure data sources** and populate the Hub base URL (e.g., `http://192.168.1.50`), Maker API application ID, and Maker API token.
   - Return to the landing page and confirm the `/local/weather-dashboard-app.html` bundle loads in the preview frame without browser console errors. The inline status panel should report the Maker API request targeting `/apps/api/<ApplicationID>/devices/all` with your token.
   - If the frame renders Hubitat's shell with a 404 message, upload `app/weather-dashboard-app.html`, `app/weather-dashboard-app.js`, and `dashboard/weather-dashboard.js` to File Manager so they are accessible from `/local/`.
3. **Exercise navigation controls**
   - Use the **Configure data sources** button to reach the configuration form and ensure existing settings persist.
   - Navigate back to the landing page using the browser back button and confirm the preview reloads.
   - Open the **Diagnostics** link to confirm it still displays the latest payload JSON.
4. **Smoke test Maker API injection**
   - From the landing page, open the iframe in a new tab (right-click → *Open link in new tab*) and verify the query string includes the Maker API token (`makerToken`), the hub base URL, the Maker API application ID (`appId`), and any device IDs saved in preferences.

These steps confirm the navigation loop and embedded preview stay functional after UI changes.

## Groovy landing page smoke test

Run the lightweight Groovy harness to validate the helper methods that power the landing page preview and credential injection logic:

```bash
groovy tests/hubitat/ui/WeatherDashboardAppLandingSpec.groovy
```

The script stubs Hubitat-specific DSL calls, so it can execute on a developer workstation while still exercising the Maker API query builder and HTML encoding helpers.
