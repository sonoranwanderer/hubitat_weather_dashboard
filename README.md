Code and supporting configuration to build an Ecowitt HP2561 like hubitat Dashboard

Each JavaScript file represents a tile to be used on the dashboard creating one of 
the core display elements of the Ecowitt HP2561

The Javascript is brought into the dashboard by using the Dashboard JavaScript Injector:
https://github.com/michaelbarone/hubitat/blob/master/drivers/dashboardJavaScriptInjector.groovy 

The javscript reads data from other tiles on the dashboard that expose one of:
* Weather device attribute
* Hub variable
* Collection of HTML formated data from a weather device (device driver specific)
* Other useful information from non device or hub variable sources

