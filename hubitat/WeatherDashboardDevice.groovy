/*
 * WeatherDashboardDevice.groovy
 *
 * Virtual device that exposes structured dashboard payload segments via
 * attributes for use by Hubitat dashboards and external integrations.
 */

import groovy.json.JsonOutput
import groovy.json.JsonSlurper
import groovy.transform.Field

@Field static final Integer MAX_EVENT_VALUE_LENGTH = 1024
@Field static final Integer SEGMENT_SIZE_LIMIT = 700
@Field static final Integer AMBIENT_SENSORS_PER_SEGMENT = 4
@Field static final Integer MAX_AMBIENT_SEGMENTS = 6
@Field static final String EMPTY_JSON = '{}'
@Field static final Map<String, Map> STATIC_SEGMENTS = [
    core   : [plain: 'segmentCore',        base: 'segmentCoreB64'],
    precip : [plain: 'segmentPrecip',      base: 'segmentPrecipB64'],
    air    : [plain: 'segmentAirQuality',  base: 'segmentAirQualityB64'],
    meta   : [plain: 'segmentMeta',        base: 'segmentMetaB64'],
    layout : [plain: 'segmentLayout',      base: 'segmentLayoutB64']
]
@Field static final List<Map> AMBIENT_SEGMENT_ATTRS = (1..MAX_AMBIENT_SEGMENTS).collect { index ->
    [plain: "segmentAmbient${index}", base: "segmentAmbient${index}B64"]
}

