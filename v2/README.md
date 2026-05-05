# Ecowitt Weather Dashboard v2 Snapshot

This directory preserves the v2 dashboard workspace and its supporting docs.

## Project layout

```
v2/README.md                        Snapshot overview
v2/dashboard/weather-dashboard.js   v2 dashboard bundle source snapshot
v2/assets/weather-dashboard-icon.svg Tile icon used by the v2 Hubitat files
v2/hubitat/WeatherDashboardApp.groovy   v2 Hubitat app snapshot
v2/hubitat/WeatherDashboardDevice.groovy v2 device driver snapshot
v2/docs/*.md                        v2-specific technical notes
```

## What is in this snapshot

1. `v2/hubitat/WeatherDashboardApp.groovy` and `v2/hubitat/WeatherDashboardDevice.groovy` mirror the v2 Hubitat app/device pairing.
2. `v2/dashboard/weather-dashboard.js` is the v2 dashboard bundle used by that workspace.
3. `v2/assets/weather-dashboard-icon.svg` is the icon referenced by the v2 Hubitat metadata.
4. `v2/docs/` contains supporting notes that describe the v2 rendering and chunking behavior.

## How to use this folder

* Keep the files in `v2/` aligned with the `v2/` code only.
* Use the root project docs for the current codebase.
* Do not treat this snapshot as the active documentation for the root implementation.
