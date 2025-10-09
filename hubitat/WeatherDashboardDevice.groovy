/*
 * WeatherDashboardDevice.groovy
 *
 * Virtual device that exposes aggregated dashboard payloads via attributes for use
 * by Hubitat dashboards and external integrations.
 */

import groovy.json.JsonOutput
import groovy.transform.Field

definition(
    name: "Weather Dashboard Device",
    namespace: "ecowitt-dashboard",
    author: "Gatewood Green",
    importUrl: "https://raw.githubusercontent.com/sonoranwanderer/ecowitt_weather_hubitat_dashboard/main/hubitat/WeatherDashboardDevice.groovy"
) {
    capability "Sensor"
    capability "Refresh"

    attribute "dashboardData", "string"
    attribute "dashboardPretty", "string"
    attribute "dashboardUpdated", "string"
    attribute "dashboardDataChunk2", "string"
    attribute "dashboardDataChunk3", "string"

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
    sendEvent(name: "dashboardDataChunk2", value: "{}", isStateChange: true)
    sendEvent(name: "dashboardDataChunk3", value: "{}", isStateChange: true)
    sendEvent(name: "dashboardPretty", value: "{}", isStateChange: true)
    sendEvent(name: "dashboardUpdated", value: timestamp(), isStateChange: true)
}

def updateDashboardData(String json, String pretty = null) {
    if (!json) {
        if (enableDebug) log.debug "Received empty dashboard payload"
        clearDashboardData()
        return
    }

    def chunks = chunkPayload(json)
    if (enableDebug) {
        log.debug "Updating dashboard payload (${json.size()} chars -> ${chunks.size()} attribute${chunks.size() == 1 ? '' : 's'})"
    }

    chunks.eachWithIndex { chunk, index ->
        def attr = chunkAttribute(index)
        sendEvent(name: attr, value: chunk, isStateChange: true)
    }

    clearUnusedChunkAttributes(chunks.size())

    if (pretty && pretty.size() <= MAX_EVENT_VALUE_LENGTH) {
        sendEvent(name: "dashboardPretty", value: pretty, isStateChange: true)
    } else if (pretty) {
        def placeholder = JsonOutput.toJson([message: "Pretty payload omitted (length ${pretty.size()} exceeds limit)"])
        sendEvent(name: "dashboardPretty", value: placeholder, isStateChange: true)
    }

    sendEvent(name: "dashboardUpdated", value: timestamp(), isStateChange: true)
}

private String timestamp() {
    def tz = location?.timeZone ?: TimeZone.getTimeZone('UTC')
    return new Date().format("yyyy-MM-dd'T'HH:mm:ssXXX", tz)
}

@Field static final Integer MAX_EVENT_VALUE_LENGTH = 1024
@Field static final Integer MAX_PAYLOAD_CHUNKS = 3
@Field static final Integer CHUNK_OVERHEAD = 120

private List<String> chunkPayload(String json) {
    if (!json) return []

    if (json.size() <= MAX_EVENT_VALUE_LENGTH) {
        return [json]
    }

    def safeChunkLength = Math.max(1, MAX_EVENT_VALUE_LENGTH - CHUNK_OVERHEAD)
    def chunkCount = Math.ceil(json.size() / safeChunkLength) as Integer
    if (chunkCount > MAX_PAYLOAD_CHUNKS) {
        log.warn "Dashboard payload (${json.size()} chars) exceeds chunk capacity. Truncating to ${MAX_PAYLOAD_CHUNKS} chunks."
        chunkCount = MAX_PAYLOAD_CHUNKS
    }

    def chunkSize = Math.ceil(json.size() / chunkCount) as Integer
    if (chunkSize > safeChunkLength) {
        chunkSize = safeChunkLength
    }

    def chunks = []
    def offset = 0
    for (int index = 0; index < chunkCount && offset < json.size(); index++) {
        def end = Math.min(offset + chunkSize, json.size())
        def slice = json.substring(offset, end)
        chunks << JsonOutput.toJson([
            chunkNamespace: 'weather-dashboard',
            chunkIndex    : index + 1,
            chunkCount    : chunkCount,
            chunkData     : slice
        ])
        offset = end
    }

    return chunks
}

private String chunkAttribute(int index) {
    switch (index) {
        case 0:
            return "dashboardData"
        case 1:
            return "dashboardDataChunk2"
        case 2:
            return "dashboardDataChunk3"
        default:
            return "dashboardData"
    }
}

private void clearUnusedChunkAttributes(int used) {
    if (used < 1) {
        sendEvent(name: "dashboardData", value: "{}", isStateChange: true)
    }
    if (used < 2) {
        sendEvent(name: "dashboardDataChunk2", value: "{}", isStateChange: true)
    }
    if (used < 3) {
        sendEvent(name: "dashboardDataChunk3", value: "{}", isStateChange: true)
    }
}