definition(
    name: "Weather Dashboard Device",
    namespace: "ecowitt-dashboard",
    author: "Gatewood Green",
    importUrl: "https://raw.githubusercontent.com/sonoranwanderer/ecowitt_weather_hubitat_dashboard/main/hubitat/WeatherDashboardDevice.groovy"
) {
    capability "Sensor"
    capability "Refresh"

    STATIC_SEGMENTS.values().each { seg ->
        attribute seg.plain, "string"
        attribute seg.base, "string"
    }
    AMBIENT_SEGMENT_ATTRS.each { seg ->
        attribute seg.plain, "string"
        attribute seg.base, "string"
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
    (STATIC_SEGMENTS.values() + AMBIENT_SEGMENT_ATTRS).each { seg ->
        sendSegmentJson(seg.plain, seg.base, EMPTY_JSON)
    }
    sendEvent(name: "dashboardPretty", value: EMPTY_JSON, isStateChange: true)
    sendEvent(name: "dashboardUpdated", value: timestamp(), isStateChange: true)
}

def updateDashboardData(String json, String pretty = null) {
    if (!json) {
        if (enableDebug) log.debug "Received empty dashboard payload"
        clearDashboardData()
        return
    }

    Map payload = parsePayload(json)
    if (payload == null) {
        log.error "Weather Dashboard Device: Unable to parse dashboard JSON payload"
        return
    }

    def segments = buildSegmentPayloads(payload)

    sendSegment('core', segments.core)
    sendSegment('precip', segments.precip)
    sendAirQualitySegment(segments.air)
    sendMetaSegment(segments.meta)
    sendLayoutSegment(segments.layout)
    sendAmbientSegments(segments.ambient)

    if (pretty && pretty.size() <= MAX_EVENT_VALUE_LENGTH) {
        sendEvent(name: "dashboardPretty", value: pretty, isStateChange: true)
    } else if (pretty) {
        def placeholder = JsonOutput.toJson([message: "Pretty payload omitted (length ${pretty.size()} exceeds limit)"])
        sendEvent(name: "dashboardPretty", value: placeholder, isStateChange: true)
    } else {
        def prettyText = JsonOutput.prettyPrint(json)
        if (prettyText.size() <= MAX_EVENT_VALUE_LENGTH) {
            sendEvent(name: "dashboardPretty", value: prettyText, isStateChange: true)
        } else {
            def placeholder = JsonOutput.toJson([message: "Pretty payload omitted (length ${prettyText.size()} exceeds limit)"])
            sendEvent(name: "dashboardPretty", value: placeholder, isStateChange: true)
        }
    }

    sendEvent(name: "dashboardUpdated", value: timestamp(), isStateChange: true)
}

private Map parsePayload(String json) {
    try {
        def parsed = new JsonSlurper().parseText(json)
        if (parsed instanceof Map) {
            return parsed as Map
        }
        log.warn "Weather Dashboard Device: Expected JSON object but received ${parsed?.getClass()?.simpleName ?: 'unknown'}"
    } catch (Exception ex) {
        log.error "Weather Dashboard Device: JSON parse error — ${ex?.message ?: ex}", ex
    }
    return null
}

private Map buildSegmentPayloads(Map payload) {
    def core = buildCoreSegment(payload)
    def precip = buildPrecipSegment(payload)
    def ambient = buildAmbientSegments(payload)
    def air = buildAirQualitySegment(payload)
    def metaLayout = buildMetaAndLayoutSegments(payload)

    return [
        core   : core,
        precip : precip,
        ambient: ambient,
        air    : air,
        meta   : metaLayout.meta,
        layout : metaLayout.layout
    ]
}

private Map buildCoreSegment(Map payload) {
    def segment = [:]
    copyIfPresent(segment, payload, 'outdoor')
    copyIfPresent(segment, payload, 'indoor')
    copyIfPresent(segment, payload, 'wind')
    copyIfPresent(segment, payload, 'pressure')
    return segment
}

private Map buildPrecipSegment(Map payload) {
    def segment = [:]
    copyIfPresent(segment, payload, 'rain')
    copyIfPresent(segment, payload, 'solar')
    copyIfPresent(segment, payload, 'lightning')
    return segment
}

private List<Map> buildAmbientSegments(Map payload) {
    def rawList = payload.ambientSensors
    List<Map> sensors = []
    if (rawList instanceof Collection) {
        rawList.findAll { it instanceof Map }.eachWithIndex { Map entry, int index ->
            def cleaned = [:]
            entry.each { key, value ->
                if (value != null) cleaned[key] = value
            }
            cleaned.ordinal = index + 1
            sensors << cleaned
        }
    }

    int total = sensors.size()
    def rotation = payload.ambientRotationSeconds
    def tempUnit = payload.ambientTemperatureUnit
    def humidityUnit = payload.ambientHumidityUnit

    List<Map> segments = []
    if (sensors) {
        sensors.collate(AMBIENT_SENSORS_PER_SEGMENT).eachWithIndex { List<Map> group, int idx ->
            def segment = baseAmbientSegment(total, rotation, tempUnit, humidityUnit, idx)
            segment.ambientSensors = group
            segments << segment
        }
    } else {
        segments << baseAmbientSegment(total, rotation, tempUnit, humidityUnit, 0)
    }

    return segments
}

private Map baseAmbientSegment(int total, def rotation, def tempUnit, def humidityUnit, int segmentIndex) {
    def segment = [
        ambientSensors      : [],
        totalAmbientSensors : total,
        segmentIndex        : segmentIndex + 1,
        segmentSize         : AMBIENT_SENSORS_PER_SEGMENT
    ]
    if (rotation != null) segment.ambientRotationSeconds = rotation
    if (tempUnit != null) segment.ambientTemperatureUnit = tempUnit
    if (humidityUnit != null) segment.ambientHumidityUnit = humidityUnit
    return segment
}

private Map buildAirQualitySegment(Map payload) {
    def segment = [:]
    copyIfPresent(segment, payload, 'outdoorAirQuality')
    copyIfPresent(segment, payload, 'indoorAirQuality')
    return segment
}

private Map buildMetaAndLayoutSegments(Map payload) {
    def meta = [:]
    if (payload.outlook24h instanceof Map && payload.outlook24h) {
        meta.outlook24h = payload.outlook24h
    }

    Map metadata = [:]
    if (payload.metadata instanceof Map) {
        metadata.putAll(payload.metadata as Map)
    }

    def layout = null
    if (metadata.containsKey('layout')) {
        layout = metadata.remove('layout')
    } else if (metadata.containsKey('layoutOverride')) {
        layout = metadata.remove('layoutOverride')
    }

    if (!metadata.isEmpty()) {
        meta.metadata = metadata
    }

    return [meta: meta, layout: layout]
}

private void sendSegment(String key, Map data) {
    def attrs = STATIC_SEGMENTS[key]
    if (!attrs) return
    sendSegmentMap(attrs.plain, attrs.base, data)
}

private void sendAirQualitySegment(Map data) {
    sendSegmentMap(STATIC_SEGMENTS.air.plain, STATIC_SEGMENTS.air.base, data)
}

private void sendMetaSegment(Map data) {
    sendSegmentMap(STATIC_SEGMENTS.meta.plain, STATIC_SEGMENTS.meta.base, data)
}

private void sendLayoutSegment(def layout) {
    def attrs = STATIC_SEGMENTS.layout
    if (layout instanceof Map && !layout.isEmpty()) {
        sendSegmentMap(attrs.plain, attrs.base, [layout: layout])
    } else {
        sendSegmentJson(attrs.plain, attrs.base, EMPTY_JSON)
    }
}

private void sendSegmentMap(String plainAttr, String baseAttr, Map data) {
    def json = (data instanceof Map && !data.isEmpty()) ? JsonOutput.toJson(data) : EMPTY_JSON
    sendSegmentJson(plainAttr, baseAttr, json)
}

private void sendSegmentJson(String plainAttr, String baseAttr, String json) {
    def payload = json ?: EMPTY_JSON
    if (payload.length() > SEGMENT_SIZE_LIMIT) {
        log.warn "Weather Dashboard Device: Segment ${plainAttr} exceeds recommended size (${payload.length()} bytes)"
    }
    if (payload.length() > MAX_EVENT_VALUE_LENGTH) {
        log.error "Weather Dashboard Device: Segment ${plainAttr} exceeds Hubitat event limit (${payload.length()} chars)"
        payload = payload.take(MAX_EVENT_VALUE_LENGTH)
    }
    def encoded = payload.getBytes('UTF-8').encodeBase64().toString()
    sendEvent(name: plainAttr, value: payload, isStateChange: true)
    sendEvent(name: baseAttr, value: encoded, isStateChange: true)
}

private void sendAmbientSegments(List<Map> segments) {
    int count = segments instanceof List ? segments.size() : 0
    AMBIENT_SEGMENT_ATTRS.eachWithIndex { seg, idx ->
        Map segmentData = (idx < count) ? segments[idx] : null
        sendSegmentMap(seg.plain, seg.base, segmentData ?: [:])
    }
}

private void copyIfPresent(Map target, Map source, String key) {
    if (!(source instanceof Map)) return
    def value = source[key]
    if (value != null) {
        target[key] = value
    }
}

private String timestamp() {
    def tz = location?.timeZone ?: TimeZone.getTimeZone('UTC')
    return new Date().format("yyyy-MM-dd'T'HH:mm:ssXXX", tz)
}
