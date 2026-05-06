#!/usr/bin/env groovy
/**
 * Lightweight smoke coverage for the Weather Dashboard virtual device.
 *
 * The script stubs the Hubitat driver DSL and verifies segmentation, unchanged
 * event suppression, empty-payload clearing, invalid JSON handling, and script
 * publication without requiring a live Hubitat hub.
 */

import groovy.json.JsonOutput
import groovy.json.JsonSlurper

Binding binding = new Binding()
List<Map> events = []
List<Map> settingsUpdates = []
List<String> errors = []
List<String> warnings = []

binding.setVariable('definition', { Map config, Closure handler -> config })
binding.setVariable('preferences', { Closure handler -> })
binding.setVariable('state', [:])
binding.setVariable('settings', [:])
binding.setVariable('enableDebug', false)
binding.setVariable('dashboardScriptUrl', null)
binding.setVariable('runIn', { Object... args -> })
binding.setVariable('sendEvent', { Map event -> events << new LinkedHashMap(event) })
binding.setVariable('device', [
    displayName  : 'Weather Dashboard Device',
    updateSetting: { String name, Map spec -> settingsUpdates << [name: name, spec: spec] }
] as Expando)
binding.setVariable('location', [timeZone: TimeZone.getTimeZone('UTC')] as Expando)
binding.setVariable('log', new Expando(
    info : { Object... args -> },
    warn : { Object... args -> warnings << args.collect { it?.toString() }.join(' ') },
    error: { Object... args -> errors << args.collect { it?.toString() }.join(' ') },
    debug: { Object... args -> },
    trace: { Object... args -> }
))

Script driver = new GroovyShell(binding).parse(new File('hubitat/WeatherDashboardDevice.groovy'))
driver.run()
driver.initialize()

Object invokePrivate(Script script, String methodName, Class<?>[] parameterTypes = [] as Class<?>[], Object... args) {
    def method = script.class.getDeclaredMethod(methodName, parameterTypes)
    method.accessible = true
    return method.invoke(script, args)
}

def eventByName = { String name ->
    events.reverse().find { it.name == name }
}

def parseEventJson = { String name ->
    def event = eventByName(name)
    assert event != null
    new JsonSlurper().parseText(event.value.toString()) as Map
}

Map payload = [
    outdoor: [temperature: 76.2G, humidity: 33G, battery: 98],
    indoor : [temperature: 72.0G, humidity: 41G],
    wind   : [speedMph: 4.4G, directionDegrees: 180G],
    pressure: [relativeInHg: 29.92G],
    rain   : [dailyIn: 0.12G],
    solar  : [uvIndex: 7.1G],
    lightning: [count: 2, distanceMi: 4.3G],
    outdoorAirQuality: [aqi: 42, pm25: 8.5G],
    indoorAirQuality : [carbonDioxide: 701, pm25: 4.2G],
    outlook24h: [summary: 'Steady'],
    metadata: [
        generatedAt: '2026-05-06T12:00:00Z',
        layout: [baseWidth: 1200, baseHeight: 900]
    ],
    ambientRotationSeconds: 5,
    ambientHumidityUnit: '%',
    ambientSensors: (1..9).collect { index ->
        [name: "Sensor ${index}", temperature: 70G + index, humidity: 40G + index, battery: 90 - index]
    }
]

driver.updateDashboardData(JsonOutput.toJson(payload))

assert parseEventJson('segmentCore').outdoor.temperature == 76.2G
assert parseEventJson('segmentCore').wind.speedMph == 4.4G
assert parseEventJson('segmentPrecip').solar.uvIndex == 7.1G
assert parseEventJson('segmentAirQuality').indoorAirQuality.carbonDioxide == 701
assert parseEventJson('segmentMeta').outlook24h.summary == 'Steady'
assert parseEventJson('segmentMeta').metadata.generatedAt == '2026-05-06T12:00:00Z'
assert parseEventJson('segmentLayout').layout.baseWidth == 1200
assert parseEventJson('segmentAmbient1').ambientSensors.size() == 4
assert parseEventJson('segmentAmbient2').ambientSensors.size() == 4
assert parseEventJson('segmentAmbient3').ambientSensors.size() == 1
assert parseEventJson('segmentAmbient4') == [:]
assert eventByName('dashboardUpdated') != null

int eventCountAfterFirstUpdate = events.size()
driver.updateDashboardData(JsonOutput.toJson(payload))
assert events.size() == eventCountAfterFirstUpdate + 1 // only dashboardUpdated changes each refresh
assert events.last().name == 'dashboardUpdated'

driver.clearDashboardData()
assert parseEventJson('segmentCore') == [:]
assert parseEventJson('segmentAmbient1') == [:]

driver.updateDashboardData('{not json')
assert errors.any { it.contains('JSON parse error') || it.contains('Unable to parse') }

String customScript = invokePrivate(driver, 'buildScriptTag', [String] as Class<?>[], '/local/custom-weather-dashboard.js') as String
assert customScript.contains('/local/custom-weather-dashboard.js')
assert eventByName('dashboardScript').value.contains('WeatherDashboardDevice')

println 'Weather Dashboard device segmentation verified'
