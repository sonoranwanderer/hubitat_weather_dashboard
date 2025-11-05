/*
 * WeatherDashboardApp.groovy
 *
 * Aggregates Hubitat weather device data, computes derived statistics, and publishes
 * a JSON payload for consumption by the Weather Dashboard driver/JS tile.
 */

import groovy.json.JsonOutput
import groovy.json.JsonSlurper
import groovy.transform.Field
import java.io.StringWriter
import java.math.RoundingMode
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.TimeZone
import java.net.URLEncoder

definition(
    name: "Weather Dashboard App",
    namespace: "ecowitt-dashboard",
    author: "Gatewood Green",
    description: "Aggregates weather data for the JavaScript dashboard tile.",
    category: "Convenience",
    importUrl: "https://raw.githubusercontent.com/sonoranwanderer/ecowitt_weather_hubitat_dashboard/main/hubitat/WeatherDashboardApp.groovy",
    iconUrl: "https://raw.githubusercontent.com/sonoranwanderer/ecowitt_weather_hubitat_dashboard/main/assets/weather-dashboard-icon.svg",
    iconX2Url: "https://raw.githubusercontent.com/sonoranwanderer/ecowitt_weather_hubitat_dashboard/main/assets/weather-dashboard-icon.svg",
    oauth: true
)

@Field final TimeZone UTC_ZONE = TimeZone.getTimeZone('UTC')
@Field final Map<String, Integer> LOG_LEVEL_ORDER = [
    error: 0,
    warn : 1,
    info : 2,
    debug: 3,
    trace: 4
]
@Field final int MAKER_PAYLOAD_MAX_BYTES = 100000

preferences {
    page(name: "landingPage", title: "Weather Dashboard", install: true, uninstall: true)
    page(name: "configurationPage")
    page(name: "diagnosticsPage")
}

mappings {
    path("/dashboard") {
        action: [
            GET: "handleDashboardRequest"
        ]
    }
}

def landingPage() {
    dynamicPage(name: "landingPage") {
        section("Dashboard preview") {
            String embedUrl = buildDashboardEmbedUrl()
            if (embedUrl) {
                String encodedSrc = htmlAttributeEncode(embedUrl)
                paragraph "<iframe src=\"${encodedSrc}\" style=\"width: 100%; height: 820px; border: 0;\" sandbox=\"allow-same-origin allow-scripts allow-forms allow-popups\"></iframe>"
                paragraph 'Tip: If the preview shows Hubitat\'s 404 page, upload <code>weather-dashboard-app.html</code> and <code>weather-dashboard-app.js</code> to Hubitat\'s File Manager so they are served from <code>/local/</code>.'
            } else {
                Map makerStatus = makerApiAppInfo()
                if (!makerStatus?.installed) {
                    paragraph "Install the built-in Maker API app (Apps → Add Built-In App → Maker API) and authorize Weather Dashboard App to enable the embedded dashboard preview."
                } else if (!makerApiSettingsConfigured()) {
                    paragraph "Configure the Maker API connection on the setup page to enable the embedded dashboard preview."
                } else {
                    paragraph "The embedded dashboard preview is temporarily unavailable. Confirm the Maker API token and hub address are still valid."
                }
            }
        }

        section("Quick actions") {
            href "configurationPage", title: "Configure data sources", description: "Select devices, units, and Maker API access."
            href "diagnosticsPage", title: "Diagnostics", description: "Inspect the latest payload JSON and refresh metrics."
        }
    }
}

