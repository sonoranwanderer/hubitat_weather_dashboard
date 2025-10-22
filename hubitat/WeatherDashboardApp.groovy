/*
 * WeatherDashboardApp.groovy
 *
 * Aggregates Hubitat weather device data, computes derived statistics, and publishes
 * a JSON payload for consumption by the Weather Dashboard driver/JS tile.
 */

import groovy.json.JsonOutput
import groovy.json.JsonSlurper
import groovy.transform.Field
import java.math.RoundingMode
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.TimeZone

definition(
    name: "Weather Dashboard App",
    namespace: "ecowitt-dashboard",
    author: "Gatewood Green",
    description: "Aggregates weather data for the JavaScript dashboard tile.",
    category: "Convenience",
    importUrl: "https://raw.githubusercontent.com/sonoranwanderer/ecowitt_weather_hubitat_dashboard/main/hubitat/WeatherDashboardApp.groovy",
    iconUrl: "https://raw.githubusercontent.com/sonoranwanderer/ecowitt_weather_hubitat_dashboard/main/assets/weather-dashboard-icon.svg",
    iconX2Url: "https://raw.githubusercontent.com/sonoranwanderer/ecowitt_weather_hubitat_dashboard/main/assets/weather-dashboard-icon.svg"
)

@Field final TimeZone UTC_ZONE = TimeZone.getTimeZone('UTC')
@Field final Map<String, Integer> LOG_LEVEL_ORDER = [
    error: 0,
    warn : 1,
    info : 2,
    debug: 3,
    trace: 4
]

preferences {
    page(name: "mainPage", title: "Weather Dashboard", install: true, uninstall: true)
    page(name: "diagnosticsPage")
}

def mainPage() {
    dynamicPage(name: "mainPage") {
        section("Weather data sources") {
            input name: "weatherDevices", type: "capability.sensor", title: "Weather devices", multiple: true, required: true, submitOnChange: true
            if (!settings.weatherDevices) {
                paragraph "Select one or more devices that provide the core weather attributes."
            }
        }

        def deviceOptions = weatherDeviceOptions()

        section("Attribute mapping (choose a device and override attribute names if needed)") {
            attributeInputs("Outdoor temperature", "attrOutdoorTemp", "temperature", deviceOptions)
            attributeInputs("Feels like", "attrFeelsLike", "feelsLike", deviceOptions)
            attributeInputs("Dew point", "attrDewPoint", "dewPoint", deviceOptions)
            attributeInputs("Outdoor humidity", "attrOutdoorHumidity", "humidity", deviceOptions)
            attributeInputs("Indoor temperature", "attrIndoorTemp", "temperatureIndoor", deviceOptions)
            attributeInputs("Indoor humidity", "attrIndoorHumidity", "humidityIndoor", deviceOptions)
            attributeInputs("Indoor battery", "attrIndoorBattery", "battery", deviceOptions)
            attributeInputs("Wind speed", "attrWindSpeed", "windSpeed", deviceOptions)
            attributeInputs("Wind gust", "attrWindGust", "windGust", deviceOptions)
            attributeInputs("Max Daily Gust", "attrWindGustMaxDaily", "windGustMaxDaily", deviceOptions)
            attributeInputs("Wind direction (cardinal)", "attrWindDirection", "windDirection", deviceOptions)
            attributeInputs("Wind direction (degrees)", "attrWindDirectionDegrees", "windDirectionDegrees", deviceOptions)
            attributeInputs("Relative pressure", "attrPressure", "pressure", deviceOptions)
            attributeInputs("Absolute pressure", "attrAbsolutePressure", "pressureAbsolute", deviceOptions)
            attributeInputs("Rain rate", "attrRainRate", "rainRate", deviceOptions)
            attributeInputs("Daily rain", "attrRainDaily", "rainDaily", deviceOptions)
            attributeInputs("Event rain", "attrRainEvent", "rainEvent", deviceOptions)
            attributeInputs("Hourly rain", "attrRainHourly", "rainHourly", deviceOptions)
            attributeInputs("Weekly rain", "attrRainWeekly", "rainWeekly", deviceOptions)
            attributeInputs("Monthly rain", "attrRainMonthly", "rainMonthly", deviceOptions)
            attributeInputs("Yearly rain", "attrRainYearly", "rainYearly", deviceOptions)
            attributeInputs("UV index", "attrUVIndex", "uv", deviceOptions)
            attributeInputs("UV color", "attrUVColor", "ultravioletColor", deviceOptions)
            attributeInputs("UV danger", "attrUVDanger", "ultravioletDanger", deviceOptions)
            attributeInputs("Solar radiation", "attrSolarRadiation", "solarRadiation", deviceOptions)
            attributeInputs("Weather station update time", "attrStationUpdatedAt", "lastUpdateTime", deviceOptions)
        }

        section("Outdoor Air Quality (optional)") {
            attributeInputs("AQI", "attrOutdoorAQI", "aqi", deviceOptions)
            attributeInputs("AQI (24h Avg)", "attrOutdoorAQI24h", "aqi_avg_24h", deviceOptions)
            attributeInputs("AQI Color", "attrOutdoorAQIColor", "aqiColor", deviceOptions)
            attributeInputs("AQI Color (24h Avg)", "attrOutdoorAQIColor24h", "aqiColor_avg_24h", deviceOptions)
            attributeInputs("AQI Danger", "attrOutdoorAQIDanger", "aqiDanger", deviceOptions)
            attributeInputs("AQI Danger (24h Avg)", "attrOutdoorAQIDanger24h", "aqiDanger_avg_24h", deviceOptions)
            attributeInputs("PM2.5", "attrOutdoorPM25", "pm25", deviceOptions)
            attributeInputs("PM2.5 (24h Avg)", "attrOutdoorPM25_24h", "pm25_avg_24h", deviceOptions)
            attributeInputs("Battery", "attrOutdoorAQIBattery", "battery", deviceOptions)
        }

        section("Indoor Air Quality (optional)") {
            // Using the same structure as outdoor for consistency
            attributeInputs("AQI",                  "attrIndoorAQI",              "aqi", deviceOptions)
            attributeInputs("AQI (24h Avg)",        "attrIndoorAQI24h",           "aqi_avg_24h", deviceOptions)
            attributeInputs("AQI Color",            "attrIndoorAQIColor",         "aqiColor", deviceOptions)
            attributeInputs("AQI Color (24h Avg)",  "attrIndoorAQIColor24h",      "aqiColor_avg_24h", deviceOptions)
            attributeInputs("AQI Danger",           "attrIndoorAQIDanger",        "aqiDanger", deviceOptions)
            attributeInputs("AQI Danger (24h Avg)", "attrIndoorAQIDanger24h",     "aqiDanger_avg_24h", deviceOptions)
            attributeInputs("CO2",                  "attrIndoorCO2",              "carbonDioxide", deviceOptions)
            attributeInputs("CO2 (24h Avg)",        "attrIndoorCO2_24h",          "carbonDioxide_avg_24h", deviceOptions)
            attributeInputs("PM10",                 "attrIndoorPM10",             "pm10", deviceOptions)
            attributeInputs("PM10 (24h Avg)",       "attrIndoorPM10_24h",         "pm10_avg_24h", deviceOptions)
            attributeInputs("PM2.5",                "attrIndoorPM25",             "pm25", deviceOptions)
            attributeInputs("PM2.5 (24h Avg)",      "attrIndoorPM25_24h",         "pm25_avg_24h", deviceOptions)
            attributeInputs("Battery",              "attrIndoorAQIBattery",       "battery", deviceOptions)
        }

        section("Lightning sensor (optional)") {
            attributeInputs("Lightning count", "attrLightningCount", "lightningCount", deviceOptions)
            attributeInputs("Lightning distance", "attrLightningDistance", "lightningDistance", deviceOptions)
            attributeInputs("Lightning time", "attrLightningTime", "lightningTime", deviceOptions)
        }

        section("Battery attributes (optional)") {
            attributeInputs("Outdoor sensor battery", "attrOutdoorBattery", "battery", deviceOptions)
            attributeInputs("Wind sensor battery", "attrBatteryWind", "batteryWind", deviceOptions)
            attributeInputs("Rain sensor battery", "attrBatteryRain", "batteryRain", deviceOptions)
            attributeInputs("Lightning sensor battery", "attrLightningBattery", "battery", deviceOptions)
        }

        section("Ambient rotation sensors (optional)") {
            input name: "ambientSensors", type: "capability.sensor", title: "Ambient temperature/humidity sensors", multiple: true, required: false, submitOnChange: true
            if (settings.ambientSensors) {
                input name: "ambientTempAttr", type: "text", title: "Ambient temperature attribute", defaultValue: "temperature"
                input name: "ambientHumidityAttr", type: "text", title: "Ambient humidity attribute", defaultValue: "humidity"
                input name: "ambientBatteryAttr", type: "text", title: "Ambient battery attribute", defaultValue: "battery"
                input name: "ambientTemperatureUnit", type: "text", title: "Ambient temperature unit label", defaultValue: "°F"
                input name: "ambientHumidityUnit", type: "text", title: "Ambient humidity unit label", defaultValue: "%"
                input name: "ambientRotationSeconds", type: "number", title: "Rotation interval (seconds)", defaultValue: 12, range: "3..120"
            }
        }

        section("Refresh scheduling") {
            paragraph "Use cron and event triggers to balance update frequency with hub load."
            paragraph "Set the cron interval to 0 to disable the timer. Disable event triggers when a noisy device generates too many refreshes. At least one option must stay enabled."

            input name: "refreshCronMinutes", type: "number", title: "Cron refresh interval (minutes)", defaultValue: 1, range: "0..60", submitOnChange: true, width: 6
            input name: "enableEventTriggers", type: "bool", title: "Enable event-driven refreshes", defaultValue: true, submitOnChange: true, width: 6

            boolean cronEnabled = cronIntervalMinutes() > 0
            boolean eventEnabled = eventTriggersEnabled()

            if (!cronEnabled && !eventEnabled) {
                paragraph "<b>Enable at least one refresh option</b> to keep the dashboard up to date."
            }

            if (eventEnabled) {
                input name: "refreshTriggerMode", type: "enum", title: "Event subscription scope", options: [
                    "all": "Subscribe to all selected attributes",
                    "single": "Subscribe to a single attribute update"
                ], defaultValue: "all", required: true, submitOnChange: true

                if ((settings.refreshTriggerMode ?: "all") == "single") {
                    input name: "singleTriggerDevice", type: "enum", title: "Trigger device", options: subscriptionDeviceOptions(deviceOptions), required: true, submitOnChange: true, width: 6

                    def triggerAttributeOptions = singleTriggerAttributeOptions()
                    if (triggerAttributeOptions) {
                        input name: "singleTriggerAttribute", type: "enum", title: "Trigger attribute", options: triggerAttributeOptions, required: true, width: 6
                    } else {
                        input name: "singleTriggerAttribute", type: "text", title: "Trigger attribute", required: true, width: 6
                        if (settings.singleTriggerDevice) {
                            paragraph "The selected device did not provide a list of supported attributes. Enter the attribute name manually."
                        }
                    }

                    paragraph "Only the selected attribute change will trigger dashboard refreshes."
                } else {
                    paragraph "The app will subscribe to all configured attributes."
                }
            } else {
                paragraph "Event subscriptions are disabled. The dashboard will refresh solely on the cron schedule."
            }
        }

        section("Logging") {
            paragraph "Choose the minimum level of messages that should appear in the Hubitat logs."
            input name: "logLevel", type: "enum", title: "Logging level", options: loggingLevelOptions(), defaultValue: "info", required: true, submitOnChange: true, width: 6
        }

        section("Performance metrics summary") {
            paragraph "Recent refresh statistics collected during normal operation." 
            String refreshSummary = renderRefreshMetricsHtml()
            String eventSummary = renderEventMetricsHtml()
            String historySummary = renderHistoryMetricsHtml()

            if (!refreshSummary && !eventSummary && !historySummary) {
                paragraph "Metrics appear after the dashboard processes refresh activity."
            } else {
                if (refreshSummary) {
                    paragraph "<b>Refresh performance</b>"
                    paragraph refreshSummary
                }
                if (eventSummary) {
                    paragraph "<b>Event trigger pressure</b>"
                    paragraph eventSummary
                }
                if (historySummary) {
                    paragraph "<b>History maintenance</b>"
                    paragraph historySummary
                }
            }
        }

        section("Derived calculation settings") {
            input name: "windAverageMinutes", type: "number", title: "Wind average window (minutes)", defaultValue: 10, range: "5..60"
            input name: "pressureTrendHours", type: "number", title: "Pressure tendency window (hours)", defaultValue: 3, range: "1..12"
            input name: "pressureBaselineDays", type: "number", title: "Pressure baseline window (days)", defaultValue: 30, range: "7..60"
        }

        section("Layout overrides (optional)") {
            paragraph "Provide JSON to fine-tune the dashboard canvas size and grid rows/columns. Leave blank to use the built-in defaults."
            paragraph "Set `baseWidth` and `baseHeight` (in pixels) to control the canvas size. Rows accept objects like `{ \"height\": 360, \"columns\": [\"temp-wind\", \"ambient\"] }`."
            paragraph "Repeat a card name in consecutive rows to make it span multiple heights, and use `\".\"` as a placeholder when you want the other column to stay empty so the next card can start higher."
            paragraph "Example:<br><code>{\n  \"baseWidth\": 1200,\n  \"baseHeight\": 900,\n  \"desktop\": {\n    \"rows\": [\n      { \"height\": 220, \"columns\": [\"temp-wind\", \"ambient\"] },\n      { \"height\": 200, \"columns\": [\"temp-wind\", \".\"] },\n      { \"height\": 180, \"columns\": [\"air\", \"rain\"] }\n    ]\n  }\n}</code>"
            input name: "layoutOverrideJson", type: "textarea", title: "Layout configuration JSON", required: false
        }

        section("Dashboard device") {
            input name: "dashboardDeviceLabel", type: "text", title: "Dashboard device label", defaultValue: "Weather Dashboard"
        }

        section("Actions") {
            input name: "saveAndPreview", type: "button", title: "Save & Refresh"
            input name: "refreshNow", type: "button", title: "Refresh"
        }
        section("Diagnostics") {
            href "diagnosticsPage", title: "View Latest Payload", description: "Show the last generated JSON payload for troubleshooting."
        }
    }
}

