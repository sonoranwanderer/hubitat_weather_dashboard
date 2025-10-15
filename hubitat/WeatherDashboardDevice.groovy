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
    // Define attributes for up to 10 chunks. The first is dashboardData.
    (2..10).each { i ->
        attribute "dashboardDataChunk${i}", "string"
    }
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
    sendEvent(name: "dashboardPretty", value: "{}", isStateChange: true)
    sendEvent(name: "dashboardUpdated", value: timestamp(), isStateChange: true)
    // Clear all chunk attributes
    (0..9).each { i -> sendEvent(name: chunkAttribute(i), value: "{}", isStateChange: true) }
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
@Field static final Integer CHUNK_OVERHEAD = 120
@Field static final Integer CHUNK_SEQUENCE_MAX = 1679615 // base-36 'zzzz'

private List<String> chunkPayload(String json) {
    if (!json) return []

    if (json.size() <= MAX_EVENT_VALUE_LENGTH) {
        return [json]
    }

    // First, iterate through the entire JSON string to determine how many chunks are needed.
    // This is a "dry run" to get the final chunkCount.
    def slices = []
    def offsets = []
    def lengths = []
    def offset = 0
    while (offset < json.size()) {
        def slice = buildSafeSlice(json, offset)
        def length = slice.size()
        slices << [data: slice, offset: offset, length: length]
        offsets << offset
        lengths << length
        offset += length
    }
    def chunkCount = slices.size()
    def totalLength = json.size()

    def fingerprint = generateChunkFingerprint(json)
    def chunks = []
    slices.eachWithIndex { slice, i ->
        def index = i + 1
        def chunk = JsonOutput.toJson([
            chunkNamespace: "weather-dashboard",
            chunkIndex: index,
            chunkCount: chunkCount,
            chunkFingerprint: fingerprint,
            chunkOffset: slice.offset,
            chunkLength: slice.length,
            chunkTotalLength: totalLength,
            chunkOffsets: offsets,
            chunkLengths: lengths,
            chunkData: slice.data
        ])
        if (chunk.size() > MAX_EVENT_VALUE_LENGTH) {
            log.warn "Generated chunk ${index} of ${chunkCount} is oversized (${chunk.size()} chars). This may cause dashboard errors."
        }
        chunks << chunk
    }

    return chunks
}

private String generateChunkFingerprint(String json) {
    if (!json) return null
    def timestamp = now()
    def sequence = nextChunkSequence()
    def length = json.size()
    try {
        def ts = Long.toString(timestamp, 36)
        def seq = Integer.toString(sequence, 36)
        def len = Integer.toString(length, 36)
        return "${ts}-${seq}-${len}"
    } catch (Exception ex) {
        log.warn "Unable to encode chunk fingerprint: ${ex.message}"
        return "${timestamp}-${sequence}-${length}"
    }
}

private Integer nextChunkSequence() {
    def current = (state?.chunkSequence ?: 0) as Integer
    def next = current + 1
    if (next > CHUNK_SEQUENCE_MAX) {
        next = 1
    }
    state.chunkSequence = next
    return next
}

private String buildSafeSlice(String json, int offset) {
    // The base size of the JSON envelope, assuming 2-digit numbers for index/count.
    def envelopeOverhead = '{"chunkNamespace":"weather-dashboard","chunkIndex":00,"chunkCount":00,"chunkData":""}'.size()
    // This is the max length of the *escaped* data, not the raw data.
    def maxEscapedLength = MAX_EVENT_VALUE_LENGTH - envelopeOverhead

    def builder = new StringBuilder()
    def escapedLength = 0
    for (int i = offset; i < json.size(); i++) {
        def ch = json.charAt(i)
        // Account for JSON string escaping: " becomes \" and \ becomes \\
        def charSize = (ch == '"' || ch == '\\') ? 2 : 1
        if (escapedLength + charSize > maxEscapedLength) break
        builder.append(ch)
        escapedLength += charSize
    }
    return builder.toString()
}

private String chunkAttribute(int index) {
    if (index == 0) {
        return "dashboardData"
    }
    // index is 0-based, but chunk numbers are 1-based.
    // So index 1 corresponds to chunk 2.
    def chunkNum = index + 1
    if (chunkNum > 10) {
        log.error "Exceeded maximum supported chunks (10). Payload is too large."
        return "dashboardData" // Fallback to avoid crash
    }
    return "dashboardDataChunk${chunkNum}"
}

private void clearUnusedChunkAttributes(int used) {
    // 'used' is the number of chunks. Attributes are 0-indexed.
    // If used=3, we need to clear from index 3 (chunk 4) onwards.
    (used..9).each { i -> sendEvent(name: chunkAttribute(i), value: "{}", isStateChange: true) }
}
