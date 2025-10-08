/*
 * WeatherDashboardDevice.groovy
 *
 * Virtual device that exposes aggregated dashboard payloads via attributes for use
 * by Hubitat dashboards and external integrations.
 */

definition(
    name: "Weather Dashboard Device",
    namespace: "ecowitt-dashboard",
    author: "OpenAI",
    importUrl: "https://raw.githubusercontent.com/<owner>/ecowitt_weather_hubitat_dashboard/main/hubitat/WeatherDashboardDevice.groovy"
) {
    capability "Sensor"
    capability "Refresh"

    attribute "dashboardData", "string"
    attribute "dashboardPretty", "string"
    attribute "dashboardUpdated", "string"

    command "updateDashboardData", [[name: "Dashboard JSON", type: "STRING", description: "JSON payload for dashboard rendering"],
                                     [name: "Pretty JSON", type: "STRING", description: "Optional formatted payload"]]
    command "clearDashboardData"
}

preferences {
    input name: "enableDebug", type: "bool", title: "Enable debug logging", defaultValue: false
}

def installed() {
    log.info "Weather Dashboard Device installed"
    initialize()
}

def updated() {
    log.info "Weather Dashboard Device updated"
    initialize()
}

def initialize() {
    if (enableDebug) runIn(1800, "logsOff")
}

def logsOff() {
    log.warn "Disabling debug logging"
    device.updateSetting("enableDebug", [value: "false", type: "bool"])
}

def refresh() {
    if (enableDebug) log.debug "Refresh requested — no action (data pushed from app)"
}

def clearDashboardData() {
    if (enableDebug) log.debug "Clearing dashboard attributes"
    sendEvent(name: "dashboardData", value: "{}", isStateChange: true)
    sendEvent(name: "dashboardPretty", value: "{}", isStateChange: true)
    sendEvent(name: "dashboardUpdated", value: timestamp(), isStateChange: true)
}

def updateDashboardData(String json, String pretty = null) {
    if (enableDebug) log.debug "Updating dashboard payload (${json?.size() ?: 0} chars)"
    if (json) {
        sendEvent(name: "dashboardData", value: json, isStateChange: true)
    }
    if (pretty) {
        sendEvent(name: "dashboardPretty", value: pretty, isStateChange: true)
    }
    sendEvent(name: "dashboardUpdated", value: timestamp(), isStateChange: true)
}

private String timestamp() {
    def tz = location?.timeZone ?: TimeZone.getTimeZone('UTC')
    return new Date().format("yyyy-MM-dd'T'HH:mm:ssXXX", tz)
}