private void attributeInputs(String label, String attrSetting, String defaultAttr, Map options) {
    input name: "${attrSetting}Device", type: "enum", title: "${label} device", options: options ?: [:], required: false, width: 6, submitOnChange: true

    def attributeOptions = attributeOptionsForSetting(attrSetting, defaultAttr)
    if (attributeOptions) {
        input name: attrSetting, type: "enum", title: "${label} attribute", options: attributeOptions, defaultValue: settings[attrSetting] ?: defaultAttr, required: false, width: 6
    } else {
        input name: attrSetting, type: "text", title: "${label} attribute", defaultValue: defaultAttr, width: 6
    }
}

private Map weatherDeviceOptions() {
    def devices = getWeatherDevices()
    devices.collectEntries { dev ->
        [(dev.id?.toString()): dev.displayName]
    }
}

private Map loggingLevelOptions() {
    [
        error: 'Error',
        warn : 'Warn',
        info : 'Info',
        debug: 'Debug',
        trace: 'Trace'
    ]
}

private String configuredLogLevel() {
    String level = (settings?.logLevel ?: 'info')?.toString()?.toLowerCase()
    if (!LOG_LEVEL_ORDER.containsKey(level)) {
        level = 'info'
    }
    level
}

private boolean shouldLogLevel(String level) {
    if (!level) {
        return false
    }
    Integer candidate = LOG_LEVEL_ORDER[level] ?: LOG_LEVEL_ORDER.info
    Integer configured = LOG_LEVEL_ORDER[configuredLogLevel()] ?: LOG_LEVEL_ORDER.info
    candidate <= configured
}

private void logTrace(String message) {
    if (shouldLogLevel('trace')) {
        log.trace message
    }
}

private void logDebug(String message) {
    if (shouldLogLevel('debug')) {
        log.debug message
    }
}

private void logInfo(String message) {
    if (shouldLogLevel('info')) {
        log.info message
    }
}

private void logWarn(String message) {
    if (shouldLogLevel('warn')) {
        log.warn message
    }
}

private void logError(String message, Throwable t = null) {
    if (!shouldLogLevel('error')) {
        return
    }
    if (t) {
        log.error message, t
    } else {
        log.error message
    }
}

private Map subscriptionDeviceOptions(Map weatherOptions) {
    LinkedHashMap options = new LinkedHashMap()
    if (weatherOptions) {
        options.putAll(weatherOptions)
    }
    getAmbientSensors()?.each { dev ->
        if (dev?.id) {
            options.put(dev.id.toString(), dev.displayName)
        }
    }
    options
}

private Integer cronIntervalMinutes() {
    Integer minutes = safeToInt(settings.refreshCronMinutes, 1)
    if (minutes < 0) {
        minutes = 0
    }
    if (minutes == 0 && state?.cronFallbackMinutes) {
        minutes = safeToInt(state.cronFallbackMinutes, minutes)
    }
    minutes
}

private boolean cronSchedulingEnabled() {
    cronIntervalMinutes() > 0
}

private boolean eventTriggersEnabled() {
    settings.enableEventTriggers != false
}

private Map metricsState() {
    if (!(state.metrics instanceof Map)) {
        state.metrics = [:]
    }
    state.metrics as Map
}

private Map ensureMetricsSubMap(Map parent, String key) {
    if (!(parent[key] instanceof Map)) {
        parent[key] = [:]
    }
    parent[key] as Map
}

private void enqueueRefreshSource(String source) {
    List queue = (state.nextRefreshSourceQueue instanceof List) ? (state.nextRefreshSourceQueue as List) : []
    queue << (source ?: 'unknown')
    state.nextRefreshSourceQueue = queue
}

private String consumeRefreshSource(String defaultSource = 'unknown') {
    List queue = (state.nextRefreshSourceQueue instanceof List) ? (state.nextRefreshSourceQueue as List) : []
    String source = queue ? (queue.remove(0) ?: defaultSource) : defaultSource
    state.nextRefreshSourceQueue = queue
    return source ?: defaultSource
}

private void recordRefreshMetrics(String source, long startedAt, long completedAt, boolean suppressed, boolean payloadUpdated) {
    Map metrics = metricsState()
    Map refresh = ensureMetricsSubMap(metrics, 'refresh')

    long durationMs = Math.max(0L, completedAt - startedAt)
    long totalInvocations = ((refresh.totalInvocations ?: 0L) as Long) + 1L
    refresh.totalInvocations = totalInvocations
    refresh.firstRunAt = (refresh.firstRunAt ?: startedAt)
    refresh.lastRunAt = completedAt
    refresh.lastDurationMs = durationMs
    refresh.totalDurationMs = ((refresh.totalDurationMs ?: 0L) as Long) + durationMs
    refresh.lastSource = source

    Map bySource = ensureMetricsSubMap(refresh, 'bySource')
    bySource[source] = ((bySource[source] ?: 0L) as Long) + 1L

    if (suppressed) {
        refresh.suppressedRuns = ((refresh.suppressedRuns ?: 0L) as Long) + 1L
    } else {
        refresh.completedRuns = ((refresh.completedRuns ?: 0L) as Long) + 1L
        if (payloadUpdated) {
            refresh.payloadUpdates = ((refresh.payloadUpdates ?: 0L) as Long) + 1L
        }
        refresh.lastCompletedAt = completedAt
    }
}

private void recordCronMetrics(Map updates) {
    Map refresh = ensureMetricsSubMap(metricsState(), 'refresh')
    Map cron = ensureMetricsSubMap(refresh, 'cron')
    updates.each { key, value ->
        if (key instanceof String && key.startsWith('set:')) {
            String actual = key.substring(4)
            cron[actual] = value
        } else if (value instanceof Number) {
            cron[key] = ((cron[key] ?: 0L) as Long) + (value as Number).longValue()
        } else {
            cron[key] = value
        }
    }
    cron.lastUpdatedAt = now()
}

private void recordEventTriggerMetrics(evt) {
    if (!evt) {
        return
    }
    Map metrics = metricsState()
    Map events = ensureMetricsSubMap(metrics, 'events')
    events.totalEvents = ((events.totalEvents ?: 0L) as Long) + 1L
    events.lastEventAt = now()
    String deviceName = evt?.displayName ?: evt?.device?.displayName ?: evt?.deviceId ?: 'Unknown device'
    String attribute = evt?.name ?: 'unknown'
    String key = "${deviceName}.${attribute}"
    Map bySource = ensureMetricsSubMap(events, 'bySource')
    bySource[key] = ((bySource[key] ?: 0L) as Long) + 1L
    events.lastEventSource = key
}

private void recordHistoryMaintenance(String name, int before, int after, int pruned, boolean added, long timestamp) {
    Map histories = ensureMetricsSubMap(metricsState(), 'histories')
    Map entry = ensureMetricsSubMap(histories, name)
    entry.lastSize = after
    entry.maxSize = Math.max((entry.maxSize ?: 0L) as Long, after as long)
    entry.totalPruned = ((entry.totalPruned ?: 0L) as Long) + Math.max(0L, pruned as long)
    if (added) {
        entry.totalAppended = ((entry.totalAppended ?: 0L) as Long) + 1L
    }
    entry.lastUpdatedAt = timestamp
}

private String formatDuration(Long ms) {
    if (ms == null) {
        return 'n/a'
    }
    if (ms < 1000L) {
        return "${ms} ms"
    }
    double seconds = ms / 1000.0D
    if (seconds < 60) {
        return String.format('%.1f s', seconds)
    }
    double minutes = seconds / 60.0D
    if (minutes < 60) {
        return String.format('%.1f min', minutes)
    }
    double hours = minutes / 60.0D
    return String.format('%.1f hr', hours)
}

private String formatPerHour(Long total, Long firstAt, Long lastAt) {
    if (!total || total <= 1L || !firstAt || !lastAt || lastAt <= firstAt) {
        return 'n/a'
    }
    double spanMs = (lastAt - firstAt) as double
    double perHour = (total * 3600000.0D) / spanMs
    return String.format('%.2f/hr', perHour)
}

private String formatTimestamp(Long millis) {
    if (!millis) {
        return 'n/a'
    }
    return new Date(millis).format("yyyy-MM-dd HH:mm:ss", location?.timeZone ?: UTC_ZONE)
}

private String htmlList(List<String> entries) {
    if (!entries) {
        return null
    }
    String items = entries.collect { entry -> "<li>${htmlEncode(entry)}</li>" }.join('')
    return "<ul>${items}</ul>"
}

