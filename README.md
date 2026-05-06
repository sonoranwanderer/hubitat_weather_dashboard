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
docs/
  screenshots/                 README screenshot assets
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

![Weather Dashboard main tile](docs/screenshots/dashboard-main.png)

## Hubitat Setup Summary

The dashboard has two setup parts:

* **File installation** - install the Groovy app/driver and upload the JavaScript/HTML assets Hubitat serves from `/local/`.
* **Functional setup** - connect the app to your weather devices, create or select the dashboard virtual device, place the required Attribute tiles, and optionally configure Maker API for the app-page preview.

### Dependencies

* **Weather Device(s)** - required
  * The dashboard can use any weather data sources that expose weather data in Hubitat via devices. It expects Ecowitt-style attribute names such as `temperature`, `humidity`, `windSpeed`, `windGust`, `windDirection`, `pressure`, `rainRate`, and `rainDaily`. However attribute names can be remapped in the app if your weather devices use different attribute names.
* **Maker API** (Hubitat Built-in App) - optional
  * Hubitat's built-in [**Maker API**](https://docs2.hubitat.com/en/apps/maker-api) app if you want the embedded app dashboard preview or external clients to fetch dashboard data. 
  * The Hubitat dashboard tile itself does not require Maker API.

### 1. Install The Hubitat Code

Install both Groovy files in Hubitat:

1. Open [**Drivers Code**](https://docs2.hubitat.com/en/how-to/install-custom-drivers) and add the contents of `hubitat/WeatherDashboardDevice.groovy`.
2. Open [**Apps Code**](https://docs2.hubitat.com/en/how-to/install-custom-apps) and add the contents of `hubitat/WeatherDashboardApp.groovy`.
3. Save both files.

The driver is the virtual device that exposes dashboard attributes. The app reads your weather devices, calculates derived values and a basic forecast, and pushes segmented JSON into the weather dashboard virtual device.

### 2. Upload The Local Assets

Upload these files to Hubitat [**File Manager**](https://docs2.hubitat.com/en/user-interface/settings/file-manager) at the File Manager root:

* `dashboard/weather-dashboard.js`
* `app/weather-dashboard-app.js`
* `app/weather-dashboard-app.html`

They should be reachable from the hub as:

* `/local/weather-dashboard.js`
* `/local/weather-dashboard-app.js`
* `/local/weather-dashboard-app.html`

Keep those names and locations unless you also change the dashboard device's **Dashboard script URL** preference. The default script URL is `/local/weather-dashboard.js`.

### 3. Create And Configure The Weather Dashboard App

1. Open **Apps**, choose **Add User App**, and install **Weather Dashboard App**.
2. Open **Configure data sources**.
3. Select the weather source device or devices under **Weather devices**.
4. Review the attribute mapping sections. Keep the defaults when your weather driver uses the listed attribute names; otherwise choose the correct device and enter the attribute name used by your Hubitat device.
5. Set input and display units for temperature, rainfall, wind, pressure, and lightning distance. These must match the units reported by the source devices so the dashboard converts values correctly.
6. Configure optional sources only when you have them: outdoor/indoor air quality, lightning, sensor batteries, and ambient temperature/humidity sensors.
7. Choose refresh behavior. Leave the default event-driven refresh plus one-minute cron enabled unless you know your source device is too noisy.
8. Set the **Dashboard device label**, then click **Save & Refresh**.

After saving, the app creates or updates the Weather Dashboard virtual device. Open that device in **Devices** and confirm it has attributes such as `dashboardScript`, `segmentCore`, `segmentPrecip`, `segmentAirQuality`, `segmentMeta`, `segmentLayout`, and `segmentAmbient1` through `segmentAmbient6`. Empty optional segments may show `{}`; that is normal.

### 4. Add The Hubitat Dashboard Tiles

The rendered dashboard uses one visible Attribute tile plus several hidden/source Attribute tiles from the same Weather Dashboard virtual device.

1. Open the target Hubitat dashboard.
2. Add an **Attribute** tile for the Weather Dashboard virtual device and choose the `dashboardScript` attribute. Add this tile first so Hubitat gives it the `tile-0` DOM id. This is the tile where `weather-dashboard.js` renders the full dashboard.
3. Add additional **Attribute** tiles for these same-device attributes:
   - `segmentCore`
   - `segmentPrecip`
   - `segmentAirQuality`
   - `segmentMeta`
   - `segmentLayout`
   - `segmentAmbient1`
   - `segmentAmbient2`
   - `segmentAmbient3`
   - `segmentAmbient4`
   - `segmentAmbient5`
   - `segmentAmbient6`
4. Save the dashboard and refresh the browser page.

The JavaScript reads JSON from the segment tiles and hides those source tiles after rendering. The segment tile order is not important, but the `dashboardScript` tile must be the display tile at `tile-0`.

### 5. Configure Maker API For The App Preview

Maker API is only needed for the embedded preview on the Weather Dashboard app landing page and for external clients that fetch the payload through Maker API.

1. Open **Apps** and add Hubitat's built-in **Maker API** app if it is not already installed.
2. In Maker API, enable **Local IP Address** under **Allow access via**. Enable **Cloud** only if you need remote access.
3. Under **Select devices**, choose the Weather Dashboard virtual device.
4. Save Maker API and copy the hub base URL, Maker API application ID, and access token.
5. Return to **Apps -> Weather Dashboard App -> Configure data sources -> Maker API access**.
6. Paste the hub base URL, application ID, and token into the matching fields. Optionally add comma-separated Maker API device IDs.
7. Click **Save & Refresh**.

For the detailed Maker API walkthrough and troubleshooting, see [docs/setup-maker-api.md](docs/setup-maker-api.md).

### Validation Checklist

Use this checklist when the dashboard does not render:

* **Files:** `http://<hub-ip>/local/weather-dashboard.js` and `/local/weather-dashboard-app.html` should not return Hubitat's 404 page.
* **Device:** The Weather Dashboard virtual device should have a populated `dashboardScript` attribute and JSON in at least `segmentCore`.
* **App configuration:** The selected weather devices should show live values for the mapped attributes in Hubitat before the dashboard app reads them.
* **Dashboard tiles:** The first Attribute tile should be `dashboardScript`; the remaining segment attributes should be present as Attribute tiles from the same virtual device.
* **Maker API preview:** Maker API must authorize the Weather Dashboard virtual device, and the app's saved base URL, application ID, and token must match the current Maker API app.

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