def configurationPage() {
    dynamicPage(name: "configurationPage") {
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

        section("Temperature units") {
            paragraph "Tell the app which unit your weather devices report and choose the dashboard's default display."
            input name: "temperatureInputUnit", type: "enum", title: "Weather device temperature unit", options: temperatureUnitOptions(), defaultValue: "F", required: true, submitOnChange: true, width: 6
            input name: "temperatureDisplayUnit", type: "enum", title: "Default dashboard temperature unit", options: temperatureUnitOptions(), defaultValue: "F", required: true, submitOnChange: true, width: 6
        }

        section("Rainfall units") {
            paragraph "Tell the app which unit your rain sensors report and choose the dashboard's default display."
            input name: "rainInputUnit", type: "enum", title: "Weather device rain depth unit", options: rainUnitOptions(), defaultValue: "in", required: true, submitOnChange: true, width: 6
            input name: "rainDisplayUnit", type: "enum", title: "Default dashboard rain depth unit", options: rainUnitOptions(), defaultValue: "in", required: true, submitOnChange: true, width: 6
        }

        section("Wind speed units") {
            paragraph "Tell the app which unit your weather devices report for wind and choose the dashboard's default display."
            input name: "windInputUnit", type: "enum", title: "Weather device wind speed unit", options: windUnitOptions(), defaultValue: "mph", required: true, submitOnChange: true, width: 6
            input name: "windDisplayUnit", type: "enum", title: "Default dashboard wind speed unit", options: windUnitOptions(), defaultValue: "mph", required: true, submitOnChange: true, width: 6
        }

        section("Pressure units") {
            paragraph "Tell the app which unit your barometer reports and choose the dashboard's default display."
            input name: "pressureInputUnit", type: "enum", title: "Weather device pressure unit", options: pressureUnitOptions(), defaultValue: "inhg", required: true, submitOnChange: true, width: 6
            input name: "pressureDisplayUnit", type: "enum", title: "Default dashboard pressure unit", options: pressureUnitOptions(), defaultValue: "inhg", required: true, submitOnChange: true, width: 6
        }

        section("Lightning distance units") {
            paragraph "Tell the app which unit your lightning sensor reports and choose the dashboard's default display."
            input name: "lightningInputUnit", type: "enum", title: "Weather device lightning distance unit", options: lightningUnitOptions(), defaultValue: "mi", required: true, submitOnChange: true, width: 6
            input name: "lightningDisplayUnit", type: "enum", title: "Default dashboard lightning distance unit", options: lightningUnitOptions(), defaultValue: "mi", required: true, submitOnChange: true, width: 6
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

        section("Maker API access") {
            Map makerStatus = makerApiAppInfo()
            if (!makerStatus?.installed) {
                paragraph "Maker API app not detected. Install it via Apps → Add Built-In App → Maker API, then enable local access and select the Weather Dashboard virtual device under “Select devices.”"
            } else {
                String makerLabel = makerStatus?.label ? makerStatus.label.toString() : 'Maker API'
                paragraph "Maker API app detected (${makerLabel}). Open the Maker API configuration to copy the access token and confirm the Weather Dashboard virtual device remains selected under “Select devices.”"
            }

            if (!makerApiSettingsConfigured()) {
                paragraph "Leaving the fields below blank keeps the embedded preview disabled so the hub avoids any Maker API polling overhead until you are ready."
            } else {
                paragraph "The embedded dashboard preview and external bundle will use the saved hub address and token. Update them whenever you rotate the Maker API credentials."
            }

            paragraph "Provide the hub connection details used by the embedded dashboard preview and external clients. See docs/setup-maker-api.md for the full Maker API walkthrough, including which options to enable."
            input name: "makerApiBaseUrl", type: "text", title: "Hubitat hub base URL", required: false, submitOnChange: true, description: "Example: http://192.168.1.10"
            input name: "makerApiToken", type: "text", title: "Maker API token", required: false, submitOnChange: true
            input name: "makerApiDeviceIds", type: "text", title: "Maker API device IDs", required: false, submitOnChange: true, description: "Comma-separated (optional)"
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

private String buildDashboardEmbedUrl() {
    String baseUrl = settings?.makerApiBaseUrl?.trim()
    String token = settings?.makerApiToken?.trim()
    String appId = app?.id?.toString()
    String dashboardToken = ensureDashboardAccessToken()

    if (!baseUrl || !token || !appId || !dashboardToken) {
        return null
    }

    Map<String, String> params = [
        hubBaseUrl : baseUrl,
        hub        : baseUrl,
        appId      : appId,
        makerToken : token,
        makerApiToken: token,
        token      : token,
        appToken   : dashboardToken,
        previewToken: dashboardToken,
        access_token: dashboardToken
    ]

    List<String> deviceIds = makerApiDeviceIdList()
    if (deviceIds) {
        String joined = deviceIds.join(',')
        params.deviceIds = joined
        params.devices = joined
    }

    String query = params.collect { key, value -> "${urlEncode(key)}=${urlEncode(value)}" }.join('&')
    return "/local/weather-dashboard-app.html?${query}"
}

private List<String> makerApiDeviceIdList() {
    String raw = settings?.makerApiDeviceIds
    if (!raw) {
        return []
    }

    return raw
        .toString()
        .split(/[\s,]+/)
        .collect { it?.trim() }
        .findAll { it }
}

private boolean makerApiSettingsConfigured() {
    String baseUrl = settings?.makerApiBaseUrl?.trim()
    String token = settings?.makerApiToken?.trim()
    return baseUrl && token
}

private String ensureDashboardAccessToken() {
    String token = state?.dashboardAccessToken
    if (token instanceof CharSequence && token.toString()) {
        return token.toString()
    }

    try {
        String generated = createAccessToken()
        if (generated) {
            state.dashboardAccessToken = generated
            logInfo "Generated Weather Dashboard App access token"
            return generated
        }
    } catch (Exception ex) {
        logError "Unable to create Weather Dashboard App access token: ${ex?.message ?: ex}", ex
    }

    return null
}

private String dashboardAccessTokenSetting() {
    def raw = state?.dashboardAccessToken
    if (!(raw instanceof CharSequence)) {
        return null
    }
    String text = raw.toString().trim()
    return text ? text : null
}

private String extractDashboardAccessToken() {
    def raw = params?.access_token ?: params?.appToken ?: params?.previewToken ?: params?.dashboardToken
    if (!(raw instanceof CharSequence)) {
        return null
    }
    String text = raw.toString().trim()
    return text ? text : null
}

private Map makerApiAppInfo() {
    def loc = location
    Map status = [installed: false, locationAvailable: loc != null]
    if (!loc) {
        return status
    }

    List<Object> candidates = []
    candidates.addAll(makerApiMatchesFromMethod(loc, 'getAppsByName', ['Maker API'] as Object[]))
    candidates.addAll(makerApiMatchesFromMethod(loc, 'findInstalledAppByName', ['Maker API'] as Object[]))
    candidates.addAll(makerApiMatchesFromMethod(loc, 'getInstalledAppByName', ['Maker API'] as Object[]))

    if (candidates.isEmpty()) {
        candidates.addAll(makerApiMatchesFromProperty(loc, 'apps'))
        candidates.addAll(makerApiMatchesFromProperty(loc, 'installedApps'))
        candidates.addAll(makerApiMatchesFromProperty(loc, 'appList'))
        candidates.addAll(makerApiMatchesFromProperty(loc, 'smartApps'))
        candidates.addAll(makerApiMatchesFromProperty(loc, 'childApps'))
    }

    Object found = candidates.find { makerApiDescriptorMatches(it) }
    if (found) {
        status.installed = true
        status.label = makerApiDescriptorLabel(found)
        status.namespace = makerApiDescriptorNamespace(found)
    }

    return status
}

private List<Object> makerApiMatchesFromMethod(Object loc, String methodName, Object[] args) {
    if (!loc) {
        return []
    }

    try {
        def value = loc."${methodName}"(*args)
        return makerApiNormalizeCollection(value)
    } catch (MissingMethodException ignored) {
    } catch (Throwable ignored) {
    }
    return []
}

private List<Object> makerApiMatchesFromProperty(Object loc, String propertyName) {
    if (!loc) {
        return []
    }

    try {
        def value = loc."${propertyName}"
        return makerApiNormalizeCollection(value)
    } catch (MissingPropertyException ignored) {
    } catch (Throwable ignored) {
    }
    return []
}

private List<Object> makerApiNormalizeCollection(Object value) {
    if (value == null) {
        return []
    }
    if (value instanceof Collection) {
        return value.findAll { it != null } as List<Object>
    }
    return [value]
}

private boolean makerApiDescriptorMatches(Object descriptor) {
    if (descriptor == null) {
        return false
    }
    String name = makerApiDescriptorLabel(descriptor)?.toLowerCase()
    String typeName = descriptor?.typeName?.toString()?.toLowerCase()
    String namespace = makerApiDescriptorNamespace(descriptor)?.toLowerCase()

    boolean nameMatch = name?.contains('maker api') || (name?.contains('maker') && name?.contains('api'))
    boolean typeMatch = typeName?.contains('maker') && typeName?.contains('api')
    boolean namespaceMatch = namespace?.contains('maker') && (name?.contains('api') || typeName?.contains('api'))

    return nameMatch || typeMatch || namespaceMatch
}

private String makerApiDescriptorLabel(Object descriptor) {
    def options = [
        descriptor?.label,
        descriptor?.name,
        descriptor?.appName,
        descriptor?.displayName,
        descriptor?.typeName,
        descriptor?.type?.name
    ]
    String label = options.find { it }?.toString()
    return label ?: 'Maker API'
}

private String makerApiDescriptorNamespace(Object descriptor) {
    def options = [
        descriptor?.namespace,
        descriptor?.appNamespace,
        descriptor?.type?.namespace
    ]
    return options.find { it }?.toString()
}

private String htmlAttributeEncode(String value) {
    if (value == null) {
        return ''
    }

    value
        .replace('&', '&amp;')
        .replace('"', '&quot;')
        .replace("'", '&#39;')
        .replace('<', '&lt;')
        .replace('>', '&gt;')
}

private String urlEncode(String value) {
    URLEncoder.encode(value ?: '', 'UTF-8')
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

private Map temperatureUnitOptions() {
    [
        'F': 'Fahrenheit (°F)',
        'C': 'Celsius (°C)'
    ]
}

private Map rainUnitOptions() {
    [
        'in': 'Inch (in)',
        'mm': 'Millimeter (mm)'
    ]
}

private Map windUnitOptions() {
    [
        'mph': 'Miles per hour (mph)',
        'kph': 'Kilometers per hour (kph)',
        'kts': 'Knots (kts)'
    ]
}

private Map pressureUnitOptions() {
    [
        'inhg': 'Inches of mercury (inHg)',
        'mb'  : 'Millibars (mb)'
    ]
}

private Map lightningUnitOptions() {
    [
        'mi': 'Miles (mi)',
        'km': 'Kilometers (km)'
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

    String details = message ?: 'Error'
    if (t) {
        String throwableSummary = t?.message ?: t?.toString()
        if (throwableSummary) {
            details = "${details}: ${throwableSummary}"
        }
    }

    log.error details

    if (t && shouldLogLevel('debug')) {
        String stackTrace = formatStackTrace(t)
        if (stackTrace) {
            log.debug stackTrace
        }
    }
}

private String formatStackTrace(Throwable t) {
    if (!t) {
        return null
    }

    def elements = t.stackTrace
    if (!elements) {
        return t.toString()
    }

    StringWriter sw = new StringWriter()
    sw.append(t.toString()).append('\n')
    elements.each { element ->
        sw.append('\t').append('at ').append(String.valueOf(element)).append('\n')
    }
    Throwable cause = t.cause
    if (cause && cause != t) {
        String causeTrace = formatStackTrace(cause)
        if (causeTrace) {
            sw.append('Caused by: ').append(causeTrace)
        }
    }
    return sw.toString()
}

private void renderJsonError(int statusCode, String message) {
    Map body = [error: message ?: 'Unknown error']
    render status: statusCode, contentType: 'application/json', data: JsonOutput.toJson(body)
}

private String makerTokenSetting() {
    def raw = settings?.makerApiToken
    if (!(raw instanceof CharSequence)) {
        return null
    }
    String text = raw.toString().trim()
    return text ? text : null
}

private String extractMakerToken() {
    def raw = params?.makerToken ?: params?.makerApiToken ?: params?.token ?: params?.accessToken
    if (!(raw instanceof CharSequence)) {
        return null
    }
    String text = raw.toString().trim()
    return text ? text : null
}

private boolean tokensMatch(String provided, String expected) {
    if (!provided || !expected) {
        return false
    }
    byte[] providedBytes = provided.getBytes('UTF-8')
    byte[] expectedBytes = expected.getBytes('UTF-8')
    int diff = providedBytes.length ^ expectedBytes.length
    int length = Math.min(providedBytes.length, expectedBytes.length)
    for (int i = 0; i < length; i++) {
        diff |= (providedBytes[i] ^ expectedBytes[i])
    }
    for (int i = length; i < providedBytes.length; i++) {
        diff |= (providedBytes[i] ^ 0)
    }
    for (int i = length; i < expectedBytes.length; i++) {
        diff |= (expectedBytes[i] ^ 0)
    }
    return diff == 0
}

private Map currentPayloadSnapshot() {
    def snapshot = state.payloadSnapshot
    if (snapshot instanceof Map) {
        return new LinkedHashMap(snapshot as Map)
    }
    return [:]
}

private void recordPayloadSnapshotHeartbeat(String source) {
    Map snapshot = currentPayloadSnapshot()
    if (!snapshot) {
        return
    }
    snapshot.lastCheckedAt = now()
    snapshot.lastCheckedSource = source ?: 'unknown'
    state.payloadSnapshot = snapshot
}

private void markPayloadSnapshotServed(Map snapshot, String source) {
    if (!(snapshot instanceof Map)) {
        return
    }
    Map updated = new LinkedHashMap(snapshot)
    updated.lastServedAt = now()
    updated.lastServedBy = source ?: 'unknown'
    state.payloadSnapshot = updated
}

private void updatePayloadSnapshot(Map payload, String json, long generatedAt, String source) {
    Map snapshot = currentPayloadSnapshot()
    snapshot.generatedAt = generatedAt
    snapshot.refreshedAt = now()
    snapshot.source = source ?: 'unknown'
    snapshot.sections = (payload instanceof Map) ? (payload.keySet().collect { it?.toString() }.findAll { it }) : []
    int bytes = json ? json.getBytes('UTF-8').length : 0
    snapshot.bytes = bytes
    if (bytes > MAKER_PAYLOAD_MAX_BYTES) {
        snapshot.withinLimit = false
        snapshot.error = "Payload size ${bytes} bytes exceeds limit of ${MAKER_PAYLOAD_MAX_BYTES} bytes."
        snapshot.remove('json')
        state.payloadSnapshot = snapshot
        logWarn "Weather Dashboard App payload snapshot ${bytes} bytes exceeds Maker endpoint limit ${MAKER_PAYLOAD_MAX_BYTES}. Snapshot withheld."
        return
    }
    snapshot.withinLimit = true
    snapshot.remove('error')
    snapshot.json = json
    state.payloadSnapshot = snapshot
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

private String renderForecastDiagnosticsHtml() {
    Map diag = state.forecastDiagnostics ?: [:]
    if (!diag) {
        return null
    }

    StringBuilder html = new StringBuilder()
    String generated = diag.generatedAt ? formatTimestamp(diag.generatedAt as Long) : 'n/a'
    html << "<b>Last forecast update:</b> ${htmlEncode(generated)}"

    if (diag.category) {
        html << "<br/><b>Category:</b> ${htmlEncode(diag.category.toString())}"
    }
    if (diag.summary) {
        html << "<br/><b>Summary:</b> ${htmlEncode(diag.summary.toString())}"
    }
    if (diag.shortSummary && diag.shortSummary != diag.summary) {
        html << "<br/><b>Dashboard summary:</b> ${htmlEncode(diag.shortSummary.toString())}"
    }

    Map history = (diag.history ?: [:]) as Map
    List<String> historyLines = []
    Integer recordedDays = history.historyDays != null ? (history.historyDays as Integer) : null
    Integer requiredDays = history.requiredHistoryDays != null ? (history.requiredHistoryDays as Integer) : null
    String coverage = history.historyCoveragePercent != null ? "${formatDecimal(history.historyCoveragePercent)}%" : null
    Boolean ready = history.historyReady != null ? (history.historyReady as Boolean) : null

    if (recordedDays != null || requiredDays != null) {
        StringBuilder line = new StringBuilder('Baseline days collected: ')
        line << (recordedDays != null ? recordedDays : 0)
        if (requiredDays != null) {
            line << " of ${requiredDays} required"
        }
        if (coverage) {
            line << " (${coverage})"
        }
        if (ready != null) {
            line << (ready ? ' — ready' : ' — still building')
        }
        historyLines << line.toString()
    }
    if (history.samplesToday != null) {
        historyLines << "Samples today: ${history.samplesToday}"
    }
    if (history.lastUpdated) {
        historyLines << "Last baseline sample: ${formatTimestamp(history.lastUpdated as Long)}"
    }
    if (history.currentDayKey) {
        historyLines << "Current baseline day key: ${history.currentDayKey}"
    }

    if (historyLines) {
        html << '<br/><br/><b>Baseline accumulation</b>'
        html << htmlList(historyLines)
    }

    Map baseline = (diag.baseline ?: [:]) as Map
    List<String> baselineLines = []
    if (baseline.dailyAverageInHg != null) {
        baselineLines << "Today's mean pressure: ${formatDecimal(baseline.dailyAverageInHg)} inHg"
    }
    if (baseline.thirtyDayAverageInHg != null) {
        baselineLines << "30-day mean pressure: ${formatDecimal(baseline.thirtyDayAverageInHg)} inHg"
    }
    if (baseline.tendencyInHg != null) {
        String tendency = formatDecimal(baseline.tendencyInHg)
        if (baseline.tendencyHpa != null) {
            tendency = "${tendency} (${formatDecimal(baseline.tendencyHpa)} hPa)"
        }
        baselineLines << "Tendency vs 30-day mean: ${tendency}"
    }
    if (baseline.trendText) {
        baselineLines << "Baseline trend: ${baseline.trendText}"
    }
    if (baseline.iconLabel) {
        String iconDescriptor = baseline.iconKey ? "${baseline.iconLabel} (${baseline.iconKey})" : baseline.iconLabel
        baselineLines << "Baseline icon: ${iconDescriptor}"
    }
    if (baseline.forecastText) {
        baselineLines << baseline.forecastText.toString()
    }

    if (baselineLines) {
        html << '<br/><br/><b>Baseline comparison</b>'
        html << htmlList(baselineLines)
    }

    Map inputs = (diag.inputs ?: [:]) as Map
    List<String> inputLines = []
    String pressureUnitLabel = inputs.pressureUnit ?: 'inHg'
    if (inputs.pressure != null) {
        inputLines << "Latest pressure sample: ${formatDecimal(inputs.pressure)} ${pressureUnitLabel}"
    }
    if (inputs.humidity != null) {
        inputLines << "Humidity considered: ${formatDecimal(inputs.humidity)}%"
    }
    Map trendInput = (inputs.trend ?: [:]) as Map
    if (trendInput) {
        StringBuilder trendLine = new StringBuilder('Short-term trend analysis: ')
        trendLine << (trendInput.label ?: 'n/a')
        if (trendInput.ratePerHour != null) {
            trendLine << " (${formatDecimal(trendInput.ratePerHour)} ${pressureUnitLabel}/hr)"
        }
        if (trendInput.changeTotal != null) {
            trendLine << "; change ${formatDecimal(trendInput.changeTotal)} ${pressureUnitLabel}"
        }
        inputLines << trendLine.toString()
    }

    if (inputLines) {
        html << '<br/><br/><b>Inputs analyzed</b>'
        html << htmlList(inputLines)
    }

    List<String> components = (diag.summaryComponents instanceof List) ? (diag.summaryComponents.findAll { it } as List<String>) : []
    if (components) {
        html << '<br/><br/><b>Summary components</b>'
        html << htmlList(components.collect { it.toString() })
    }

    List<String> reasons = (diag.reasoning instanceof List) ? (diag.reasoning.findAll { it } as List<String>) : []
    if (reasons) {
        html << '<br/><br/><b>Why this outlook?</b>'
        html << htmlList(reasons.collect { it.toString() })
    }

    return html.toString()
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
    ensureDashboardAccessToken()
    initialize()
}

def updated() {
    logInfo "Updating Weather Dashboard App"
    unschedule()
    unsubscribe()
    ensureDashboardAccessToken()
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
    String tempUnit = temperatureInputUnitSetting()
    boolean inputIsCelsius = tempUnit == 'C'

    readings.outdoorTemp = convertInputTemperature(readDecimalFor("attrOutdoorTemp"), inputIsCelsius)
    readings.feelsLike = convertInputTemperature(readDecimalFor("attrFeelsLike"), inputIsCelsius)
    readings.dewPoint = convertInputTemperature(readDecimalFor("attrDewPoint"), inputIsCelsius)
    readings.outdoorHumidity = readDecimalFor("attrOutdoorHumidity")
    readings.outdoorBattery = readDecimalFor("attrOutdoorBattery")

    readings.indoorTemp = convertInputTemperature(readDecimalFor("attrIndoorTemp"), inputIsCelsius)
    readings.indoorHumidity = readDecimalFor("attrIndoorHumidity")
    readings.indoorBattery = readDecimalFor("attrIndoorBattery")

    String windInputUnit = windInputUnitSetting()
    readings.windSpeed = convertInputWindSpeed(readDecimalFor("attrWindSpeed"), windInputUnit)
    readings.windGust = convertInputWindSpeed(readDecimalFor("attrWindGust"), windInputUnit)
    readings.windDailyMax = convertInputWindSpeed(readDecimalFor("attrWindGustMaxDaily"), windInputUnit)
    readings.windBattery = readDecimalFor("attrBatteryWind")
    readings.windDirectionDegrees = readDecimalFor("attrWindDirectionDegrees")
    readings.windDirectionText = readStringFor("attrWindDirection")

    String pressureInputUnit = pressureInputUnitSetting()
    readings.pressureRelative = normalizePressureSample(readPressureSample("attrPressure"), pressureInputUnit)
    readings.pressureAbsolute = normalizePressureSample(readPressureSample("attrAbsolutePressure"), pressureInputUnit)

    boolean rainInputIsMillimeters = rainInputUnitSetting() == 'mm'
    readings.rain = [
        rate   : convertInputRainDepth(readDecimalFor("attrRainRate"), rainInputIsMillimeters),
        daily  : convertInputRainDepth(readDecimalFor("attrRainDaily"), rainInputIsMillimeters),
        event  : convertInputRainDepth(readDecimalFor("attrRainEvent"), rainInputIsMillimeters),
        hourly : convertInputRainDepth(readDecimalFor("attrRainHourly"), rainInputIsMillimeters),
        weekly : convertInputRainDepth(readDecimalFor("attrRainWeekly"), rainInputIsMillimeters),
        monthly: convertInputRainDepth(readDecimalFor("attrRainMonthly"), rainInputIsMillimeters),
        yearly : convertInputRainDepth(readDecimalFor("attrRainYearly"), rainInputIsMillimeters),
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

    String lightningInputUnit = lightningInputUnitSetting()
    readings.lightning = [
        count  : readDecimalFor("attrLightningCount"),
        distance: convertInputLightningDistance(readDecimalFor("attrLightningDistance"), lightningInputUnit),
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
            recordPayloadSnapshotHeartbeat(source)
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
            recordPayloadSnapshotHeartbeat(source)
            return
        }
        state.lastSourceFingerprint = fingerprint

    def latitude = location?.latitude
    def longitude = location?.longitude
    Date generated = new Date(timestamp)
    Map payload = [:]
    String temperatureDisplayUnit = temperatureDisplayUnitSetting()

    Map outdoor = [:]
    BigDecimal tempF = readings.outdoorTemp
    if (tempF != null) {
        outdoor.temperature = convertTemperatureForDisplay(tempF, temperatureDisplayUnit)
        def trend = computeTemperatureTrend()
        if (trend != null) {
            outdoor.trendPerHour = convertTemperatureDeltaForDisplay(trend, temperatureDisplayUnit)
        }
    }

    def dailyExtrema = dailyMaintenance.outdoor
    if (dailyExtrema?.high != null) {
        outdoor.dailyHigh = convertTemperatureForDisplay(dailyExtrema.high, temperatureDisplayUnit)
    }
    if (dailyExtrema?.low != null) {
        outdoor.dailyLow = convertTemperatureForDisplay(dailyExtrema.low, temperatureDisplayUnit)
    }

    BigDecimal feels = readings.feelsLike
    if (feels != null) {
        outdoor.feelsLike = convertTemperatureForDisplay(feels, temperatureDisplayUnit)
    }
    BigDecimal dew = readings.dewPoint
    if (dew != null) {
        outdoor.dewPoint = convertTemperatureForDisplay(dew, temperatureDisplayUnit)
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
        indoor.temperature = convertTemperatureForDisplay(indoorTemp, temperatureDisplayUnit)
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
    if (readings.lightning?.distance != null) {
        BigDecimal miles = round(readings.lightning.distance, 1)
        lightning.distanceMi = miles
        lightning.distance = miles
        lightning.distanceKm = round(milesToKilometers(readings.lightning.distance), 1)
    }
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
        if (ambient.humidityUnit) payload.ambientHumidityUnit = ambient.humidityUnit
    }

    Map layoutOverride = parseLayoutOverrideSetting(readings.layoutRaw)
    payload.metadata = buildMetadata(generated, tz, readings.stationUpdatedAt, layoutOverride)

    String json = JsonOutput.toJson(payload)

    state.lastPayload = payload
    state.lastPayloadJson = json
    state.remove('lastPrettyPayload')
    state.lastPayloadDayKey = dayKey
    updatePayloadSnapshot(payload, json, timestamp, source)
    payloadUpdated = true

    def child = getChildDevice(childDeviceDni())
    if (child) {
        child.updateDashboardData(json)
    }
    } finally {
        recordRefreshMetrics(source, startedAt, now(), suppressed, payloadUpdated)
    }
}


def handleDashboardRequest() {
    String dashboardToken = dashboardAccessTokenSetting()
    if (!dashboardToken) {
        dashboardToken = ensureDashboardAccessToken()
    }

    if (!dashboardToken) {
        logWarn "Weather Dashboard App Maker endpoint denied access: dashboard access token unavailable"
        renderJsonError(503, 'Dashboard access unavailable.')
        return
    }

    String providedDashboardToken = extractDashboardAccessToken()
    if (!providedDashboardToken) {
        logWarn "Weather Dashboard App Maker endpoint denied access: dashboard token missing"
        renderJsonError(401, 'Dashboard token missing.')
        return
    }

    if (!tokensMatch(providedDashboardToken, dashboardToken)) {
        logWarn "Weather Dashboard App Maker endpoint denied access: dashboard token invalid"
        renderJsonError(401, 'Dashboard token invalid.')
        return
    }

    if (!makerApiSettingsConfigured()) {
        logWarn "Weather Dashboard App Maker endpoint denied access: Maker API not configured"
        renderJsonError(503, 'Maker API token not configured.')
        return
    }

    String configuredMakerToken = makerTokenSetting()
    if (configuredMakerToken) {
        String providedMakerToken = extractMakerToken()
        if (!providedMakerToken) {
            logWarn "Weather Dashboard App Maker endpoint denied access: Maker token missing"
            renderJsonError(401, 'Maker token missing.')
            return
        }

        if (!tokensMatch(providedMakerToken, configuredMakerToken)) {
            logWarn "Weather Dashboard App Maker endpoint denied access: Maker token invalid"
            renderJsonError(401, 'Maker token invalid.')
            return
        }
    }

    Map snapshot = currentPayloadSnapshot()
    String json = snapshot.json
    if (!json || snapshot.withinLimit == false) {
        logWarn "Weather Dashboard App Maker endpoint payload unavailable"
        renderJsonError(503, 'Dashboard payload unavailable.')
        return
    }

    markPayloadSnapshotServed(snapshot, 'maker-endpoint')
    render contentType: 'application/json', data: json
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
    String temperatureDisplay = temperatureDisplayUnitSetting()
    if (temperatureDisplay) {
        metadata.temperatureDisplayUnit = temperatureDisplay
    }

    String rainDisplay = rainDisplayUnitSetting()
    if (rainDisplay) {
        metadata.rainDisplayUnit = rainDisplay
    }

    String windDisplay = windDisplayUnitSetting()
    if (windDisplay) {
        metadata.windDisplayUnit = windDisplay
    }

    String pressureDisplay = pressureDisplayUnitSetting()
    if (pressureDisplay) {
        metadata.pressureDisplayUnit = pressureDisplay
    }

    String lightningDisplay = lightningDisplayUnitSetting()
    if (lightningDisplay) {
        metadata.lightningDisplayUnit = lightningDisplay
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
    def humidityUnit = settings.ambientHumidityUnit ?: "%"
    boolean inputIsCelsius = temperatureInputUnitSetting() == 'C'
    String displayUnit = temperatureDisplayUnitSetting()

    def entries = []
    sensors.each { dev ->
        def entry = [
            id  : dev.id,
            name: dev.displayName
        ]
        def tempVal = tempAttr ? readDecimal(dev, tempAttr) : null
        def convertedTemp = convertInputTemperature(tempVal, inputIsCelsius)
        if (convertedTemp != null) {
            entry.temperature = convertTemperatureForDisplay(convertedTemp, displayUnit)
        }
        def humidityVal = humidityAttr ? readDecimal(dev, humidityAttr) : null
        if (humidityVal != null) {
            entry.humidity = round(humidityVal, 1)
        }
        def batteryVal = batteryAttr ? readDecimal(dev, batteryAttr) : null
        if (batteryVal != null) {
            entry.battery = batteryVal
        }
        if (entry.temperature != null || entry.humidity != null || entry.battery != null) {
            entries << entry
        }
    }

    if (!entries) return null

    [
        sensors: entries,
        rotationSeconds: rotation,
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

private String formatDecimal(value) {
    BigDecimal decimal = toBigDecimal(value)
    if (decimal == null) return null
    return decimal.stripTrailingZeros().toPlainString()
}

private BigDecimal fahrenheitToCelsius(BigDecimal tempF) {
    ((tempF - 32) * 5 / 9) as BigDecimal
}

private BigDecimal celsiusToFahrenheit(BigDecimal tempC) {
    ((tempC * 9 / 5) + 32) as BigDecimal
}

private BigDecimal convertInputTemperature(BigDecimal value, boolean inputIsCelsius) {
    if (value == null) return null
    inputIsCelsius ? celsiusToFahrenheit(value) : value
}

private BigDecimal convertTemperatureForDisplay(BigDecimal tempF, String displayUnit) {
    if (tempF == null) return null
    String unit = normalizeTemperatureUnitSetting(displayUnit) ?: 'F'
    BigDecimal converted = (unit == 'C') ? fahrenheitToCelsius(tempF) : tempF
    return round(converted, 1)
}

private BigDecimal convertTemperatureDeltaForDisplay(BigDecimal deltaF, String displayUnit) {
    if (deltaF == null) return null
    String unit = normalizeTemperatureUnitSetting(displayUnit) ?: 'F'
    BigDecimal converted = (unit == 'C') ? fahrenheitDeltaToCelsius(deltaF) : deltaF
    return round(converted, 2)
}

private BigDecimal fahrenheitDeltaToCelsius(BigDecimal deltaF) {
    if (deltaF == null) return null
    (deltaF * 5 / 9) as BigDecimal
}

private String temperatureInputUnitSetting() {
    normalizeTemperatureUnitSetting(settings.temperatureInputUnit) ?: 'F'
}

private String temperatureDisplayUnitSetting() {
    normalizeTemperatureUnitSetting(settings.temperatureDisplayUnit) ?: 'F'
}

private String normalizeTemperatureUnitSetting(Object raw) {
    if (!(raw instanceof CharSequence)) {
        return null
    }
    String value = raw.toString().trim().toUpperCase()
    return (value == 'F' || value == 'C') ? value : null
}

private BigDecimal millimetersToInches(BigDecimal value) {
    if (value == null) return null
    (value / 25.4G) as BigDecimal
}

private BigDecimal convertInputRainDepth(BigDecimal value, boolean inputIsMillimeters) {
    if (value == null) return null
    inputIsMillimeters ? millimetersToInches(value) : value
}

private BigDecimal convertInputWindSpeed(BigDecimal value, String inputUnit) {
    if (value == null) return null
    String normalized = normalizeWindUnitSetting(inputUnit) ?: 'mph'
    switch (normalized) {
        case 'kph':
            return kphToMph(value)
        case 'kts':
            return knotsToMph(value)
        default:
            return value
    }
}

private String rainInputUnitSetting() {
    normalizeRainUnitSetting(settings.rainInputUnit) ?: 'in'
}

private String rainDisplayUnitSetting() {
    normalizeRainUnitSetting(settings.rainDisplayUnit) ?: 'in'
}

private String normalizeRainUnitSetting(Object raw) {
    if (!(raw instanceof CharSequence)) {
        return null
    }
    String value = raw.toString().trim().toLowerCase()
    if (!value) return null
    if (['in', 'inch', 'inches'].contains(value)) return 'in'
    if (['mm', 'millimeter', 'millimeters'].contains(value)) return 'mm'
    return null
}

private String windInputUnitSetting() {
    normalizeWindUnitSetting(settings.windInputUnit) ?: 'mph'
}

private String windDisplayUnitSetting() {
    normalizeWindUnitSetting(settings.windDisplayUnit) ?: 'mph'
}

private String normalizeWindUnitSetting(Object raw) {
    if (!(raw instanceof CharSequence)) {
        return null
    }
    String value = raw.toString().trim().toLowerCase()
    if (!value) return null
    if (['mph', 'mi', 'miles', 'milesperhour', 'mileperhour'].contains(value)) return 'mph'
    if (['kph', 'kmh', 'kmph', 'km', 'kilometer', 'kilometers', 'kilometersperhour', 'kilometerperhour'].contains(value)) return 'kph'
    if (['kts', 'kt', 'kn', 'knot', 'knots'].contains(value)) return 'kts'
    return null
}

private String pressureInputUnitSetting() {
    normalizePressureUnitSetting(settings.pressureInputUnit) ?: 'inhg'
}

private String pressureDisplayUnitSetting() {
    normalizePressureUnitSetting(settings.pressureDisplayUnit) ?: 'inhg'
}

private String normalizePressureUnitSetting(Object raw) {
    if (!(raw instanceof CharSequence)) {
        return null
    }
    String value = raw.toString().trim().toLowerCase()
    if (!value) return null
    if (['inhg', 'in', 'hg', 'inch', 'inches'].contains(value)) return 'inhg'
    if (['mb', 'mbar', 'millibar', 'millibars', 'hpa', 'hectopascal', 'hectopascals'].contains(value)) return 'mb'
    return null
}

private String normalizePressureSensorUnit(Object raw) {
    if (!(raw instanceof CharSequence)) {
        return null
    }
    String value = raw.toString().trim().toLowerCase()
    if (!value) return null
    if (['inhg', 'in', 'hg', 'inch', 'inches'].contains(value)) return 'inhg'
    if (['mb', 'mbar', 'millibar', 'millibars', 'hpa', 'hectopascal', 'hectopascals'].contains(value)) return 'mb'
    if (['kpa', 'kilopascal', 'kilopascals'].contains(value)) return 'kpa'
    if (['mmhg', 'mm'].contains(value)) return 'mmhg'
    return null
}

private BigDecimal convertPressureToInHg(BigDecimal value, String unit) {
    if (value == null) return null
    String normalized = (unit ?: 'inhg').toString().trim().toLowerCase()
    switch (normalized) {
        case 'inhg':
        case 'in':
        case 'hg':
        case 'inch':
        case 'inches':
            return value
        case 'mb':
        case 'mbar':
        case 'millibar':
        case 'millibars':
        case 'hpa':
        case 'hectopascal':
        case 'hectopascals':
            return value / 33.8638866667G
        case 'kpa':
        case 'kilopascal':
        case 'kilopascals':
            return value / 3.3863886667G
        case 'mmhg':
        case 'mm':
            return value / 25.4G
        default:
            return value
    }
}

private Map normalizePressureSample(Map sample, String configuredUnit) {
    Map raw = (sample instanceof Map) ? sample : [:]
    BigDecimal value = toBigDecimal(raw.value)
    String rawUnit = raw.unit
    String sensorUnit = normalizePressureSensorUnit(rawUnit)
    String fallbackUnit = normalizePressureUnitSetting(configuredUnit) ?: 'inhg'
    BigDecimal converted = convertPressureToInHg(value, sensorUnit ?: fallbackUnit)
    return [value: converted, unit: 'inHg']
}

private BigDecimal kphToMph(BigDecimal value) {
    if (value == null) return null
    (value / 1.609344G) as BigDecimal
}

private BigDecimal knotsToMph(BigDecimal value) {
    if (value == null) return null
    (value * 1.150779448023542G) as BigDecimal
}

private String lightningInputUnitSetting() {
    normalizeLightningUnitSetting(settings.lightningInputUnit) ?: 'mi'
}

private String lightningDisplayUnitSetting() {
    normalizeLightningUnitSetting(settings.lightningDisplayUnit) ?: 'mi'
}

private String normalizeLightningUnitSetting(Object raw) {
    if (!(raw instanceof CharSequence)) {
        return null
    }
    String value = raw.toString().trim().toLowerCase()
    if (!value) return null
    if (['mi', 'mile', 'miles'].contains(value)) return 'mi'
    if (['km', 'kilometer', 'kilometers'].contains(value)) return 'km'
    return null
}

private BigDecimal convertInputLightningDistance(BigDecimal value, String inputUnit) {
    if (value == null) return null
    String normalized = normalizeLightningUnitSetting(inputUnit) ?: 'mi'
    switch (normalized) {
        case 'km':
            return kilometersToMiles(value)
        default:
            return value
    }
}

private BigDecimal kilometersToMiles(BigDecimal value) {
    if (value == null) return null
    (value / 1.609344G) as BigDecimal
}

private BigDecimal milesToKilometers(BigDecimal value) {
    if (value == null) return null
    (value * 1.609344G) as BigDecimal
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

private Map pressureBaselineHistoryStats(Map baseline) {
    Map normalized = baseline ?: normalizePressureBaselineState(state.pressureBaseline)
    List history = (normalized.history instanceof List) ? normalized.history : []
    Integer recordedDays = history.size()
    Integer requiredDays = (settings.pressureBaselineDays ?: 30) as Integer

    Map stats = [
        historyDays        : recordedDays,
        requiredHistoryDays: requiredDays,
        samplesToday       : (normalized.dailyCount ?: 0) as Integer,
        lastUpdated        : normalized.lastUpdated,
        currentDayKey      : normalized.currentDay
    ]

    if (requiredDays && requiredDays > 0) {
        BigDecimal ratio = (recordedDays as BigDecimal) / (requiredDays as BigDecimal)
        stats.historyCoveragePercent = round(ratio * 100.0G, 1)
        stats.historyReady = recordedDays >= requiredDays
    }

    return stats
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

    Map historyStats = pressureBaselineHistoryStats(baseline)
    result.putAll(historyStats.findAll { it.value != null })

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
    Map historyStats = pressureBaselineHistoryStats(null)
    Map history = historyStats ? (historyStats.findAll { it.value != null } as Map) : [:]

    BigDecimal roundedPressure = pressure != null ? round(pressure, 3) : null
    BigDecimal roundedHumidity = humidity != null ? round(humidity, 1) : null
    String pressureUnit = unit ?: 'inHg'

    Map diagnostics = [
        generatedAt: now(),
        inputs     : [:],
        history    : history ?: [:],
        reasoning  : []
    ]

    diagnostics.inputs.pressureUnit = pressureUnit
    if (roundedPressure != null) {
        diagnostics.inputs.pressure = roundedPressure
    }
    if (roundedHumidity != null) {
        diagnostics.inputs.humidity = roundedHumidity
    }

    Map trendInputs = [:]
    if (trend?.label) trendInputs.label = trend.label
    if (trend?.ratePerHour != null) trendInputs.ratePerHour = round(trend.ratePerHour, 3)
    if (trend?.changeTotal != null) trendInputs.changeTotal = round(trend.changeTotal, 3)
    if (trendInputs) {
        diagnostics.inputs.trend = trendInputs
    }

    Map baselineDetails = [:]
    if (baselineInfo?.dailyAverage != null) baselineDetails.dailyAverageInHg = round(baselineInfo.dailyAverage, 3)
    if (baselineInfo?.thirtyDayAverage != null) baselineDetails.thirtyDayAverageInHg = round(baselineInfo.thirtyDayAverage, 3)
    if (baselineInfo?.tendencyInHg != null) baselineDetails.tendencyInHg = round(baselineInfo.tendencyInHg, 3)
    if (baselineInfo?.tendencyHpa != null) baselineDetails.tendencyHpa = round(baselineInfo.tendencyHpa, 1)
    if (baselineInfo?.trendText) baselineDetails.trendText = baselineInfo.trendText
    if (baselineInfo?.forecastText) baselineDetails.forecastText = baselineInfo.forecastText
    if (baselineInfo?.iconKey) baselineDetails.iconKey = baselineInfo.iconKey
    if (baselineInfo?.iconLabel) baselineDetails.iconLabel = baselineInfo.iconLabel
    if (baselineDetails) {
        diagnostics.baseline = baselineDetails
    }

    String trendNarrative = buildTrendNarrative(trend)
    String humidityNote = buildHumidityNote(humidity)
    String baselineNarrative = baselineInfo?.forecastText

    List<String> summaryPieces = []
    List<String> reasoning = []

    if (trendNarrative) {
        summaryPieces << trendNarrative
        StringBuilder reason = new StringBuilder('Short-term pressure trend')
        if (trend?.label) {
            reason << " (${trend.label})"
        }
        reason << ": ${trendNarrative}"
        if (trendInputs.ratePerHour != null) {
            reason << " — rate ${formatDecimal(trendInputs.ratePerHour)} ${pressureUnit}/hr"
        }
        if (trendInputs.changeTotal != null) {
            Integer hours = (settings.pressureTrendHours ?: 3) as Integer
            reason << " over ~${hours} h (${formatDecimal(trendInputs.changeTotal)} ${pressureUnit} change)"
        }
        reasoning << reason.toString()
    } else if (trendInputs) {
        StringBuilder reason = new StringBuilder("Short-term pressure trend measured as ${trendInputs.label ?: 'Steady'}")
        if (trendInputs.ratePerHour != null) {
            reason << " (${formatDecimal(trendInputs.ratePerHour)} ${pressureUnit}/hr)"
        }
        reasoning << reason.toString()
    } else {
        reasoning << 'No short-term pressure trend was available for this cycle.'
    }

    if (baselineInfo) {
        if (baselineNarrative) {
            summaryPieces << baselineNarrative
        }
        StringBuilder baselineReason = new StringBuilder('Baseline pressure history')
        if (baselineInfo?.trendText) {
            baselineReason << " indicates ${baselineInfo.trendText.toLowerCase()}"
        }
        List<String> comparisons = []
        if (baselineDetails.dailyAverageInHg != null && baselineDetails.thirtyDayAverageInHg != null) {
            comparisons << "today ${formatDecimal(baselineDetails.dailyAverageInHg)} vs 30-day ${formatDecimal(baselineDetails.thirtyDayAverageInHg)} ${pressureUnit}"
        }
        if (baselineDetails.tendencyInHg != null) {
            String tendency = formatDecimal(baselineDetails.tendencyInHg)
            if (baselineDetails.tendencyHpa != null) {
                tendency = "${tendency} (${formatDecimal(baselineDetails.tendencyHpa)} hPa)"
            }
            comparisons << "tendency ${tendency}"
        }
        if (comparisons) {
            baselineReason << " — ${comparisons.join(', ')}"
        }
        if (baselineNarrative) {
            baselineReason << ". ${baselineNarrative}"
        } else if (!comparisons && !baselineInfo?.trendText) {
            baselineReason << ' available but no forecast narrative yet.'
        }
        reasoning << baselineReason.toString()
    } else if (history) {
        Integer recordedDays = history.historyDays as Integer
        Integer requiredDays = history.requiredHistoryDays as Integer
        if (recordedDays != null && requiredDays != null) {
            reasoning << "Pressure baseline still building: ${recordedDays} of ${requiredDays} days collected."
        } else {
            reasoning << 'Pressure baseline not yet available for diagnostics.'
        }
    }

    if (humidityNote) {
        summaryPieces << humidityNote
        reasoning << "Humidity at ${formatDecimal(roundedHumidity)}% triggered heuristic: ${humidityNote}"
    } else if (roundedHumidity != null) {
        reasoning << "Humidity input (${formatDecimal(roundedHumidity)}%) did not trigger an adjustment."
    }

    List<String> combinedPieces = summaryPieces.findAll { it }
    String summary = combinedPieces ? combinedPieces.join(' ') : null
    List<String> summaryComponents = combinedPieces ? combinedPieces.collect { it } : []
    String fallbackReason = null

    if (!summary) {
        if (roundedPressure != null) {
            if (roundedPressure >= 30.2G) {
                summary = 'High pressure dominant — fair skies expected.'
                summaryComponents = [summary]
                fallbackReason = "Used absolute pressure fallback because ${formatDecimal(roundedPressure)} ${pressureUnit} ≥ 30.2 ${pressureUnit}."
            } else if (roundedPressure <= 29.5G) {
                summary = 'Low pressure system — clouds or rain possible.'
                summaryComponents = [summary]
                fallbackReason = "Used absolute pressure fallback because ${formatDecimal(roundedPressure)} ${pressureUnit} ≤ 29.5 ${pressureUnit}."
            }
        }
    }
    if (!summary) {
        summary = 'Little pressure change — current conditions likely to persist.'
        if (!summaryComponents) {
            summaryComponents = [summary]
        }
        if (!fallbackReason) {
            fallbackReason = 'Defaulted to steady-conditions message because no other signals were available.'
        }
    }
    if (fallbackReason) {
        reasoning << fallbackReason
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

    diagnostics.category = category
    diagnostics.summary = summary
    diagnostics.shortSummary = shortSummary
    diagnostics.iconKey = baselineInfo?.iconKey
    diagnostics.iconLabel = baselineInfo?.iconLabel
    diagnostics.trendLabel = trendLabel
    diagnostics.humidityNote = humidityNote
    diagnostics.baselineNarrative = baselineNarrative
    diagnostics.summaryComponents = summaryComponents
    diagnostics.reasoning = reasoning.findAll { it }
    diagnostics.fallbackReason = fallbackReason

    state.forecastDiagnostics = diagnostics

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
        section("Forecast diagnostics") {
            String forecastHtml = renderForecastDiagnosticsHtml()
            if (forecastHtml) {
                paragraph forecastHtml
            } else {
                paragraph "Forecast diagnostics will appear after the app generates an outlook."
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
