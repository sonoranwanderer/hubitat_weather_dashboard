# Ecowitt Weather Dashboard v2 Workspace

This directory contains the actively developed "v2" Hubitat dashboard experience.  It mirrors the structure of the legacy files
from the repository root so you can iterate on the next-generation dashboard, Hubitat app, and virtual device driver without
disturbing the production bundle that still lives under `/dashboard`, `/assets`, and `/hubitat`.

## Project layout

```
v2/README.md                     Project overview for the v2 workspace (this file)
v2/dashboard/weather-dashboard.js  Hubitat dashboard presentation logic
v2/assets/weather-dashboard-icon.svg  Tile icon used by the Hubitat driver/app
v2/hubitat/WeatherDashboardApp.groovy Hubitat app that aggregates weather data
v2/hubitat/WeatherDashboardDevice.groovy Virtual device driver exposing dashboard payloads
v2/docs/*.md                      Supporting documentation for layout diagnostics and chunking
```

The legacy implementation remains in the top-level directories so existing Hubitat installations continue to use the original
bundle.  All future development should happen under `v2/`.

## Overview

1. **WeatherDashboardApp (v2/hubitat/WeatherDashboardApp.groovy)** subscribes to a user-selected weather device, calculates
derived statistics (10 minute wind average, pressure tendency, 24-hour outlook, etc.), and publishes a consolidated JSON
payload.
2. **WeatherDashboardDevice (v2/hubitat/WeatherDashboardDevice.groovy)** is a lightweight virtual sensor that exposes the JSON
payload (and a prettified variant) as device attributes, making the data available to Hubitat dashboards.
3. **weather-dashboard.js (v2/dashboard/weather-dashboard.js)** renders the JSON payload inside a single dashboard tile (the
JavaScript injector tile), recreating the information-dense layout of the Ecowitt console.
4. **weather-dashboard-icon.svg (v2/assets/weather-dashboard-icon.svg)** provides the tile icon referenced by the Hubitat driver
and app metadata.
5. Additional analysis and layout documentation lives in `v2/docs/`.

## Hubitat setup summary

1. Install the **Weather Dashboard Device** driver (`v2/hubitat/WeatherDashboardDevice.groovy`) and **Weather Dashboard App**
   (`v2/hubitat/WeatherDashboardApp.groovy`) in Hubitat.
2. Create a virtual device using the driver, or allow the app to create/manage it automatically.
3. Configure the app by selecting your source weather device and mapping the attribute names that correspond to each data point.
4. Upload `v2/dashboard/weather-dashboard.js` to Hubitat's **File Manager** so it is available at
   `/local/weather-dashboard.js`. Files stored in File Manager are served under the `/local/` path used by dashboards and
   drivers.
5. Add the dashboard device to your Hubitat dashboard using the **Attribute** tile template.
   * Assign the device’s `dashboardScript` attribute to `tile-0`. The tile injects a `<script>` tag that loads
     `v2/dashboard/weather-dashboard.js` from the URL defined in the driver preferences (defaults to `/local/weather-dashboard.js`,
     but you can point it anywhere the script is hosted).
   * Assign the remaining JSON segment attributes (`segmentCore`, `segmentPrecip`, `segmentAmbient1`, `segmentAmbient2`,
     `segmentAirQuality`, `segmentMeta`, `segmentLayout`, etc.) to sequential tiles starting with `tile-1`. The JavaScript
     automatically discovers valid JSON from each tile, so you can add as many segments as your layout requires. The matching
     `...B64` attributes are optional and intended for external consumers that prefer base64-encoded payloads.

The app publishes a consolidated JSON document to the dashboard device. The driver converts that document into deterministic
segments (core conditions, precipitation/solar/lightning, ambient sensors in groups of four, air quality, metadata, and layout)
and stores each segment in its own attribute. Keeping each segment under 700 bytes avoids Hubitat’s 1 KB attribute ceiling and
eliminates the need for runtime chunk reassembly.

## Development notes

* The JavaScript focuses purely on presentation—calculations live in the Hubitat app.
* The JSON payload is designed to be compact but descriptive, minimizing the number of attributes required on the virtual device.
* The driver exposes a `dashboardScript` attribute that emits an auto-injecting `<script>` tag. Hubitat dashboards load
  `v2/dashboard/weather-dashboard.js` directly from the provided URL, so no third-party injector is required. Adjust the URL in
  the device preferences if you host a custom build of the script.
* Derived metrics (wind averages, pressure tendency, outlook) are recalculated every minute or whenever the underlying weather
  attributes change.