private String renderRefreshMetricsHtml() {
    Map refresh = (metricsState().refresh ?: [:]) as Map
    if (!(refresh.totalInvocations)) {
        return null
    }

    long total = (refresh.totalInvocations ?: 0L) as Long
    long completed = (refresh.completedRuns ?: 0L) as Long
    long suppressed = (refresh.suppressedRuns ?: 0L) as Long
    long payloads = (refresh.payloadUpdates ?: 0L) as Long
    long totalDuration = (refresh.totalDurationMs ?: 0L) as Long
    long avgDuration = total > 0 ? Math.round(totalDuration / (double) total) : 0L
    String avgFormatted = formatDuration(avgDuration)
    String lastDuration = formatDuration(refresh.lastDurationMs as Long)
    String lastSource = refresh.lastSource ?: 'unknown'
    String lastTimestamp = formatTimestamp(refresh.lastRunAt as Long)
    String rate = formatPerHour(total, refresh.firstRunAt as Long, refresh.lastRunAt as Long)

    List<String> entries = []
    entries << "Invocations: ${total} (completed: ${completed}, suppressed: ${suppressed}, payload updates: ${payloads})"
    entries << "Average duration: ${avgFormatted}; last run ${lastDuration} via ${lastSource} at ${lastTimestamp}"
    entries << "Observed cadence: ${rate}"

    Map bySource = (refresh.bySource ?: [:]) as Map
    if (bySource) {
        def topSources = bySource.entrySet().sort { -((it.value ?: 0L) as Long) }.take(5)
        String summary = topSources.collect { entry ->
            "${entry.key ?: 'unknown'} (${entry.value})"
        }.join(', ')
        entries << "Top refresh sources: ${summary}"
    }

    Map cron = (refresh.cron ?: [:]) as Map
    if (cron?.invocations) {
        long invocations = (cron.invocations ?: 0L) as Long
        long executions = (cron.executions ?: 0L) as Long
        long skippedDuringEvent = (cron.skippedDuringEvent ?: 0L) as Long
        long skippedRecent = (cron.skippedRecentEvent ?: 0L) as Long
        long skippedDisabled = (cron.skippedDisabled ?: 0L) as Long
        String lastExec = formatTimestamp(cron.lastExecutionAt as Long)
        entries << "Cron invocations: ${invocations}; executed: ${executions}; skipped (pending event: ${skippedDuringEvent}, recent event: ${skippedRecent}, disabled: ${skippedDisabled}); last execution: ${lastExec}"
    }

    return htmlList(entries)
}

private String renderEventMetricsHtml() {
    Map events = (metricsState().events ?: [:]) as Map
    if (!(events.totalEvents)) {
        return null
    }

    long total = (events.totalEvents ?: 0L) as Long
    String lastSource = events.lastEventSource ?: 'unknown'
    String lastTimestamp = formatTimestamp(events.lastEventAt as Long)

    List<String> entries = []
    entries << "Total trigger events: ${total}"
    entries << "Last trigger: ${lastSource} at ${lastTimestamp}"

    Map bySource = (events.bySource ?: [:]) as Map
    if (bySource) {
        def topSources = bySource.entrySet().sort { -((it.value ?: 0L) as Long) }.take(5)
        String summary = topSources.collect { entry ->
            "${entry.key ?: 'unknown'} (${entry.value})"
        }.join(', ')
        entries << "Noisiest attributes: ${summary}"
    }

    return htmlList(entries)
}

private String renderHistoryMetricsHtml() {
    Map histories = (metricsState().histories ?: [:]) as Map
    if (!histories) {
        return null
    }

    List<String> entries = []
    ['wind', 'temperature', 'pressure'].each { key ->
        Map entry = (histories[key] ?: [:]) as Map
        if (entry) {
            long lastSize = (entry.lastSize ?: 0L) as Long
            long maxSize = (entry.maxSize ?: 0L) as Long
            long totalPruned = (entry.totalPruned ?: 0L) as Long
            long totalAppended = (entry.totalAppended ?: 0L) as Long
            String label = key.capitalize()
            String lastUpdated = formatTimestamp(entry.lastUpdatedAt as Long)
            entries << "${label} samples — current: ${lastSize}, max: ${maxSize}, pruned: ${totalPruned}, appended: ${totalAppended}; last maintenance: ${lastUpdated}"
        }
    }

    return entries ? htmlList(entries) : null
}

private Integer safeToInt(def value, Integer defaultValue) {
    if (value == null) {
        return defaultValue
    }
    if (value instanceof Number) {
        return (value as Number).intValue()
    }
    String text = value.toString()?.trim()
    if (!text) {
        return defaultValue
    }
    try {
        return Integer.parseInt(text, 10)
    } catch (NumberFormatException ignored) {
        return defaultValue
    }
}

def appButtonHandler(String buttonName) {
    switch (buttonName) {
        case 'saveAndPreview':
            logInfo "Weather Dashboard App save & refresh requested"
            updated()
            state.forceRefresh = true
            enqueueRefreshSource('manual-save')
            refreshWeatherData()
            break
        case 'refreshNow':
            logInfo "Weather Dashboard App manual refresh requested"
            state.forceRefresh = true
            enqueueRefreshSource('manual')
            refreshWeatherData()
            break
        default:
            logWarn "Unhandled button press: ${buttonName}"
    }
}

def installed() {
    logInfo "Installing Weather Dashboard App"
    initialize()
}

def updated() {
    logInfo "Updating Weather Dashboard App"
    unschedule()
    unsubscribe()
    initialize()
}

def initialize() {
    def devices = getWeatherDevices()
    if (!devices) {
        logWarn "Weather devices not configured yet"
        return
    }

    createOrUpdateChildDevice()
    state.windHistory = state.windHistory ?: []
    state.pressureHistory = state.pressureHistory ?: []
    state.pressureBaseline = normalizePressureBaselineState(state.pressureBaseline)
    state.temperatureHistory = state.temperatureHistory ?: []
    state.dailyOutdoorAQ = state.dailyOutdoorAQ ?: [:]
    state.dailyIndoorAQ = state.dailyIndoorAQ ?: [:]
    state.lastSourceFingerprint = null
    state.eventDebounceActive = false
    state.eventRefreshActive = false
    state.lastEventTriggerAt = state.lastEventTriggerAt ?: 0L
    state.lastEventRefreshAt = state.lastEventRefreshAt ?: 0L
    state.cronFallbackMinutes = null

    boolean eventEnabled = eventTriggersEnabled()
    Integer cronMinutes = cronIntervalMinutes()
    boolean cronEnabled = cronMinutes > 0

    if (!cronEnabled && !eventEnabled) {
        Integer fallbackMinutes = 1
        logWarn "Weather Dashboard App requires at least one refresh trigger. Restoring the cron schedule to ${fallbackMinutes} minute."
        app.updateSetting("refreshCronMinutes", [value: fallbackMinutes, type: "number"])
        state.cronFallbackMinutes = fallbackMinutes
        cronMinutes = fallbackMinutes
        cronEnabled = true
    }

    if (eventEnabled) {
        subscribeToSource()
    } else {
        logInfo "Weather Dashboard App event-driven refreshes are disabled."
    }

    if (cronEnabled) {
        scheduleCronRefresh(cronMinutes)
    } else {
        logInfo "Weather Dashboard App cron-based refreshes are disabled."
    }
    state.forceRefresh = true
    runIn(5, "initialRefreshKickoff")
}

def initialRefreshKickoff() {
    enqueueRefreshSource('startup')
    refreshWeatherData()
}

private void subscribeToSource() {
    if (!eventTriggersEnabled()) {
        return
    }
    if (useSingleTriggerMode()) {
        if (subscribeToSingleTrigger()) {
            return
        }
        logWarn "Weather Dashboard App: reverting to full subscriptions because the single trigger configuration is incomplete."
    }
    subscribeToAllSources()
}

private void subscribeToAllSources() {
    def subscriptions = []
    subscriptions.addAll(getAttributeSubscriptions())
    subscriptions.addAll(getAmbientSubscriptions())

    def seen = [] as Set
    subscriptions.each { sub ->
        def device = sub.device
        def attr = sub.attribute
        if (!device || !attr) return
        def key = "${device.id}:${attr}"
        if (seen.contains(key)) return
        try {
            subscribe(device, attr, "handleWeatherEvent")
            seen << key
        } catch (Throwable t) {
            logDebug "Unable to subscribe to ${device.displayName}.${attr}: ${t.message}"
        }
    }
}

private boolean subscribeToSingleTrigger() {
    def config = singleTriggerSubscription()
    if (!config?.device || !config?.attribute) {
        return false
    }
    try {
        subscribe(config.device, config.attribute, "handleWeatherEvent")
        logInfo "Weather Dashboard App subscribed to ${config.device.displayName}.${config.attribute} for refresh triggers"
        return true
    } catch (Throwable t) {
        logWarn "Weather Dashboard App: Unable to subscribe to ${config.device?.displayName ?: 'Unknown device'}.${config.attribute}: ${t.message}"
        return false
    }
}

private void scheduleCronRefresh(Integer minutes = null) {
    Integer interval = minutes != null ? minutes : cronIntervalMinutes()
    if (interval == null || interval <= 0) {
        return
    }
    int seconds = Math.max(1, interval.intValue() * 60)
    runIn(seconds, "scheduledCronRefresh", [overwrite: true])
}

def scheduledCronRefresh() {
    long invokedAt = now()
    recordCronMetrics([invocations: 1, 'set:lastInvocationAt': invokedAt])
    boolean executed = false
    try {
        if (!cronSchedulingEnabled()) {
            recordCronMetrics([skippedDisabled: 1])
            return
        }

        if (state.eventDebounceActive || state.eventRefreshActive) {
            logDebug "Skipping cron refresh because an event-driven refresh is pending or running."
            recordCronMetrics([skippedDuringEvent: 1])
            return
        }

        Integer intervalMinutes = cronIntervalMinutes()
        if (intervalMinutes <= 0) {
            recordCronMetrics([skippedDisabled: 1])
            return
        }

        Long lastEventRefresh = (state.lastEventRefreshAt ?: 0L) as Long
        Long intervalMillis = intervalMinutes * 60_000L
        Long elapsed = lastEventRefresh ? (now() - lastEventRefresh) : null
        if (elapsed != null && elapsed < intervalMillis) {
            logDebug "Skipping cron refresh because an event-driven refresh completed ${elapsed} ms ago (< ${intervalMillis} ms interval)."
            recordCronMetrics([skippedRecentEvent: 1])
            return
        }

        enqueueRefreshSource('cron')
        executed = true
        refreshWeatherData()
    } finally {
        if (executed) {
            recordCronMetrics([executions: 1, 'set:lastExecutionAt': now()])
        }
        if (cronSchedulingEnabled()) {
            scheduleCronRefresh()
        }
    }
}

def refreshFromEvent() {
    if (!eventTriggersEnabled()) {
        state.eventDebounceActive = false
        return
    }

    state.eventRefreshActive = true
    try {
        enqueueRefreshSource('event')
        refreshWeatherData()
    } finally {
        state.eventRefreshActive = false
        state.eventDebounceActive = false
        state.lastEventRefreshAt = now()
    }
}

