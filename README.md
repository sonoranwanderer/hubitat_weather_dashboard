Code and supporting configuration to build an Ecowitt HP2561 like hubitat Dashboard

Each JavaScript file represents a tile to be used on the dashboard creating one of
the core display elements of the Ecowitt HP2561. Notable tiles include:

* `wind-compass.js` — renders a compass-inspired visualization of current, gust, and averaged wind direction.
* `wind-average-text.js` — provides a single-line readout of ten-minute averaged wind bearing, cardinal direction, and speed that other tiles can reference.
* `rain-rate-summary.js` — combines readings from the rain-rate, event, and accumulation tiles into a single drop-themed summary with current rate, daily total, and interval table.
* `pressure-forecast.js` — renders an Ecowitt-style barometer tile with toggleable absolute/relative pressure, calculated barometric tendency, and 24-hour forecast icon fed by the companion Hubitat app and virtual device.

The Javascript is brought into the dashboard by using the Dashboard JavaScript Injector:
https://github.com/michaelbarone/hubitat/blob/master/drivers/dashboardJavaScriptInjector.groovy 

The javscript reads data from other tiles on the dashboard that expose one of:
* Weather device attribute
* Hub variable
* Collection of HTML formated data from a weather device (device driver specific)
* Other useful information from non device or hub variable sources

This code relies on the Ecowitt driver as maintained
https://github.com/sburke781/ecowitt

The documentation for the HTML templates on the Github sit above is incomplete, the
full set of templates can be read directly here:
https://sburke781.github.io/ecowitt/html/ecowitt.json

## Pressure tendency virtual device & app

The repository now includes a simple Hubitat app/driver pair to accumulate the pressure history that the HP2561 console uses for its tendency/forecast display:

* `hubitat/PressureTendencyDevice.groovy` — a virtual device driver that exposes calculated attributes (relative/absolute pressure, daily average, rolling 30-day average, tendency, and forecast meta data) along with a compact JSON payload (`pressureSummary`) for the dashboard tile.
* `hubitat/PressureTendencyApp.groovy` — subscribes to the Ecowitt weather device, computes the running daily average and rolling 30-day average, derives a tendency delta and forecast classification, and pushes the consolidated values into the virtual device.

### Setup outline

1. In **Drivers Code**, add `PressureTendencyDevice.groovy`, then create a new Virtual Device using that driver (e.g., "Pressure Tendency Summary").
2. In **Apps Code**, add `PressureTendencyApp.groovy`, install the app, select your Ecowitt source device, provide the attribute names for relative/absolute pressure, choose which attribute should be the reference for averaging, and select the virtual device created above.
3. Add the virtual device's `pressureSummary` attribute to your dashboard as an *Attribute* tile, note its tile ID/title, and inject `pressure-forecast.js` with the matching configuration constants.
   * The script now supports separate tiles for the rendered display and the raw data source. Provide the display tile's ID/title via `DISPLAY_TILE_ID`/`DISPLAY_TILE_TITLE`, and (optionally) point `SOURCE_TILE_ID`/`SOURCE_TILE_TITLE` at a different attribute tile if you want to keep the JSON visible for troubleshooting.

The app persists up to 30 daily averages so the 30-day baseline gradually becomes more accurate as data accumulates. Until enough history exists the tendency will gracefully fall back to the best available information.
