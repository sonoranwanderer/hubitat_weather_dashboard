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
@Field static final String DASHBOARD_SCRIPT_ATTR = 'dashboardScript'
@Field static final String DEFAULT_SCRIPT_URL = '/local/weather-dashboard.js'
@Field static final Map<String, String> STATIC_SEGMENTS = [
    core  : 'segmentCore',
    precip: 'segmentPrecip',
    air   : 'segmentAirQuality',
    meta  : 'segmentMeta',
    layout: 'segmentLayout'
]
@Field static final List<String> AMBIENT_SEGMENT_ATTRS = buildAmbientSegmentAttrs()

private static List<String> buildAmbientSegmentAttrs() {
    (1..MAX_AMBIENT_SEGMENTS).collect { index -> "segmentAmbient${index}" }
}

definition(
    name: "Weather Dashboard Device",
    namespace: "ecowitt-dashboard",
    author: "Gatewood Green",
    importUrl: "https://raw.githubusercontent.com/sonoranwanderer/ecowitt_weather_hubitat_dashboard/main/v2/hubitat/WeatherDashboardDevice.groovy"
) {
    capability "Sensor"
    capability "Refresh"

    STATIC_SEGMENTS.values().each { attr ->
        attribute attr, "string"
    }
    AMBIENT_SEGMENT_ATTRS.each { attr ->
        attribute attr, "string"
    }

    attribute "dashboardUpdated", "string"
    attribute DASHBOARD_SCRIPT_ATTR, "string"

    command "updateDashboardData", [[name: "Dashboard JSON", type: "STRING", description: "JSON payload for dashboard rendering"]]
    command "clearDashboardData"
}

preferences {
    input name: "enableDebug", type: "bool", title: "Enable debug logging", defaultValue: false
    input name: "dashboardScriptUrl", type: "text", title: "Dashboard script URL", required: false,
        defaultValue: DEFAULT_SCRIPT_URL,
        description: "Hub-hosted location of dashboard/weather-dashboard.js"
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
    publishDashboardScript()
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
    (STATIC_SEGMENTS.values() + AMBIENT_SEGMENT_ATTRS).each { attr ->
        sendSegmentJson(attr, EMPTY_JSON)
    }
    state.clear() // Clear last-sent segment cache
    sendEvent(name: "dashboardUpdated", value: timestamp(), isStateChange: true)
}

def updateDashboardData(String json) {
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

    sendEvent(name: "dashboardUpdated", value: timestamp(), isStateChange: true)
}