private List<Map> getAttributeSubscriptions() {
    def attrs = [
        "attrOutdoorTemp",
        "attrFeelsLike",
        "attrDewPoint",
        "attrOutdoorHumidity",
        "attrIndoorTemp",
        "attrIndoorHumidity",
        "attrIndoorBattery",
        "attrWindSpeed",
        "attrWindGust",
        "attrWindGustMaxDaily",
        "attrWindDirection",
        "attrWindDirectionDegrees",
        "attrPressure",
        "attrAbsolutePressure",
        "attrRainRate",
        "attrRainDaily",
        "attrRainEvent",
        "attrRainHourly",
        "attrRainWeekly",
        "attrRainMonthly",
        "attrRainYearly",
        "attrUVIndex",
        "attrUVColor",
        "attrUVDanger",
        "attrSolarRadiation",
        "attrStationUpdatedAt",
        "attrOutdoorAQI",
        "attrOutdoorPM25",
        "attrIndoorAQI",
        "attrIndoorAQI24h",
        "attrIndoorAQIColor",
        "attrIndoorAQIColor24h",
        "attrIndoorAQIDanger",
        "attrIndoorAQIDanger24h",
        "attrIndoorCO2",
        "attrIndoorCO2_24h",
        "attrIndoorPM10",
        "attrIndoorPM10_24h",
        "attrIndoorPM25",
        "attrIndoorPM25_24h"
    ].plus([
        "attrLightningCount",
        "attrLightningDistance",
        "attrLightningTime",
        "attrOutdoorBattery",
        "attrBatteryWind",
        "attrBatteryRain",
        "attrLightningBattery",
        "attrOutdoorAQIBattery",
        "attrIndoorAQIBattery"
    ])

    attrs.collect { settingName ->
        def config = attributeConfig(settingName)
        if (config?.device && config?.attribute) {
            [device: config.device, attribute: config.attribute]
        }
    }.findAll { it }
}

private List<Map> getAmbientSubscriptions() {
    def sensors = getAmbientSensors()
    if (!sensors) return []

    def tempAttr = settings.ambientTempAttr ?: "temperature"
    def humidityAttr = settings.ambientHumidityAttr ?: "humidity"
    def batteryAttr = settings.ambientBatteryAttr ?: "battery"

    def subs = []
    sensors.each { dev ->
        if (tempAttr) {
            subs << [device: dev, attribute: tempAttr]
        }
        if (humidityAttr) {
            subs << [device: dev, attribute: humidityAttr]
        }
        if (batteryAttr) {
            subs << [device: dev, attribute: batteryAttr]
        }
    }
    subs
}

private List getWeatherDevices() {
    def devices = []
    def configured = settings.weatherDevices
    if (configured instanceof Collection) {
        configured.each { if (it) devices << it }
    } else if (configured) {
        devices << configured
    }
    if (!devices && settings.weatherDevice) {
        devices << settings.weatherDevice
    }
    def unique = []
    devices.each { dev ->
        if (dev && !unique.any { it.id == dev.id }) {
            unique << dev
        }
    }
    unique
}

private List getAmbientSensors() {
    def sensors = []
    def configured = settings.ambientSensors
    if (configured instanceof Collection) {
        configured.each { if (it) sensors << it }
    } else if (configured) {
        sensors << configured
    }
    def unique = []
    sensors.each { dev ->
        if (dev && !unique.any { it.id == dev.id }) {
            unique << dev
        }
    }
    unique
}

private boolean useSingleTriggerMode() {
    (settings.refreshTriggerMode ?: "all") == "single"
}

private Map singleTriggerSubscription() {
    def device = resolveSubscriptionDevice(settings.singleTriggerDevice)
    String attribute = settings.singleTriggerAttribute instanceof CharSequence ? settings.singleTriggerAttribute.toString().trim() : null
    if (!attribute) return null
    [device: device, attribute: attribute]
}

private Map singleTriggerAttributeOptions() {
    def device = resolveSubscriptionDevice(settings.singleTriggerDevice)
    if (!device) {
        return null
    }

    List<String> attributeNames = []
    try {
        def supported = device?.getSupportedAttributes()
        supported?.each { attr ->
            String name = attr?.name
            if (name) {
                attributeNames << name
            }
        }
    } catch (Throwable t) {
        logDebug "Weather Dashboard App: unable to enumerate supported attributes for ${device?.displayName}: ${t.message}"
    }

    if (!attributeNames) {
        return null
    }

    LinkedHashMap options = new LinkedHashMap()
    attributeNames.unique().sort().each { attrName ->
        options[attrName] = attrName
    }
    options
}

private def resolveDevice(def deviceSettingValue) {
    def devices = getWeatherDevices()
    if (!deviceSettingValue) {
        return devices ? devices.first() : null
    }
    devices.find { it.id?.toString() == deviceSettingValue.toString() }
}

private def primaryWeatherDevice() {
    def devices = getWeatherDevices()
    devices ? devices.first() : null
}

private def resolveSubscriptionDevice(def deviceSettingValue) {
    if (!deviceSettingValue) {
        return primaryWeatherDevice()
    }
    String id = deviceSettingValue.toString()
    (getWeatherDevices() + getAmbientSensors()).find { dev -> dev?.id?.toString() == id }
}

private Map attributeOptionsForSetting(String attrSetting, String defaultAttr) {
    def deviceSettingName = "${attrSetting}Device"
    def device = resolveDevice(settings[deviceSettingName])
    if (!device) {
        return null
    }

    List<String> attributeNames = []
    try {
        def supported = device?.getSupportedAttributes()
        supported?.each { attr ->
            String name = attr?.name
            if (name) {
                attributeNames << name
            }
        }
    } catch (Throwable t) {
        logDebug "Weather Dashboard App: unable to enumerate supported attributes for ${device?.displayName}: ${t.message}"
    }

    if (!attributeNames) {
        return null
    }

    LinkedHashSet orderedNames = new LinkedHashSet()
    if (defaultAttr) {
        orderedNames << defaultAttr.toString()
    }
    attributeNames.sort().each { attrName ->
        orderedNames << attrName
    }

    def currentValue = settings[attrSetting]
    if (currentValue) {
        orderedNames << currentValue.toString()
    }

    LinkedHashMap options = new LinkedHashMap()
    orderedNames.each { attrName ->
        options[attrName] = attrName
    }
    options
}

private Map attributeConfig(String attrSetting) {
    def attrName = settings[attrSetting]
    if (!attrName) return null
    def deviceSetting = "${attrSetting}Device"
    def device = resolveDevice(settings[deviceSetting]) ?: primaryWeatherDevice()
    if (!device) return null
    [device: device, attribute: attrName]
}

private BigDecimal readDecimalFor(String attrSetting) {
    def config = attributeConfig(attrSetting)
    readDecimal(config?.device, config?.attribute)
}

private Map normalizePressureBaselineState(Object raw) {
    Map baseline = [:]
    if (raw instanceof Map) {
        baseline.putAll(raw as Map)
    }

    def history = (baseline.history instanceof List) ? baseline.history : []
    List normalizedHistory = history.collect { entry ->
        if (!(entry instanceof Map)) return null
        def day = entry.day
        def avg = entry.avg
        String dayString = day != null ? day.toString() : null
        BigDecimal avgValue = toBigDecimal(avg)
        if (!dayString || avgValue == null) return null
        [day: dayString, avg: avgValue]
    }.findAll { it != null }

    baseline.history = normalizedHistory
    baseline.currentDay = baseline.currentDay ? baseline.currentDay.toString() : null
    baseline.dailySum = baseline.dailySum != null ? (toBigDecimal(baseline.dailySum) ?: 0.0G) : 0.0G
    baseline.dailyCount = baseline.dailyCount != null ? (baseline.dailyCount as Integer) : 0
    baseline.lastUnit = baseline.lastUnit ?: null
    baseline.lastUpdated = baseline.lastUpdated ?: null

    return baseline
}

private Map readPressureSample(String attrSetting) {
    def config = attributeConfig(attrSetting)
    readPressureSample(config?.device, config?.attribute)
}

private String readStringFor(String attrSetting) {
    def config = attributeConfig(attrSetting)
    readString(config?.device, config?.attribute)
}

private Map captureRawReadings() {
    LinkedHashMap readings = new LinkedHashMap()
    readings.outdoorTemp = readDecimalFor("attrOutdoorTemp")
    readings.feelsLike = readDecimalFor("attrFeelsLike")
    readings.dewPoint = readDecimalFor("attrDewPoint")
    readings.outdoorHumidity = readDecimalFor("attrOutdoorHumidity")
    readings.outdoorBattery = readDecimalFor("attrOutdoorBattery")

    readings.indoorTemp = readDecimalFor("attrIndoorTemp")
    readings.indoorHumidity = readDecimalFor("attrIndoorHumidity")
    readings.indoorBattery = readDecimalFor("attrIndoorBattery")

    readings.windSpeed = readDecimalFor("attrWindSpeed")
    readings.windGust = readDecimalFor("attrWindGust")
    readings.windDailyMax = readDecimalFor("attrWindGustMaxDaily")
    readings.windBattery = readDecimalFor("attrBatteryWind")
    readings.windDirectionDegrees = readDecimalFor("attrWindDirectionDegrees")
    readings.windDirectionText = readStringFor("attrWindDirection")

    readings.pressureRelative = readPressureSample("attrPressure")
    readings.pressureAbsolute = readPressureSample("attrAbsolutePressure")

    readings.rain = [
        rate   : readDecimalFor("attrRainRate"),
        daily  : readDecimalFor("attrRainDaily"),
        event  : readDecimalFor("attrRainEvent"),
        hourly : readDecimalFor("attrRainHourly"),
        weekly : readDecimalFor("attrRainWeekly"),
        monthly: readDecimalFor("attrRainMonthly"),
        yearly : readDecimalFor("attrRainYearly"),
        battery: readDecimalFor("attrBatteryRain")
    ]

    readings.solar = [
        uvIndex       : readDecimalFor("attrUVIndex"),
        uvColor       : readStringFor("attrUVColor"),
        uvDanger      : readStringFor("attrUVDanger"),
        solarRadiation: readDecimalFor("attrSolarRadiation")
    ]

    readings.outdoorAir = [
        aqi          : readDecimalFor("attrOutdoorAQI"),
        aqi24h       : readDecimalFor("attrOutdoorAQI24h"),
        aqiColor     : readStringFor("attrOutdoorAQIColor"),
        aqiColor24h  : readStringFor("attrOutdoorAQIColor24h"),
        aqiDanger    : readStringFor("attrOutdoorAQIDanger"),
        aqiDanger24h : readStringFor("attrOutdoorAQIDanger24h"),
        pm25         : readDecimalFor("attrOutdoorPM25"),
        pm25_24h     : readDecimalFor("attrOutdoorPM25_24h"),
        battery      : readDecimalFor("attrOutdoorAQIBattery")
    ]

    readings.indoorAir = [
        aqi          : readDecimalFor("attrIndoorAQI"),
        aqi24h       : readDecimalFor("attrIndoorAQI24h"),
        aqiColor     : readStringFor("attrIndoorAQIColor"),
        aqiColor24h  : readStringFor("attrIndoorAQIColor24h"),
        aqiDanger    : readStringFor("attrIndoorAQIDanger"),
        aqiDanger24h : readStringFor("attrIndoorAQIDanger24h"),
        pm10         : readDecimalFor("attrIndoorPM10"),
        pm10_24h     : readDecimalFor("attrIndoorPM10_24h"),
        pm25         : readDecimalFor("attrIndoorPM25"),
        pm25_24h     : readDecimalFor("attrIndoorPM25_24h"),
        co2          : readDecimalFor("attrIndoorCO2"),
        co2_24h      : readDecimalFor("attrIndoorCO2_24h"),
        battery      : readDecimalFor("attrIndoorAQIBattery")
    ]

    readings.lightning = [
        count  : readDecimalFor("attrLightningCount"),
        distance: readDecimalFor("attrLightningDistance"),
        time   : readStringFor("attrLightningTime"),
        battery: readDecimalFor("attrLightningBattery")
    ]

    readings.stationUpdatedAt = normalizeStationTimestamp(readStringFor("attrStationUpdatedAt"))
    readings.ambient = buildAmbientSensorsPayload()
    readings.layoutRaw = currentLayoutOverrideText()

    readings
}

