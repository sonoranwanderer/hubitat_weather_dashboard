Code and supporting configuration to build an Ecowitt HP2561 like hubitat Dashboard

Each JavaScript file represents a tile to be used on the dashboard creating one of
the core display elements of the Ecowitt HP2561. Notable tiles include:

* `wind-compass.js` — renders a compass-inspired visualization of current, gust, and averaged wind direction.
* `wind-average-text.js` — provides a single-line readout of ten-minute averaged wind bearing, cardinal direction, and speed that other tiles can reference.
* `rain-rate-summary.js` — combines readings from the rain-rate, event, and accumulation tiles into a single drop-themed summary with current rate, daily total, and interval table.

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