private Map parsePayload(String json) {
    try {
        def parsed = new JsonSlurper().parseText(json)
        if (parsed instanceof Map) {
            return parsed as Map
        }
        log.warn "Weather Dashboard Device: Expected JSON object but received ${describeValueType(parsed)}"
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
    def humidityUnit = payload.ambientHumidityUnit

    List<Map> segments = []
    if (sensors) {
        sensors.collate(AMBIENT_SENSORS_PER_SEGMENT).eachWithIndex { List<Map> group, int idx ->
            def segment = baseAmbientSegment(total, rotation, humidityUnit, idx)
            segment.ambientSensors = group
            segments << segment
        }
    } else {
        segments << baseAmbientSegment(total, rotation, humidityUnit, 0)
    }

    return segments
}

private Map baseAmbientSegment(int total, def rotation, def humidityUnit, int segmentIndex) {
    def segment = [
        ambientSensors      : [],
        totalAmbientSensors : total,
        segmentIndex        : segmentIndex + 1,
        segmentSize         : AMBIENT_SENSORS_PER_SEGMENT
    ]
    if (rotation != null) segment.ambientRotationSeconds = rotation
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
    def attr = STATIC_SEGMENTS[key]
    if (!attr) return
    sendSegmentMap(attr, data)
}

private void sendAirQualitySegment(Map data) {
    sendSegmentMap(STATIC_SEGMENTS.air, data)
}

private void sendMetaSegment(Map data) {
    sendSegmentMap(STATIC_SEGMENTS.meta, data)
}

private void sendLayoutSegment(def layout) {
    def attr = STATIC_SEGMENTS.layout
    if (layout instanceof Map && !layout.isEmpty()) {
        sendSegmentMap(attr, [layout: layout])
    } else {
        sendSegmentJson(attr, EMPTY_JSON)
    }
}

private void sendSegmentMap(String attr, Map data) {
    def json = (data instanceof Map && !data.isEmpty()) ? JsonOutput.toJson(data) : EMPTY_JSON
    sendSegmentJson(attr, json)
}

private void sendSegmentJson(String attr, String json) {
    def newPayload = json ?: EMPTY_JSON
    def stateKey = "last_${attr}"
    def lastPayload = state[stateKey]

    if (newPayload != lastPayload) {
        if (newPayload.length() > SEGMENT_SIZE_LIMIT) {
            if (enableDebug) log.debug "Weather Dashboard Device: Segment ${attr} exceeds recommended size (${newPayload.length()} bytes)"
        }
        if (newPayload.length() > MAX_EVENT_VALUE_LENGTH) {
            log.error "Weather Dashboard Device: Segment ${attr} exceeds Hubitat event limit (${newPayload.length()} chars)"
            newPayload = newPayload.take(MAX_EVENT_VALUE_LENGTH)
        }
        sendEvent(name: attr, value: newPayload, isStateChange: true)
        state[stateKey] = newPayload
    }
}

private void publishDashboardScript() {
    String url = settings?.dashboardScriptUrl?.trim()
    if (!url) {
        url = DEFAULT_SCRIPT_URL
    }

    String payload = buildScriptTag(url)
    def stateKey = "last_${DASHBOARD_SCRIPT_ATTR}"
    if (state[stateKey] != payload) {
        sendEvent(name: DASHBOARD_SCRIPT_ATTR, value: payload, isStateChange: true)
        state[stateKey] = payload
    }
}

private String buildScriptTag(String url) {
    String name = "${device.displayName.replaceAll( '\\s','' )}"
    return '''<img src onerror='
             function loadScript() {
               var body = document.getElementsByTagName( "body" )[0];
               var script = document.getElementById( "''' + name + '''" );
               var myScript = script != null;
               if ( !myScript ) {
                 script = document.createElement( "script" );
                 script.setAttribute( "id", "''' + name + '''" );
               }
               script.type = "text/javascript";
               script.src  = "''' + url + '''";
               if ( !myScript ) {
                 body.appendChild( script );
               }
             }
             setTimeout( loadScript, 500 );
           '></img>'''
}

private String escapeHtmlAttribute(String value) {
    if (value == null) {
        return ''
    }
    StringBuilder escaped = new StringBuilder()
    value.each { ch ->
        String token = ch?.toString()
        switch (token) {
            case '&':
                escaped.append('&amp;')
                break
            case '"':
                escaped.append('&quot;')
                break
            case "'":
                escaped.append('&#39;')
                break
            case '<':
                escaped.append('&lt;')
                break
            case '>':
                escaped.append('&gt;')
                break
            default:
                escaped.append(ch)
        }
    }
    return escaped.toString()
}

private void sendAmbientSegments(List<Map> segments) {
    int count = segments instanceof List ? segments.size() : 0
    AMBIENT_SEGMENT_ATTRS.eachWithIndex { attr, idx ->
        Map segmentData = (idx < count) ? segments[idx] : null
        sendSegmentMap(attr, segmentData ?: [:])
    }
}

private void copyIfPresent(Map target, Map source, String key) {
    if (!(source instanceof Map)) return
    def value = source[key]
    if (value != null) {
        target[key] = value
    }
}

private String describeValueType(def value) {
    if (value == null) return 'null'
    if (value instanceof Map) return 'Map'
    if (value instanceof List) return 'List'
    if (value instanceof Number) return 'Number'
    if (value instanceof Boolean) return 'Boolean'
    if (value instanceof CharSequence) return 'String'
    return 'unknown type'
}

private String timestamp() {
    def tz = location?.timeZone ?: TimeZone.getTimeZone('UTC')
    return new Date().format("yyyy-MM-dd'T'HH:mm:ssXXX", tz)
}