private Map updateDailyTrackerMaintenance(Map readings, long timestamp, TimeZone tz) {
    Map maintenance = [
        outdoor  : null,
        outdoorAQ: null,
        indoorAQ : null
    ]

    Map source = readings ?: [:]

    BigDecimal outdoorTemp = toBigDecimal(source.outdoorTemp)
    maintenance.outdoor = updateDailyOutdoorExtrema(outdoorTemp, timestamp, tz)

    Map outdoorAirReadings = (source.outdoorAir ?: [:]) as Map
    Map outdoorValues = [:]
    if (outdoorAirReadings.aqi != null) outdoorValues.aqi = toBigDecimal(outdoorAirReadings.aqi)
    if (outdoorAirReadings.pm25 != null) outdoorValues.pm25 = toBigDecimal(outdoorAirReadings.pm25)
    maintenance.outdoorAQ = updateDailyAQExtrema("outdoor", outdoorValues, timestamp, tz)

    Map indoorAirReadings = (source.indoorAir ?: [:]) as Map
    Map indoorValues = [:]
    if (indoorAirReadings.aqi != null) indoorValues.aqi = toBigDecimal(indoorAirReadings.aqi)
    if (indoorAirReadings.pm10 != null) indoorValues.pm10 = toBigDecimal(indoorAirReadings.pm10)
    if (indoorAirReadings.pm25 != null) indoorValues.pm25 = toBigDecimal(indoorAirReadings.pm25)
    if (indoorAirReadings.co2 != null) indoorValues.carbonDioxide = toBigDecimal(indoorAirReadings.co2)
    maintenance.indoorAQ = updateDailyAQExtrema("indoor", indoorValues, timestamp, tz)

    return maintenance
}

private Map updateTimeSeriesMaintenance(Map readings, long timestamp, TimeZone tz) {
    Map source = readings ?: [:]

    BigDecimal outdoorTemp = toBigDecimal(source.outdoorTemp)
    updateTemperatureHistory(outdoorTemp, timestamp)

    BigDecimal windSpeed = toBigDecimal(source.windSpeed)
    BigDecimal windDirection = toBigDecimal(source.windDirectionDegrees)
    updateWindHistory(windSpeed, windDirection, timestamp)

    Map relSample = (source.pressureRelative instanceof Map) ? (source.pressureRelative as Map) : [:]
    Map absSample = (source.pressureAbsolute instanceof Map) ? (source.pressureAbsolute as Map) : [:]
    BigDecimal relPressure = toBigDecimal(relSample.value)
    BigDecimal absPressure = toBigDecimal(absSample.value)
    BigDecimal referencePressure = relPressure != null ? relPressure : absPressure
    String pressureUnit = relSample.unit ?: absSample.unit ?: state.pressureBaseline?.lastUnit ?: "inHg"

    updatePressureHistory(referencePressure, timestamp)
    updatePressureBaseline(referencePressure, pressureUnit, timestamp, tz)

    return [
        referencePressure: referencePressure,
        pressureUnit     : pressureUnit
    ]
}

private String normalizeStationTimestamp(Object raw) {
    if (!(raw instanceof CharSequence)) {
        return null
    }
    String text = raw.toString().trim()
    return text ? text : null
}

private String currentLayoutOverrideText() {
    def raw = settings.layoutOverrideJson
    if (!(raw instanceof CharSequence)) {
        return null
    }
    String text = raw.toString().trim()
    return text ? text : null
}

def handleWeatherEvent(evt) {
    if (!eventTriggersEnabled()) {
        return
    }
    recordEventTriggerMetrics(evt)
    state.lastEventTriggerAt = now()
    state.eventDebounceActive = true
    // Debounce frequent events by scheduling a refresh shortly after the last update.
    runIn(2, "refreshFromEvent", [overwrite: true])
}

