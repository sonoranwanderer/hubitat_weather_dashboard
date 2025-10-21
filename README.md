# Ecowitt Weather Dashboard (Hubitat)

This repository contains a re-imagined weather dashboard solution for Hubitat Elevation.  The project focuses on providing a single, information-dense dashboard tile driven by JavaScript presentation while all data collection, aggregation, and forecasting is handled inside Hubitat via an app and companion device driver.

## Project layout

```
README.md                 Project overview (this file)
hubitat/
  WeatherDashboardApp.groovy      Hubitat app that aggregates weather data
  WeatherDashboardDevice.groovy   Virtual device driver exposing dashboard payloads
dashboard/
  weather-dashboard.js            Dashboard presentation logic for the JavaScript injector tile
v1/
  ...                              Original experimental implementation retained for reference
```

## Overview

1. **WeatherDashboardApp** subscribes to a user-selected weather device, calculates derived statistics (10 minute wind average, pressure tendency, 24-hour outlook, etc.), and publishes a consolidated JSON payload.
2. **WeatherDashboardDevice** is a lightweight virtual sensor that exposes the JSON payload (and a prettified variant) as device attributes, making the data available to Hubitat dashboards.
3. **weather-dashboard.js** renders the JSON payload inside a single dashboard tile (the JavaScript injector tile), recreating the information-dense layout of the Ecowitt console.

## Hubitat Setup Summary

1. Install the **Weather Dashboard Device** driver and **Weather Dashboard App** in Hubitat.
2. Create a virtual device using the driver, or allow the app to create/manage it automatically.
3. Configure the app by selecting your source weather device and mapping the attribute names that correspond to each data point.
4. Add both the dashboard device (as an **Attribute** tile) and the JavaScript Injector tile to your Hubitat dashboard.
   * Assign the injector to `tile-0`.
   * Assign the dashboard device’s JSON segment attributes to the remaining tiles (template **Attribute**). Use the plain JSON variants (`segmentCore`, `segmentPrecip`, `segmentAmbient1`, `segmentAmbient2`, `segmentAirQuality`, `segmentMeta`, `segmentLayout`, etc.) on sequential tiles starting with `tile-1`. The JavaScript tile gathers valid JSON from every attribute tile automatically, so you can add as many segments as your layout requires. The matching `...B64` attributes are optional and intended for external consumers that prefer base64-encoded payloads.
5. Paste the contents of `dashboard/weather-dashboard.js` into the JavaScript Injector configuration.

The app publishes a consolidated JSON document to the dashboard device. The driver converts that document into deterministic segments (core conditions, precipitation/solar/lightning, ambient sensors in groups of four, air quality, metadata, and layout) and stores each segment in its own attribute. Keeping each segment under 700 bytes avoids Hubitat’s 1 KB attribute ceiling and eliminates the need for runtime chunk reassembly.

> **Tip:** The original experimental scripts, apps, and drivers are preserved under `v1/` for reference.

## Development notes

* The JavaScript focuses purely on presentation—calculations live in the Hubitat app.
* The JSON payload is designed to be compact but descriptive, minimizing the number of attributes required on the virtual device.
* Derived metrics (wind averages, pressure tendency, outlook) are recalculated every minute or whenever the underlying weather attributes change.

## Runtime layout overrides

The app exposes an optional **Layout configuration JSON** textarea that lets you change the dashboard canvas size and grid without editing the JavaScript. Provide a JSON object with the following keys:

* `baseWidth` / `baseHeight` – optional pixel overrides for the logical canvas size. When omitted, the script matches the dimensions of the host dashboard tile automatically.
* `dimensionUnits` – set to `"percent"` to express row heights and column widths as percentages of the base dimensions (defaults to pixels).
* `columnWidths` – array that defines the global `grid-template-columns` tracks without writing CSS strings. Accepts numbers or strings, following the selected `dimensionUnits`.
* `desktop`, `tablet`, `mobile` – objects that can override `columns`, `columnWidths`, `gap`, and `rows` for each breakpoint. Rows are arrays of objects with a `height` (pixels or percentages) and a `columns` array that names the cards to place in that row.

Example:

```json
{
  "baseWidth": 1200,
  "baseHeight": 900,
  "columnWidths": [720, 480],
  "desktop": {
    "gap": "18px",
    "rows": [
      { "height": 450, "columns": ["temp-wind", "ambient"] },
      { "height": 180, "columns": ["air", "rain"] }
    ]
  }
}
```

Values you omit fall back to the defaults compiled into `weather-dashboard.js`, so you only need to supply the parts you want to adjust.

To work in percentages instead of pixels, provide `"dimensionUnits": "percent"`. Numeric `height` and `columnWidths` entries are then treated as percentages of the detected or overridden base dimensions:

```json
{
  "dimensionUnits": "percent",
  "columnWidths": [60, 40],
  "desktop": {
    "rows": [
      { "height": 55, "columns": ["temp-wind", "ambient"] },
      { "height": 45, "columns": ["air", "rain"] }
    ]
  }
}
```

### Controlling individual card heights and vertical placement

Rows define the vertical tracks of the grid. Every card listed in the same row shares that track’s height. To make one card taller than another in the same column, split the column into multiple rows and repeat the card name in each row you want it to span. Cards only occupy the rows where their name appears, so you can leave a gap for the other column by using `"."` as a placeholder.

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

The top offset for any card is the sum of the row heights that precede the first row containing that card. Spanning multiple rows increases the card’s height by the additional row heights. This lets you dial in each card’s footprint without editing the JavaScript.

