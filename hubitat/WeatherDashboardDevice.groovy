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

    // First, iterate through the entire JSON string to determine how many chunks are needed.
    // This is a "dry run" to get the final chunkCount.
    def allSlices = []
    def tempOffset = 0
    while (tempOffset < json.size()) {
        def slice = buildSafeSlice(json, tempOffset)
        allSlices << slice
        tempOffset += slice.size()
    }
    def chunkCount = allSlices.size()

    def chunks = []
    allSlices.eachWithIndex { slice, i ->
        def index = i + 1
        // Manually escape the slice for embedding in the final JSON string.
        def escapedSlice = slice.replaceAll('\\\\', '\\\\\\\\').replaceAll('"', '\\\\"')
        def chunk = "{\"chunkNamespace\":\"weather-dashboard\",\"chunkIndex\":${index},\"chunkCount\":${chunkCount},\"chunkData\":\"${escapedSlice}\"}"
        chunks << chunk
    }

    return chunks
}

private String buildSafeSlice(String json, int offset) {
    // The base size of the JSON envelope, assuming 2-digit numbers for index/count.
    def envelopeOverhead = '{"chunkNamespace":"weather-dashboard","chunkIndex":00,"chunkCount":00,"chunkData":""}'.size()
    def maxLength = MAX_EVENT_VALUE_LENGTH - envelopeOverhead

    def builder = new StringBuilder()
    def escapedLength = 0
    for (int i = offset; i < json.size(); i++) {
        def ch = json.charAt(i)
        def charSize = (ch == '"' || ch == '\\') ? 2 : 1
        if (escapedLength + charSize > maxLength) break
        builder.append(ch)
        escapedLength += charSize
    }
    return builder.toString()
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