def refreshWeatherData() {
    long startedAt = now()
    String source = consumeRefreshSource()
    boolean suppressed = false
    boolean payloadUpdated = false
    try {
        def devices = getWeatherDevices()
        if (!devices) {
            logWarn "No weather devices configured"
            suppressed = true
            return
        }

        long timestamp = startedAt
        TimeZone tz = location?.timeZone ?: UTC_ZONE
        boolean force = state.remove('forceRefresh') == true
        String dayKey = dayKeyFor(timestamp, tz)

        Map readings = captureRawReadings() ?: [:]
        Map dailyMaintenance = updateDailyTrackerMaintenance(readings, timestamp, tz) ?: [:]
        Map timeSeriesMaintenance = updateTimeSeriesMaintenance(readings, timestamp, tz) ?: [:]
        BigDecimal maintainedReferencePressure = timeSeriesMaintenance.referencePressure
        String maintainedPressureUnit = timeSeriesMaintenance.pressureUnit
        String lastPayloadDayKey = state.lastPayloadDayKey
        boolean dayRolled = (dayKey != null && lastPayloadDayKey != null && dayKey != lastPayloadDayKey)

        String fingerprint = JsonOutput.toJson(readings)

        if (!force && !dayRolled && fingerprint && fingerprint == state.lastSourceFingerprint) {
            suppressed = true
            return
        }
        state.lastSourceFingerprint = fingerprint

    def latitude = location?.latitude
    def longitude = location?.longitude
    Date generated = new Date(timestamp)
    Map payload = [:]

    Map outdoor = [:]
    BigDecimal tempF = readings.outdoorTemp
    if (tempF != null) {
        outdoor.temperatureF = round(tempF, 1)
        outdoor.temperatureC = round(fahrenheitToCelsius(tempF), 1)
        def trend = computeTemperatureTrend()
        if (trend != null) {
            outdoor.trendFPerHour = round(trend, 2)
        }
    }

    def dailyExtrema = dailyMaintenance.outdoor
    if (dailyExtrema?.high != null) {
        outdoor.dailyHighF = dailyExtrema.high
    }
    if (dailyExtrema?.low != null) {
        outdoor.dailyLowF = dailyExtrema.low
    }

    BigDecimal feels = readings.feelsLike
    if (feels != null) {
        outdoor.feelsLikeF = round(feels, 1)
    }
    BigDecimal dew = readings.dewPoint
    if (dew != null) {
        outdoor.dewPointF = round(dew, 1)
    }
    BigDecimal humidity = readings.outdoorHumidity
    if (humidity != null) {
        outdoor.humidity = round(humidity, 1)
    }
    BigDecimal outdoorBattery = readings.outdoorBattery
    if (outdoorBattery != null) {
        outdoor.battery = outdoorBattery
    }
    if (outdoor) {
        payload.outdoor = outdoor
    }

    Map indoor = [:]
    BigDecimal indoorTemp = readings.indoorTemp
    if (indoorTemp != null) {
        indoor.temperatureF = round(indoorTemp, 1)
    }
    BigDecimal indoorHumidity = readings.indoorHumidity
    if (indoorHumidity != null) {
        indoor.humidity = round(indoorHumidity, 1)
    }
    BigDecimal indoorBattery = readings.indoorBattery
    if (indoorBattery != null) {
        indoor.battery = indoorBattery
    }
    if (indoor) {
        payload.indoor = indoor
    }

    Map wind = [:]
    BigDecimal windSpeed = readings.windSpeed
    if (windSpeed != null) {
        wind.speedMph = round(windSpeed, 1)
    }
    BigDecimal windGust = readings.windGust
    if (windGust != null) {
        wind.gustMph = round(windGust, 1)
    }
    BigDecimal windDailyMax = readings.windDailyMax
    if (windDailyMax != null) {
        wind.dailyMaxGustMph = round(windDailyMax, 1)
    }
    BigDecimal windBattery = readings.windBattery
    if (windBattery != null) {
        wind.battery = windBattery
    }

    BigDecimal directionDegrees = readings.windDirectionDegrees
    String directionText = readings.windDirectionText
    if (directionDegrees == null && directionText) {
        directionDegrees = cardinalToDegrees(directionText)
    }
    if (directionDegrees != null) {
        wind.directionDegrees = round(directionDegrees, 1)
        wind.directionCardinal = degreesToCardinal(directionDegrees as double)
    } else if (directionText) {
        wind.directionCardinal = directionText
    }

    def avgWind = computeWindAverage(timestamp)
    if (avgWind) {
        wind.averageMinutes = (settings.windAverageMinutes ?: 10) as Integer
        wind.average = avgWind
    }
    if (wind) {
        payload.wind = wind
    }

    Map pressure = [:]
    Map relSample = readings.pressureRelative ?: [:]
    Map absSample = readings.pressureAbsolute ?: [:]
    BigDecimal relPressure = relSample.value
    BigDecimal absPressure = absSample.value
    if (relPressure != null) {
        pressure.relativeInHg = round(relPressure, 2)
    }
    if (absPressure != null) {
        pressure.absoluteInHg = round(absPressure, 2)
    }
    String pressureUnit = maintainedPressureUnit ?: relSample.unit ?: absSample.unit ?: state.pressureBaseline?.lastUnit ?: "inHg"
    BigDecimal referencePressure = maintainedReferencePressure != null ? maintainedReferencePressure : (relPressure ?: absPressure)
    def trend = computePressureTrend(timestamp)
    if (trend) {
        pressure.trendInHgPerHour = round(trend.ratePerHour, 3)
        pressure.trend = trend.label
        if (trend.changeTotal != null) {
            pressure.changeInTrendWindow = round(trend.changeTotal, 3)
        }
    }
    def baseline = computePressureBaselineSummary(pressureUnit)
    if (baseline) {
        Map baselinePayload = [:]
        if (baseline.dailyAverage != null) {
            baselinePayload.dailyAverageInHg = round(baseline.dailyAverage, 3)
        }
        if (baseline.thirtyDayAverage != null) {
            baselinePayload.thirtyDayAverageInHg = round(baseline.thirtyDayAverage, 3)
        }
        if (baseline.tendencyInHg != null) {
            baselinePayload.tendencyInHg = round(baseline.tendencyInHg, 3)
        }
        if (baseline.tendencyHpa != null) {
            baselinePayload.tendencyHpa = round(baseline.tendencyHpa, 1)
        }
        if (baseline.trendText) {
            baselinePayload.trend = baseline.trendText
        }
        if (baseline.iconKey) {
            baselinePayload.iconKey = baseline.iconKey
        }
        if (baseline.iconLabel) {
            baselinePayload.iconLabel = baseline.iconLabel
        }
        if (baseline.forecastText) {
            baselinePayload.forecastText = baseline.forecastText
        }
        if (baselinePayload) {
            pressure.baseline = baselinePayload
        }
    }
    if (pressure) {
        payload.pressure = pressure
    }

    Map rain = [:]
    if (readings.rain?.rate != null) rain.rateInPerHour = round(readings.rain.rate, 2)
    if (readings.rain?.daily != null) rain.dailyIn = round(readings.rain.daily, 2)
    if (readings.rain?.event != null) rain.eventIn = round(readings.rain.event, 2)
    if (readings.rain?.hourly != null) rain.hourlyIn = round(readings.rain.hourly, 2)
    if (readings.rain?.weekly != null) rain.weeklyIn = round(readings.rain.weekly, 2)
    if (readings.rain?.monthly != null) rain.monthlyIn = round(readings.rain.monthly, 2)
    if (readings.rain?.yearly != null) rain.yearlyIn = round(readings.rain.yearly, 2)
    if (readings.rain?.battery != null) rain.battery = readings.rain.battery
    if (rain) {
        payload.rain = rain
    }

    Map solar = [:]
    BigDecimal uv = readings.solar?.uvIndex
    if (uv != null) {
        solar.uvIndex = round(uv, 1)
    }
    BigDecimal solarRad = readings.solar?.solarRadiation
    if (solarRad != null) {
        solar.solarRadiationWm2 = round(solarRad, 1)
    }
    String uvColor = readings.solar?.uvColor
    if (uvColor) {
        solar.uvColor = uvColor
    }
    String uvDanger = readings.solar?.uvDanger
    if (uvDanger) {
        solar.uvDanger = uvDanger
    }
    def sunriseDate = location?.sunrise
    if (sunriseDate) {
        solar.sunrise = formatDateTime(sunriseDate, tz)
    }
    def sunsetDate = location?.sunset
    if (sunsetDate) {
        solar.sunset = formatDateTime(sunsetDate, tz)
    }
    def moon = computeMoonPhase(generated, tz, latitude, longitude)
    if (moon) {
        solar.moon = moon
    }
    if (solar) {
        payload.solar = solar
    }

    Map outdoorAirReadings = readings.outdoorAir ?: [:]
    Map outdoorAir = [:]
    BigDecimal outdoorAqi = outdoorAirReadings.aqi
    if (outdoorAqi != null) outdoorAir.aqi = Math.round(outdoorAqi)
    BigDecimal outdoorPm25 = outdoorAirReadings.pm25
    if (outdoorPm25 != null) outdoorAir.pm25 = round(outdoorPm25, 1)

    def dailyOutdoorAQ = dailyMaintenance.outdoorAQ
    if (dailyOutdoorAQ?.aqiPeak != null) outdoorAir.aqiPeak = dailyOutdoorAQ.aqiPeak
    if (dailyOutdoorAQ?.pm25Peak != null) outdoorAir.pm25Peak = dailyOutdoorAQ.pm25Peak

    outdoorAir.aqi_avg_24h = outdoorAirReadings.aqi24h
    outdoorAir.aqiColor = outdoorAirReadings.aqiColor
    outdoorAir.aqiColor_avg_24h = outdoorAirReadings.aqiColor24h
    outdoorAir.aqiDanger = outdoorAirReadings.aqiDanger
    outdoorAir.aqiDanger_avg_24h = outdoorAirReadings.aqiDanger24h
    outdoorAir.pm25_avg_24h = outdoorAirReadings.pm25_24h
    outdoorAir.battery = outdoorAirReadings.battery
    if (outdoorAir.any { it.value != null }) {
        payload.outdoorAirQuality = outdoorAir.findAll { it.value != null }
    }

    Map indoorAirReadings = readings.indoorAir ?: [:]
    Map indoorAir = [:]
    BigDecimal indoorAqi = indoorAirReadings.aqi
    if (indoorAqi != null) indoorAir.aqi = Math.round(indoorAqi)
    BigDecimal indoorPm10 = indoorAirReadings.pm10
    if (indoorPm10 != null) indoorAir.pm10 = round(indoorPm10, 1)
    BigDecimal indoorPm25 = indoorAirReadings.pm25
    if (indoorPm25 != null) indoorAir.pm25 = round(indoorPm25, 1)
    BigDecimal indoorCo2 = indoorAirReadings.co2
    if (indoorCo2 != null) indoorAir.carbonDioxide = Math.round(indoorCo2)

    def dailyIndoorAQ = dailyMaintenance.indoorAQ
    if (dailyIndoorAQ?.aqiPeak != null) indoorAir.aqiPeak = dailyIndoorAQ.aqiPeak
    if (dailyIndoorAQ?.pm10Peak != null) indoorAir.pm10Peak = dailyIndoorAQ.pm10Peak
    if (dailyIndoorAQ?.pm25Peak != null) indoorAir.pm25Peak = dailyIndoorAQ.pm25Peak
    if (dailyIndoorAQ?.carbonDioxidePeak != null) indoorAir.carbonDioxidePeak = dailyIndoorAQ.carbonDioxidePeak

    indoorAir.aqi_avg_24h = indoorAirReadings.aqi24h
    indoorAir.aqiColor = indoorAirReadings.aqiColor
    indoorAir.aqiColor_avg_24h = indoorAirReadings.aqiColor24h
    indoorAir.aqiDanger = indoorAirReadings.aqiDanger
    indoorAir.aqiDanger_avg_24h = indoorAirReadings.aqiDanger24h
    indoorAir.carbonDioxide_avg_24h = indoorAirReadings.co2_24h
    indoorAir.pm10_avg_24h = indoorAirReadings.pm10_24h
    indoorAir.pm25_avg_24h = indoorAirReadings.pm25_24h
    indoorAir.battery = indoorAirReadings.battery
    if (indoorAir.any { it.value != null }) {
        payload.indoorAirQuality = indoorAir.findAll { it.value != null }
    }

    Map lightning = [:]
    if (readings.lightning?.count != null) lightning.count = readings.lightning.count
    if (readings.lightning?.distance != null) lightning.distance = readings.lightning.distance
    if (readings.lightning?.time) lightning.time = readings.lightning.time
    if (readings.lightning?.battery != null) lightning.battery = readings.lightning.battery
    if (lightning) {
        payload.lightning = lightning
    }

    if (!payload.outlook24h) {
        def outlook = computeOutlook(
            payload.pressure?.relativeInHg ?: payload.pressure?.absoluteInHg,
            trend,
            outdoor?.humidity,
            baseline,
            pressureUnit
        )
        if (outlook) {
            payload.outlook24h = outlook
        }
    }

    Map ambient = readings.ambient
    if (ambient?.sensors) {
        payload.ambientSensors = ambient.sensors
        if (ambient.rotationSeconds) payload.ambientRotationSeconds = ambient.rotationSeconds
        if (ambient.temperatureUnit) payload.ambientTemperatureUnit = ambient.temperatureUnit
        if (ambient.humidityUnit) payload.ambientHumidityUnit = ambient.humidityUnit
    }

    Map layoutOverride = parseLayoutOverrideSetting(readings.layoutRaw)
    payload.metadata = buildMetadata(generated, tz, readings.stationUpdatedAt, layoutOverride)

    String json = JsonOutput.toJson(payload)

    state.lastPayload = payload
    state.lastPayloadJson = json
    state.remove('lastPrettyPayload')
    state.lastPayloadDayKey = dayKey
    payloadUpdated = true

    def child = getChildDevice(childDeviceDni())
    if (child) {
        child.updateDashboardData(json)
    }
    } finally {
        recordRefreshMetrics(source, startedAt, now(), suppressed, payloadUpdated)
    }
}


private Map parseLayoutOverrideSetting(String layoutText) {
    if (!layoutText) {
        state.remove('cachedLayoutOverride')
        state.remove('cachedLayoutOverrideRaw')
        state.remove('lastLayoutOverrideError')
        return null
    }

    String cachedRaw = state.cachedLayoutOverrideRaw
    if (cachedRaw == layoutText && state.cachedLayoutOverride instanceof Map) {
        return state.cachedLayoutOverride as Map
    }

    try {
        def parsed = new JsonSlurper().parseText(layoutText)
        if (parsed instanceof Map) {
            state.cachedLayoutOverrideRaw = layoutText
            state.cachedLayoutOverride = parsed as Map
            state.remove('lastLayoutOverrideError')
            return parsed as Map
        }
        if (state.lastLayoutOverrideError != layoutText) {
            logWarn "Weather Dashboard App: Layout override JSON must be an object."
            state.lastLayoutOverrideError = layoutText
        }
    } catch (Exception ex) {
        if (state.lastLayoutOverrideError != layoutText) {
            logWarn "Weather Dashboard App: Unable to parse layout override JSON (${ex?.message ?: ex})."
            state.lastLayoutOverrideError = layoutText
        }
    }

    return null
}

private Map buildMetadata(Date generated, TimeZone tz, String stationUpdatedAt, Map layoutOverride) {
    def metadata = [
        generatedAt: generated.format("yyyy-MM-dd'T'HH:mm:ssXXX", tz)
    ]
    if (tz) {
        metadata.weatherStationTimezone = tz?.ID
    }
    if (stationUpdatedAt) {
        metadata.weatherStationTime = stationUpdatedAt
    }
    if (layoutOverride) {
        metadata.layout = layoutOverride
    }
    metadata
}

private Map buildAmbientSensorsPayload() {
    def sensors = getAmbientSensors()
    if (!sensors) return null

    def tempAttr = settings.ambientTempAttr ?: "temperature"
    def humidityAttr = settings.ambientHumidityAttr ?: "humidity"
    def batteryAttr = settings.ambientBatteryAttr ?: "battery"
    Integer rotation = settings.ambientRotationSeconds ? (settings.ambientRotationSeconds as Integer) : 12
    if (rotation < 3) {
        rotation = 3
    }
    def tempUnit = settings.ambientTemperatureUnit ?: "°F"
    def humidityUnit = settings.ambientHumidityUnit ?: "%"

    def entries = []
    sensors.each { dev ->
        def entry = [
            id  : dev.id,
            name: dev.displayName
        ]
        def tempVal = tempAttr ? readDecimal(dev, tempAttr) : null
        if (tempVal != null) {
            entry.temperatureF = round(tempVal, 1)
            entry.temperatureC = round(fahrenheitToCelsius(tempVal), 1)
        }
        def humidityVal = humidityAttr ? readDecimal(dev, humidityAttr) : null
        if (humidityVal != null) {
            entry.humidity = round(humidityVal, 1)
        }
        def batteryVal = batteryAttr ? readDecimal(dev, batteryAttr) : null
        if (batteryVal != null) {
            entry.battery = batteryVal
        }
        if (entry.temperatureF != null || entry.humidity != null || entry.battery != null) {
            entries << entry
        }
    }

    if (!entries) return null

    [
        sensors: entries,
        rotationSeconds: rotation,
        temperatureUnit: tempUnit,
        humidityUnit: humidityUnit
    ]
}

private String formatDateTime(Date date, TimeZone tz) {
    if (!date) return null
    def formatter = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX")
    formatter.setTimeZone(tz ?: TimeZone.getTimeZone('UTC'))
    formatter.format(date)
}

private void createOrUpdateChildDevice() {
    def dni = childDeviceDni()
    def existing = getChildDevice(dni)
    if (!existing) {
        try {
            existing = addChildDevice(
                "ecowitt-dashboard",
                "Weather Dashboard Device",
                dni,
                [label: settings.dashboardDeviceLabel ?: "Weather Dashboard", isComponent: false]
            )
            logInfo "Created dashboard device: ${existing?.displayName}"
        } catch (Throwable t) {
            logError "Unable to create dashboard device: ${t.message}", t
        }
    } else {
        if (settings.dashboardDeviceLabel && existing.label != settings.dashboardDeviceLabel) {
            existing.setLabel(settings.dashboardDeviceLabel)
        }
    }
}