* Lightweight Node harnesses in `tests/` exercise the Temp & Wind card renderer and layout measurements without Hubitat. Run
  `npm test` (or invoke `node tests/temp-wind-card-harness.js` and `node tests/layout-base-dimensions-harness.js` individually)
  to verify the in-place update logic and guard against regressions in the gauge/compass behaviour and base dimension
  calculations.

## Runtime layout overrides

The app exposes an optional **Layout configuration JSON** textarea that lets you change the dashboard canvas size and grid
without editing the JavaScript. The renderer measures the Hubitat dashboard tile that hosts `weather-dashboard.js` to seed the
base canvas dimensions, so overrides are only needed when you want to force a different size or grid definition. Provide a JSON
object with the following keys:

* `baseWidth` / `baseHeight` – numbers that override the measured Hubitat tile dimensions. When omitted the measured width and
  height become the base canvas for all breakpoints.
* `trackUnit` – optional string (`"px"` or `"percent"`). When set to `"percent"`, numeric row heights and column widths are
  interpreted as percentages of the active base dimensions instead of pixels. The renderer automatically reserves space for frame
  padding and grid gaps, so the supplied percentages are scaled to keep the layout inside the measured Hubitat tile.
* `desktop`, `tablet`, `mobile` – objects that can override `columns`, `gap`, and `rows` for each breakpoint. Rows are arrays of
  objects with a `height` (pixels) and a `columns` array that names the cards to place in that row.

Example:

```json
{
  "baseWidth": 1200,
  "baseHeight": 900,
  "desktop": {
    "columns": "repeat(2, minmax(0, 1fr))",
    "gap": "18px",
    "rows": [
      { "height": 450, "columns": ["temp-wind", "ambient"] },
      { "height": 180, "columns": ["air", "rain"] }
    ]
  }
}
```

To size tracks as percentages of the measured base dimensions, set `"trackUnit": "percent"` and continue supplying numeric
values. The dashboard adjusts the resulting track pixels so the rows and columns plus their gutters exactly fit the tile, even
when you change the gap or frame padding. For example, the snippet below splits the desktop grid into a 60/40 column ratio with
two rows that fill 40% and 60% of the canvas height:

```json
{
  "trackUnit": "percent",
  "desktop": {
    "columns": [60, 40],
    "rows": [
      { "height": 40, "columns": ["temp-wind", "ambient"] },
      { "height": 60, "columns": ["air", "rain"] }
    ]
  }
}
```

Values you omit fall back to the defaults compiled into `weather-dashboard.js`, so you only need to supply the parts you want to
adjust.

### Viewing layout diagnostics

The renderer snapshots every successful layout pass and keeps the latest values on `window.weatherDashboard`. Open the Hubitat
dashboard in a browser, launch the developer tools console, and run:

```javascript
weatherDashboard.logLayoutDiagnostics();
```

The helper prints the host element, its measured size, the resolved base dimensions, the source of each base value, and any
percent-to-pixel conversions that were applied to rows or columns. The function returns the raw diagnostics object, so you can
also inspect it programmatically:

```javascript
const info = weatherDashboard.captureLayoutDiagnostics();
console.log(info.base, info.percentTracks);
```

Set `window.__WDASH_DEBUG_LAYOUT__ = true` before the dashboard script runs (for example via the browser console and a refresh)
to have the diagnostics logged automatically after each layout application.

### Controlling individual card heights and vertical placement

Rows define the vertical tracks of the grid. Every card listed in the same row shares that track’s height, expressed in pixels or
percentages depending on `trackUnit`. To make one card taller than another in the same column, split the column into multiple
rows and repeat the card name in each row you want it to span. Cards only occupy the rows where their name appears, so you can
leave a gap for the other column by using `"."` as a placeholder.

For example, the snippet below keeps **Temp & Wind** at 420px tall while the **Ambient** card only occupies the first 220px of
the right column. The `"."` placeholder leaves the lower portion of the right column empty so the next card can start higher up.

```json
{
  "desktop": {
    "rows": [
      { "height": 220, "columns": ["temp-wind", "ambient"] },
      { "height": 200, "columns": ["temp-wind", "."] },
      { "height": 160, "columns": ["air", "rain"] },
      { "height": 200, "columns": ["solar", "rain"] },
      { "height": 160, "columns": ["solar", "pressure"] }
    ]
  }
}
```

The top offset for any card is the sum of the row heights that precede the first row containing that card. Spanning multiple rows
increases the card’s height by the additional row heights. This lets you dial in each card’s footprint without editing the
JavaScript.

