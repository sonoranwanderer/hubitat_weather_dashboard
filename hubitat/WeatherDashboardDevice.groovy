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
    (0..<MAX_CHUNK_ATTRIBUTES).each { i -> sendEvent(name: chunkAttribute(i), value: "{}", isStateChange: true) }
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
@Field static final Integer CHUNK_COUNT_PLACEHOLDER = 99
@Field static final Integer CHUNK_SEQUENCE_MAX = 1679615 // base-36 'zzzz'
@Field static final Integer MAX_CHUNK_ATTRIBUTES = 10

private List<String> chunkPayload(String json) {
    if (!json) return []

    if (json.size() <= MAX_EVENT_VALUE_LENGTH) {
        return [json]
    }

    def totalLength = json.size()
    def fingerprint = generateChunkFingerprint(json)
    def attemptLimit = MAX_EVENT_VALUE_LENGTH
    def lastChunks = []
    def oversize = true

    while (attemptLimit > 0 && oversize) {
        def slices = buildChunkSlices(json, fingerprint, totalLength, attemptLimit)
        def chunkCount = slices.size()

        if (chunkCount > MAX_CHUNK_ATTRIBUTES) {
            log.error "Dashboard payload requires ${chunkCount} chunks which exceeds the supported maximum of ${MAX_CHUNK_ATTRIBUTES}."
            break
        }

        oversize = false
        lastChunks = []

        slices.eachWithIndex { slice, i ->
            def index = i + 1
            def chunk = JsonOutput.toJson(buildChunkEnvelope(index, chunkCount, fingerprint, slice.offset as Integer, slice.length as Integer, totalLength, slice.data))
            if (chunk.size() > MAX_EVENT_VALUE_LENGTH) {
                oversize = true
            }
            lastChunks << chunk
        }

        if (oversize) {
            attemptLimit = attemptLimit > 32 ? attemptLimit - 16 : attemptLimit - 1
        }
    }

    if (oversize) {
        log.error "Unable to generate dashboard chunks within ${MAX_EVENT_VALUE_LENGTH} characters even after tightening slice target (last attempt ${attemptLimit})."
        def placeholder = JsonOutput.toJson([
            error: "chunking_failed",
            originalLength: json.size(),
            limit: MAX_EVENT_VALUE_LENGTH
        ])
        return [placeholder]
    }

    if (!lastChunks) {
        log.warn "Chunk generation produced no slices — emitting placeholder payload."
        def placeholder = JsonOutput.toJson([
            error: "chunking_empty",
            originalLength: json.size(),
            limit: MAX_EVENT_VALUE_LENGTH
        ])
        return [placeholder]
    }

    return lastChunks
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

private List<Map> buildChunkSlices(String json, String fingerprint, int totalLength, int maxChunkLength) {
    def slices = []
    int offset = 0
    int index = 1

    while (offset < totalLength) {
        def builder = new StringBuilder()
        int cursor = offset
        int bestCursor = offset
        String bestData = null

        while (cursor < totalLength) {
            builder.append(json.charAt(cursor))
            cursor += 1

            def candidateData = builder.toString()
            def encodedLength = encodedChunkLength(index, CHUNK_COUNT_PLACEHOLDER, fingerprint, offset, candidateData.size(), totalLength, candidateData)
            if (encodedLength <= maxChunkLength) {
                bestData = candidateData
                bestCursor = cursor
            } else {
                if (builder.length() > 0) {
                    builder.setLength(builder.length() - 1)
                    cursor -= 1
                }
                break
            }
        }

        if (!bestData) {
            if (builder.length() == 0 && cursor < totalLength) {
                bestData = json.substring(offset, Math.min(offset + 1, totalLength))
                bestCursor = offset + bestData.size()
            } else if (builder.length() > 0) {
                bestData = builder.toString()
                bestCursor = cursor
            } else {
                break
            }

            def encodedLength = encodedChunkLength(index, CHUNK_COUNT_PLACEHOLDER, fingerprint, offset, bestData.size(), totalLength, bestData)
            while (encodedLength > maxChunkLength && bestData.size() > 1) {
                bestData = bestData.substring(0, bestData.size() - 1)
                bestCursor -= 1
                encodedLength = encodedChunkLength(index, CHUNK_COUNT_PLACEHOLDER, fingerprint, offset, bestData.size(), totalLength, bestData)
            }
        }

        if (!bestData) {
            break
        }

        def length = bestData.size()
        slices << [offset: offset, length: length, data: bestData]
        offset = bestCursor
        index += 1
    }

    return slices
}

private Integer encodedChunkLength(int index, int chunkCount, String fingerprint, int offset, int length, int totalLength, String data) {
    def chunk = buildChunkEnvelope(index, chunkCount, fingerprint, offset, length, totalLength, data)
    return JsonOutput.toJson(chunk).size()
}

private Map buildChunkEnvelope(int index, int chunkCount, String fingerprint, int offset, int length, int totalLength, String data) {
    return [
        ns: "wd",
        i: index,
        c: chunkCount,
        fp: fingerprint,
        o: offset,
        l: length,
        t: totalLength,
        d: data
    ]
}

private String chunkAttribute(int index) {
    if (index == 0) {
        return "dashboardData"
    }
    // index is 0-based, but chunk numbers are 1-based.
    // So index 1 corresponds to chunk 2.
    def chunkNum = index + 1
    if (chunkNum > MAX_CHUNK_ATTRIBUTES) {
        log.error "Exceeded maximum supported chunks (${MAX_CHUNK_ATTRIBUTES}). Payload is too large."
        return "dashboardData" // Fallback to avoid crash
    }
    return "dashboardDataChunk${chunkNum}"
}

private void clearUnusedChunkAttributes(int used) {
    // 'used' is the number of chunks. Attributes are 0-indexed.
    // If used=3, we need to clear from index 3 (chunk 4) onwards.
    (used..<MAX_CHUNK_ATTRIBUTES).each { i -> sendEvent(name: chunkAttribute(i), value: "{}", isStateChange: true) }
}