private String childDeviceDni() {
    "weather-dashboard-${app.id}"
}

private BigDecimal readDecimal(device, String attrName) {
    if (!device || !attrName) return null
    def value = device.currentValue(attrName)
    if (value == null) return null
    return toBigDecimal(value)
}

private Map readPressureSample(device, String attrName) {
    if (!device || !attrName) {
        return [value: null, unit: null]
    }
    def eventState = device.currentState(attrName)
    if (!eventState) {
        return [value: null, unit: null]
    }
    return [value: toBigDecimal(eventState.value), unit: eventState.unit]
}

private String readString(device, String attrName) {
    if (!device || !attrName) return null
    def value = device.currentValue(attrName)
    return value != null ? value.toString() : null
}

private BigDecimal toBigDecimal(value) {
    if (value instanceof Number) {
        return value as BigDecimal
    }
    if (value instanceof String) {
        def matcher = (value =~ /-?\d+(?:\.\d+)?/)
        if (matcher.find()) {
            return matcher.group(0) as BigDecimal
        }
    }
    return null
}

private BigDecimal round(value, int scale) {
    if (value == null) return null
    return (value as BigDecimal).setScale(scale, RoundingMode.HALF_UP)
}

private BigDecimal fahrenheitToCelsius(BigDecimal tempF) {
    ((tempF - 32) * 5 / 9) as BigDecimal
}

private void updateWindHistory(BigDecimal speed, BigDecimal direction, long timestamp) {
    def minutes = (settings.windAverageMinutes ?: 10) as Integer
    def cutoff = timestamp - (minutes * 60 * 1000L)
    List history = (state.windHistory ?: []) as List
    int before = history.size()
    List filtered = history.findAll { it.time >= cutoff }
    int pruned = before - filtered.size()
    if (speed != null) {
        filtered << [time: timestamp, speed: speed as BigDecimal, direction: direction]
    }
    state.windHistory = filtered
    recordHistoryMaintenance('wind', before, filtered.size(), pruned, speed != null, timestamp)
}

private Map computeWindAverage(long timestamp) {
    def history = (state.windHistory ?: []) as List
    if (!history) return null
    def minutes = (settings.windAverageMinutes ?: 10) as Integer
    def cutoff = timestamp - (minutes * 60 * 1000L)
    def samples = history.findAll { it.time >= cutoff && it.speed != null }
    if (!samples) return null

    BigDecimal speedSum = 0
    samples.each { sample ->
        speedSum += sample.speed
    }
    def avgSpeed = speedSum / samples.size()

    BigDecimal avgDir = null
    def dirs = samples.findAll { it.direction != null }
    if (dirs) {
        double sumX = 0
        double sumY = 0
        dirs.each { sample ->
            double radians = Math.toRadians(sample.direction as double)
            sumX += Math.sin(radians) * (sample.speed as double)
            sumY += Math.cos(radians) * (sample.speed as double)
        }
        double angle = Math.atan2(sumX, sumY)
        double deg = Math.toDegrees(angle)
        if (deg < 0) deg += 360
        avgDir = deg as BigDecimal
    }

    def result = [
        speedMph: round(avgSpeed, 1),
        minutes: (settings.windAverageMinutes ?: 10) as Integer
    ]
    if (avgDir != null) {
        result.directionDegrees = round(avgDir, 1)
        result.directionCardinal = degreesToCardinal(avgDir as double)
    }
    return result
}

private void updatePressureHistory(BigDecimal pressure, long timestamp) {
    List history = (state.pressureHistory ?: []) as List
    int before = history.size()
    def cutoff = timestamp - (24 * 60 * 60 * 1000L)
    List filtered = history.findAll { it.time >= cutoff }
    int pruned = before - filtered.size()
    if (pressure != null) {
        filtered << [time: timestamp, pressure: pressure as BigDecimal]
    }
    state.pressureHistory = filtered
    recordHistoryMaintenance('pressure', before, filtered.size(), pruned, pressure != null, timestamp)
}

private void updatePressureBaseline(BigDecimal pressure, String unit, long timestamp, TimeZone tz) {
    def baseline = normalizePressureBaselineState(state.pressureBaseline)
    String dayKey = dayKeyFor(timestamp, tz)

    if (!baseline.currentDay) {
        baseline.currentDay = dayKey
        baseline.dailySum = 0.0G
        baseline.dailyCount = 0
    } else if (baseline.currentDay != dayKey) {
        finalizePressureBaselineDay(baseline)
        baseline.currentDay = dayKey
        baseline.dailySum = 0.0G
        baseline.dailyCount = 0
    }

    if (pressure != null) {
        baseline.dailySum = ((baseline.dailySum ?: 0.0G) as BigDecimal) + (pressure as BigDecimal)
        baseline.dailyCount = ((baseline.dailyCount ?: 0) as Integer) + 1
    }

    if (unit) {
        baseline.lastUnit = unit
    }
    baseline.lastUpdated = timestamp
    state.pressureBaseline = baseline
}

private void finalizePressureBaselineDay(Map baseline) {
    if (!baseline?.currentDay) return
    Integer count = (baseline.dailyCount ?: 0) as Integer
    if (!count) return
    BigDecimal sum = (baseline.dailySum ?: 0.0G) as BigDecimal
    if (sum == null) return
    BigDecimal avg = sum / count
    List history = (baseline.history instanceof List) ? baseline.history : []
    history = history.findAll { it?.day && it.day != baseline.currentDay }
    history << [day: baseline.currentDay, avg: avg]
    history.sort { it.day }
    baseline.history = history
    enforcePressureBaselineLimit(baseline)
}

private void enforcePressureBaselineLimit(Map baseline) {
    List history = (baseline?.history instanceof List) ? baseline.history : []
    Integer keep = (settings.pressureBaselineDays ?: 30) as Integer
    if (keep > 0 && history.size() > keep) {
        history = history.sort { it.day }.takeRight(keep)
        baseline.history = history
    }
}

private Map computePressureBaselineSummary(String unit) {
    def baseline = normalizePressureBaselineState(state.pressureBaseline)
    enforcePressureBaselineLimit(baseline)

    List history = (baseline.history instanceof List) ? baseline.history : []
    history = history.sort { it.day }

    BigDecimal dailyAverage = null
    Integer count = (baseline.dailyCount ?: 0) as Integer
    if (count && baseline.dailySum != null) {
        BigDecimal sum = (baseline.dailySum as BigDecimal)
        if (sum != null && count > 0) {
            dailyAverage = sum / count
        }
    }
    if (dailyAverage == null && history) {
        def last = history.last()
        dailyAverage = toBigDecimal(last?.avg)
    }

    List<BigDecimal> values = history.collect { toBigDecimal(it?.avg) }.findAll { it != null }
    BigDecimal thirtyDayAverage = null
    if (values) {
        BigDecimal sum = values.inject(0.0G) { acc, val -> acc + val }
        thirtyDayAverage = sum / values.size()
    } else {
        thirtyDayAverage = dailyAverage
    }

    BigDecimal tendency = null
    if (dailyAverage != null && thirtyDayAverage != null) {
        tendency = dailyAverage - thirtyDayAverage
    }

    BigDecimal tendencyHpa = convertPressureToHpa(tendency, unit ?: baseline.lastUnit)
    def forecast = determineBaselineForecast(tendencyHpa)

    boolean hasSamples = (count ?: 0) > 0 || (values && !values.isEmpty())
    if (!hasSamples && dailyAverage == null && thirtyDayAverage == null) {
        state.pressureBaseline = baseline
        return null
    }

    Map result = [
        dailyAverage      : dailyAverage,
        thirtyDayAverage  : thirtyDayAverage,
        tendencyInHg      : tendency,
        tendencyHpa       : tendencyHpa,
        trendText         : forecast.trendText,
        iconKey           : forecast.key,
        iconLabel         : forecast.label,
        forecastText      : forecast.text
    ]

    if (values) {
        result.historyDays = values.size()
    }

    state.pressureBaseline = baseline
    return result.findAll { it.value != null }
}

private Map determineBaselineForecast(BigDecimal tendencyHpa) {
    BigDecimal value = tendencyHpa != null ? tendencyHpa : 0.0G
    String trendText
    if (value > 1.0G) {
        trendText = "Rising"
    } else if (value < -1.0G) {
        trendText = "Falling"
    } else {
        trendText = "Steady"
    }

    String key
    String label
    String text

    if (value >= 3.0G) {
        key = "sunny"
        label = "Sunny"
        text = "Pressure well above normal — clearing skies likely."
    } else if (value >= 1.0G) {
        key = "partly"
        label = "Partly Cloudy"
        text = "Pressure rising versus recent days — improving trend."
    } else if (value > -1.0G) {
        key = "cloudy"
        label = "Cloudy"
        text = "Pressure near seasonal baseline — conditions steady."
    } else if (value > -3.0G) {
        key = "rainy"
        label = "Rain"
        text = "Pressure below normal — showers possible."
    } else {
        key = "stormy"
        label = "Stormy"
        text = "Pressure far below normal — storms increasingly likely."
    }

    [key: key, label: label, text: text, trendText: trendText]
}

private String buildTrendNarrative(Map trend) {
    if (!trend) return null
    String label = trend.label
    if (!label) return null
    switch (label) {
        case "Rising Rapidly":
            return "Pressure rising rapidly now."
        case "Rising":
            return "Pressure rising steadily."
        case "Falling Rapidly":
            return "Pressure falling rapidly now."
        case "Falling":
            return "Pressure falling steadily."
        default:
            return null
    }
}

private String buildHumidityNote(BigDecimal humidity) {
    if (humidity == null) return null
    if (humidity >= 85) {
        return "High humidity could support fog or drizzle."
    }
    if (humidity <= 35) {
        return "Dry air may keep skies clear."
    }
    return null
}

private String truncateSummary(String text, int maxLength) {
    if (text == null) return null
    String trimmed = text.trim()
    if (!trimmed) return null
    if (maxLength <= 0 || trimmed.length() <= maxLength) {
        return trimmed
    }
    int end = Math.max(0, maxLength - 1)
    String shortened = trimmed.substring(0, end).trim()
    return shortened ? shortened + '…' : trimmed.substring(0, maxLength)
}

private Map computePressureTrend(long timestamp) {
    def history = (state.pressureHistory ?: []) as List
    if (!history) return null
    def pressureEntry = history.last()
    if (!pressureEntry) return null
    BigDecimal current = pressureEntry.pressure
    if (current == null) return null

    def hours = (settings.pressureTrendHours ?: 3) as Integer
    def cutoff = timestamp - (hours * 60 * 60 * 1000L)
    def comparison = history.find { it.time >= cutoff }
    if (!comparison) {
        comparison = history.first()
    }
    if (!comparison || comparison.pressure == null) return null

    def elapsedHours = ((pressureEntry.time - comparison.time) / 3600000.0)
    if (elapsedHours <= 0) elapsedHours = hours
    def change = current - comparison.pressure
    def rate = change / elapsedHours

    String label
    if (rate >= 0.03) {
        label = "Rising Rapidly"
    } else if (rate >= 0.01) {
        label = "Rising"
    } else if (rate <= -0.03) {
        label = "Falling Rapidly"
    } else if (rate <= -0.01) {
        label = "Falling"
    } else {
        label = "Steady"
    }

    [
        ratePerHour: rate,
        changeTotal: change,
        label: label
    ]
}

