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
   * Assign the injector to `tile-1`.
   * Assign the dashboard device attribute(s) to `tile-2` (and optionally `tile-3`, `tile-4` if you split the payload).
5. Paste the contents of `dashboard/weather-dashboard.js` into the JavaScript Injector configuration.

The app publishes a consolidated JSON document to the dashboard device’s `dashboardData` attribute. The JavaScript presentation tile watches that attribute and renders the rich dashboard view.

> **Tip:** The original experimental scripts, apps, and drivers are preserved under `v1/` for reference.

## Development notes

* The JavaScript focuses purely on presentation—calculations live in the Hubitat app.
* The JSON payload is designed to be compact but descriptive, minimizing the number of attributes required on the virtual device.
* Derived metrics (wind averages, pressure tendency, outlook) are recalculated every minute or whenever the underlying weather attributes change.

