# Ecowitt Weather Dashboard (Hubitat)

This repository contains the current Hubitat weather dashboard implementation. Data collection, aggregation, and forecasting happen inside Hubitat; the browser code only renders the dashboard and the landing-page preview.

## Project layout

```
README.md
app/
  weather-dashboard-app.html   Preview shell loaded from Hubitat File Manager
  weather-dashboard-app.js     Preview bootstrap and Maker API fetch logic
dashboard/
  weather-dashboard.js         Bundled dashboard renderer for Hubitat tiles
hubitat/
  WeatherDashboardApp.groovy   Hubitat app that builds the JSON payload
  WeatherDashboardDevice.groovy Virtual device driver that exposes payload segments
src/
  ...                          Source modules used to build dashboard/weather-dashboard.js
tests/
  ...                          Node, Groovy, and browser harnesses
```

## Overview

1. `WeatherDashboardApp` collects the selected weather-device attributes, calculates derived values, and publishes a consolidated JSON payload.
2. `WeatherDashboardDevice` stores the payload as deterministic JSON segments so Hubitat dashboards can read it within attribute-size limits.
3. `dashboard/weather-dashboard.js` renders the payload inside a single Hubitat dashboard tile.
4. `app/weather-dashboard-app.html` and `app/weather-dashboard-app.js` provide the Hubitat app landing-page preview and Maker API fetch path.

## Hubitat Setup Summary

1. Install the **Weather Dashboard Device** driver and **Weather Dashboard App** in Hubitat.
2. Create a virtual device using the driver, or let the app create and manage one.
3. Configure the app by selecting your source weather device and mapping any attribute names that differ from the defaults.
4. Upload these files to Hubitat's **File Manager** so they are available under `/local/`:
   - `dashboard/weather-dashboard.js`
   - `app/weather-dashboard-app.js`
   - `app/weather-dashboard-app.html`
5. Add the dashboard device to your Hubitat dashboard with the **Attribute** tile template.
   - Set `dashboardScript` to `tile-0` so the script injector runs.
   - Map the remaining segment attributes (`segmentCore`, `segmentPrecip`, `segmentAmbient1`, `segmentAmbient2`, `segmentAirQuality`, `segmentMeta`, `segmentLayout`, and the optional `...B64` attributes) to the later tiles.
6. Configure Maker API so the landing page preview can fetch data. See [docs/setup-maker-api.md](docs/setup-maker-api.md).

The device driver keeps each segment under Hubitat's attribute-size limit, which avoids runtime chunk reassembly.

## Development Notes

* Presentation logic lives in JavaScript; calculations live in the Hubitat app.
* The generated `dashboard/weather-dashboard.js` bundle is checked in so Hubitat users can upload it without running the build toolchain.
* Re-run `npm run build` whenever you change files under `src/` so the checked-in bundle stays aligned with the source.

## Build and Verification

```bash
npm install
npm run build
npm run verify:hubitat
npm test
npm run clean
```

If you prefer Docker, `./build/run-docker-build.sh` runs the same build and test commands inside a container.

The repository vendors a minimal `esbuild` shim under `vendor/esbuild-stub` so `npm install` works without reaching the public npm registry.

## Runtime Layout Overrides

The app exposes an optional **Layout configuration JSON** textarea that lets you change the dashboard canvas size and grid without editing the JavaScript. The renderer measures the Hubitat dashboard tile that hosts `weather-dashboard.js` to seed the base canvas dimensions, so overrides are only needed when you want to force a different size or grid definition. Provide a JSON object with the following keys:

* `baseWidth` / `baseHeight` - numbers that override the measured Hubitat tile dimensions. When omitted the measured width and height become the base canvas for all breakpoints.
* `trackUnit` - optional string (`"px"` or `"percent"`). When set to `"percent"`, numeric row heights and column widths are interpreted as percentages of the active base dimensions instead of pixels. The renderer automatically reserves space for frame padding and grid gaps, so the supplied percentages are scaled to keep the layout inside the measured Hubitat tile.
* `desktop`, `tablet`, `mobile` - objects that can override `columns`, `gap`, and `rows` for each breakpoint. Rows are arrays of objects with a `height` and a `columns` array that names the cards to place in that row.

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

To size tracks as percentages of the measured base dimensions, set `"trackUnit": "percent"` and continue supplying numeric values. The dashboard adjusts the resulting track pixels so the rows and columns plus their gutters fit the tile even when you change the gap or frame padding.

### Viewing Layout Diagnostics

The renderer snapshots every successful layout pass and keeps the latest values on `window.weatherDashboard`. Open the Hubitat dashboard in a browser, launch the developer tools console, and run:

```javascript
weatherDashboard.logLayoutDiagnostics();
```

The helper prints the host element, its measured size, the resolved base dimensions, the source of each base value, and any percent-to-pixel conversions that were applied to rows or columns. The function returns the raw diagnostics object, so you can also inspect it programmatically:

```javascript
const info = weatherDashboard.captureLayoutDiagnostics();
console.log(info.base, info.percentTracks);
```

Set `window.__WDASH_DEBUG_LAYOUT__ = true` before the dashboard script runs to have the diagnostics logged automatically after each layout application.

### Controlling Individual Card Heights

Rows define the vertical tracks of the grid. Every card listed in the same row shares that track's height, expressed in pixels or percentages depending on `trackUnit`. To make one card taller than another in the same column, split the column into multiple rows and repeat the card name in each row you want it to span. Cards only occupy the rows where their name appears, so you can leave a gap for the other column by using `"."` as a placeholder.

For example, the snippet below keeps **Temp & Wind** at 420px tall while the **Ambient** card only occupies the first 220px of the right column. The `"."` placeholder leaves the lower portion of the right column empty so the next card can start higher up.

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

The top offset for any card is the sum of the row heights that precede the first row containing that card. Spanning multiple rows increases the card's height by the additional row heights.