private Map computeOutlook(BigDecimal pressure, Map trend, BigDecimal humidity, Map baseline, String unit) {
    Map baselineInfo = baseline ?: computePressureBaselineSummary(unit)
    String trendNarrative = buildTrendNarrative(trend)
    String humidityNote = buildHumidityNote(humidity)

    String baselineNarrative = baselineInfo?.forecastText
    String summary = [trendNarrative, baselineNarrative, humidityNote].findAll { it }
        .join(' ')

    if (!summary) {
        if (pressure != null) {
            if (pressure >= 30.2) {
                summary = "High pressure dominant — fair skies expected."
            } else if (pressure <= 29.5) {
                summary = "Low pressure system — clouds or rain possible."
            }
        }
    }

    if (!summary) {
        summary = "Little pressure change — current conditions likely to persist."
    }

    String shortSummary
    String trendLabel = trend?.label
    if (trendLabel && trendLabel != 'Steady') {
        shortSummary = trendLabel
        if (baselineInfo?.iconLabel) {
            shortSummary = "${shortSummary} • ${baselineInfo.iconLabel}"
        }
    } else if (baselineInfo?.iconLabel) {
        shortSummary = baselineInfo.iconLabel
    }

    if (humidityNote && !shortSummary) {
        shortSummary = humidityNote
    }

    shortSummary = truncateSummary(shortSummary ?: summary, 40)

    Map baselinePayload = [:]
    if (baselineInfo?.dailyAverage != null) {
        baselinePayload.dailyAverageInHg = round(baselineInfo.dailyAverage, 3)
    }
    if (baselineInfo?.thirtyDayAverage != null) {
        baselinePayload.thirtyDayAverageInHg = round(baselineInfo.thirtyDayAverage, 3)
    }
    if (baselineInfo?.tendencyInHg != null) {
        baselinePayload.tendencyInHg = round(baselineInfo.tendencyInHg, 3)
    }
    if (baselineInfo?.tendencyHpa != null) {
        baselinePayload.tendencyHpa = round(baselineInfo.tendencyHpa, 1)
    }
    if (baselineInfo?.trendText) {
        baselinePayload.trend = baselineInfo.trendText
    }
    if (baselineInfo?.iconKey) {
        baselinePayload.iconKey = baselineInfo.iconKey
    }
    if (baselineInfo?.iconLabel) {
        baselinePayload.iconLabel = baselineInfo.iconLabel
    }
    if (baselineInfo?.forecastText) {
        baselinePayload.forecastText = baselineInfo.forecastText
    }

    def category = baselineInfo?.iconLabel ?: (trendLabel ?: 'Stable')

    Map result = [
        category    : category,
        summary     : summary,
        shortSummary: shortSummary,
        iconKey     : baselineInfo?.iconKey,
        iconLabel   : baselineInfo?.iconLabel,
        trendLabel  : trendLabel,
        humidityNote: humidityNote
    ]

    if (baselinePayload) {
        result.baseline = baselinePayload
    }

    return result.findAll { it.value != null }
}

private Map computeMoonPhase(Date reference, TimeZone tz, BigDecimal latitude, BigDecimal longitude) {
    if (!reference) return null

    final long millisPerDay = 86_400_000L
    final double twoPi = Math.PI * 2D
    final double synodicMonthDays = 29.530588853D

    TimeZone zone = tz ?: UTC_ZONE
    long millis = reference.time
    long utcMillis = millis - zone.getOffset(millis)

    Calendar cal = Calendar.getInstance(UTC_ZONE)
    cal.set(Calendar.YEAR, 2000)
    cal.set(Calendar.MONTH, Calendar.JANUARY)
    cal.set(Calendar.DAY_OF_MONTH, 6)
    cal.set(Calendar.HOUR_OF_DAY, 18)
    cal.set(Calendar.MINUTE, 14)
    cal.set(Calendar.SECOND, 0)
    cal.set(Calendar.MILLISECOND, 0)
    long knownNewMoonMs = cal.timeInMillis

    double daysSince = (utcMillis - knownNewMoonMs) / (double) millisPerDay
    if (!Double.isFinite(daysSince)) return null

    double phaseDays = daysSince % synodicMonthDays
    if (phaseDays < 0) {
        phaseDays += synodicMonthDays
    }

    double phaseFraction = phaseDays / synodicMonthDays
    double illumination = 0.5D * (1 - Math.cos(twoPi * phaseFraction))
    double phaseAngle = (phaseFraction * 360.0D) % 360.0D
    if (phaseAngle < 0) {
        phaseAngle += 360.0D
    }

    boolean waxing = phaseFraction < 0.5D

    List phaseBounds = [
        [limit: 1.84566D, key: 'new-moon', name: 'New Moon'],
        [limit: 5.53699D, key: 'waxing-crescent', name: 'Waxing Crescent'],
        [limit: 9.22831D, key: 'first-quarter', name: 'First Quarter'],
        [limit: 12.91963D, key: 'waxing-gibbous', name: 'Waxing Gibbous'],
        [limit: 16.61096D, key: 'full-moon', name: 'Full Moon'],
        [limit: 20.30228D, key: 'waning-gibbous', name: 'Waning Gibbous'],
        [limit: 23.99361D, key: 'last-quarter', name: 'Last Quarter'],
        [limit: 27.68493D, key: 'waning-crescent', name: 'Waning Crescent'],
        [limit: synodicMonthDays + 0.0001D, key: 'new-moon', name: 'New Moon']
    ]

    def phaseDef = phaseBounds.find { phaseDays < (it.limit as double) }
    if (!phaseDef) {
        phaseDef = phaseBounds[phaseBounds.size() - 1]
    }

    def result = [
        phase              : phaseDef.name,
        phaseKey           : phaseDef.key,
        ageDays            : round(phaseDays, 2),
        illuminationFraction: round(illumination, 4),
        illuminationPercent: round(illumination * 100.0D, 1),
        phaseAngle         : round(phaseAngle, 2),
        waxing             : waxing
    ]

    if (latitude != null) {
        BigDecimal lat = latitude as BigDecimal
        result.hemisphere = lat < 0 ? 'southern' : 'northern'
    }

    return result
}

private void updateTemperatureHistory(BigDecimal temperature, long timestamp) {
    List history = (state.temperatureHistory ?: []) as List
    int before = history.size()
    def cutoff = timestamp - (6 * 60 * 60 * 1000L)
    List filtered = history.findAll { it.time >= cutoff }
    int pruned = before - filtered.size()
    if (temperature != null) {
        filtered << [time: timestamp, temperature: temperature as BigDecimal]
    }
    state.temperatureHistory = filtered
    recordHistoryMaintenance('temperature', before, filtered.size(), pruned, temperature != null, timestamp)
}

private Map updateDailyOutdoorExtrema(BigDecimal temperature, long timestamp, TimeZone tz) {
    def record = (state.dailyOutdoorTemp ?: [:]) as Map
    def dayKey = dayKeyFor(timestamp, tz)
    if (!record.day || record.day != dayKey) {
        record = [day: dayKey, high: null, low: null]
    }
    if (temperature != null) {
        def rounded = round(temperature, 1)
        if (record.high == null || rounded > record.high) {
            record.high = rounded
        }
        if (record.low == null || rounded < record.low) {
            record.low = rounded
        }
    }
    record.updatedAt = timestamp
    state.dailyOutdoorTemp = record
    record
}

private Map updateDailyAQExtrema(String type, Map<String, BigDecimal> values, long timestamp, TimeZone tz) {
    def stateKey = (type == "indoor") ? "dailyIndoorAQ" : "dailyOutdoorAQ"
    def record = (state[stateKey] ?: [:]) as Map
    def dayKey = dayKeyFor(timestamp, tz)

    if (!record.day || record.day != dayKey) {
        record = [day: dayKey]
    }

    values.each { key, value ->
        if (value != null) {
            def peakKey = "${key}Peak"
            def rounded = (key == "aqi" || key == "carbonDioxide") ? Math.round(value) : round(value, 1)
            if (record[peakKey] == null || rounded > record[peakKey]) {
                record[peakKey] = rounded
            }
        }
    }

    record.updatedAt = timestamp
    state[stateKey] = record
    return record
}

private String dayKeyFor(long timestamp, TimeZone tz) {
    def formatter = new SimpleDateFormat("yyyy-MM-dd")
    formatter.setTimeZone(tz ?: TimeZone.getTimeZone('UTC'))
    formatter.format(new Date(timestamp))
}

private BigDecimal computeTemperatureTrend() {
    def history = (state.temperatureHistory ?: []) as List
    if (!history || history.size() < 2) return null
    def latest = history.last()
    def hourAgo = history.find { it.time <= (latest.time - 60 * 60 * 1000L) }
    if (!hourAgo) return null
    def delta = latest.temperature - hourAgo.temperature
    def hours = (latest.time - hourAgo.time) / 3600000.0
    if (hours <= 0) return null
    (delta / hours) as BigDecimal
}

private String degreesToCardinal(double deg) {
    def dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
    int index = Math.round(((deg % 360) / 22.5) as float) % dirs.size()
    dirs[index]
}

private BigDecimal cardinalToDegrees(String cardinal) {
    if (!cardinal) return null
    def lookup = [
        N: 0, NNE: 22.5, NE: 45, ENE: 67.5,
        E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
        S: 180, SSW: 202.5, SW: 225, WSW: 247.5,
        W: 270, WNW: 292.5, NW: 315, NNW: 337.5
    ]
    def key = cardinal.trim().toUpperCase()
    return lookup[key]
}

private static BigDecimal convertPressureToHpa(BigDecimal value, String unit) {
    if (value == null) return null
    switch ((unit ?: "inHg").toLowerCase()) {
        case "inhg":
            return value * 33.8638866667G
        case "mmhg":
            return value * 1.3332239G
        case "kpa":
            return value * 10.0G
        case "mbar":
        case "mb":
        case "hpa":
            return value
        default:
            return value
    }
}

private String htmlEncode(String value) {
    if (!value) return ''
    value.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
}

def diagnosticsPage() {
    state.forceRefresh = true
    enqueueRefreshSource('diagnostics')
    refreshWeatherData()
    dynamicPage(name: "diagnosticsPage", title: "Diagnostics", install: false, uninstall: false) {
        section("Performance metrics") {
            String refreshHtml = renderRefreshMetricsHtml()
            String eventHtml = renderEventMetricsHtml()
            String historyHtml = renderHistoryMetricsHtml()

            if (!refreshHtml && !eventHtml && !historyHtml) {
                paragraph "Metrics will appear after the dashboard processes refresh activity."
            } else {
                if (refreshHtml) {
                    paragraph "<b>Refresh performance</b>"
                    paragraph refreshHtml
                }
                if (eventHtml) {
                    paragraph "<b>Event trigger pressure</b>"
                    paragraph eventHtml
                }
                if (historyHtml) {
                    paragraph "<b>History maintenance</b>"
                    paragraph historyHtml
                }
            }
        }
        section("Latest Payload") {
            def json = state.lastPayloadJson
            if (json) {
                String pretty
                try {
                    pretty = JsonOutput.prettyPrint(json)
                } catch (Exception ex) {
                    pretty = json
                }
                paragraph "<pre style='white-space:pre-wrap;font-family:monospace;'>${htmlEncode(pretty)}</pre>"
            } else {
                paragraph "No payload generated yet. Please save settings and refresh."
            }
        }
    }
}
