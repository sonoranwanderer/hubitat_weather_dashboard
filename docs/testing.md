# Testing Guide

## Automated checks

Run the lightweight Node harnesses to ensure the archived `/v2` dashboard script can consume recorded payloads and renders core cards without throwing:

```bash
npm test
```

The suite now replays every JSON payload stored in `tests/fixtures/` to confirm rendering stays in sync with Hubitat output.

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
