#!/usr/bin/env groovy
/**
 * Lightweight Groovy smoke test that validates the Weather Dashboard App landing page helpers
 * without requiring the full Hubitat runtime. The script stubs Hub-specific DSL functions and
 * focuses on verifying the Maker API credentials flow that powers the embedded preview.
 */

import groovy.json.JsonOutput

Binding binding = new Binding()
binding.setVariable('definition', { Map config -> config })
binding.setVariable('preferences', { Closure<?> handler -> })
binding.setVariable('mappings', { Closure<?> handler -> })
binding.setVariable('state', [:])
binding.setVariable('createAccessToken', { -> 'generated-dashboard-token' })
binding.setVariable('now', { -> 1778103354260L })
binding.setVariable('unschedule', { Object... args -> })
binding.setVariable('unsubscribe', { Object... args -> })
List<List> runInCalls = []
binding.setVariable('runIn', { Object... args -> runInCalls << args.toList() })
Map childDevices = [:]
List<Map> childDeviceCreations = []
List<String> deletedChildDevices = []
binding.setVariable('getChildDevice', { String dni -> childDevices[dni] })
binding.setVariable('addChildDevice', { String namespace, String typeName, String dni, Map options ->
    def device = new Expando([
        namespace  : namespace,
        typeName   : typeName,
        dni        : dni,
        id         : '9001',
        label      : options?.label,
        displayName: options?.label ?: typeName
    ])
    device.setLabel = { String label -> device.label = label }
    childDevices[dni] = device
    childDeviceCreations << [namespace: namespace, typeName: typeName, dni: dni, options: options]
    return device
})
binding.setVariable('deleteChildDevice', { String dni ->
    deletedChildDevices << dni
    childDevices.remove(dni)
})
Map uploadedFiles = [:]
binding.setVariable('uploadHubFile', { String fileName, byte[] bytes -> uploadedFiles[fileName] = new String(bytes, 'UTF-8') })
binding.setVariable('downloadHubFile', { String fileName ->
    if (!uploadedFiles.containsKey(fileName)) {
        throw new FileNotFoundException(fileName)
    }
    return uploadedFiles[fileName].getBytes('UTF-8')
})
List<Map> httpGetCalls = []
binding.setVariable('httpGet', { Map params, Closure handler ->
    httpGetCalls << params
    def files = uploadedFiles.collect { name, contents ->
        [name: name, size: contents.getBytes('UTF-8').length.toString(), date: '1770000000000', type: 'file']
    } + [[name: 'not-a-weather-dashboard-backup.json', size: '2', date: '1760000000000', type: 'file']]
    handler.call([status: 200, data: [files: files]] as Expando)
})
binding.setVariable('log', new Expando(
    info: { Object... args -> },
    warn: { Object... args -> },
    error: { Object... args -> },
    debug: { Object... args -> },
    trace: { Object... args -> }
))

def shell = new GroovyShell(binding)
File appFile = new File('hubitat/WeatherDashboardApp.groovy')
if (!appFile.exists()) {
    throw new FileNotFoundException("Unable to locate ${appFile} from repo root. Run this script from the project root directory.")
}
Script appScript = shell.parse(appFile)
appScript.binding.setVariable('settings', [:])
Map appSettings = [:]
def appStub = [id: 101] as Expando
appStub.updateSetting = { String name, Map spec -> appSettings[name] = spec?.value }
appScript.binding.setVariable('app', appStub)
appScript.binding.setVariable('state', [:])
appScript.run()

Object invokePrivate(Script script, String methodName, Class<?>[] parameterTypes = [] as Class<?>[], Object... args) {
    def method = script.class.getDeclaredMethod(methodName, parameterTypes)
    method.accessible = true
    return method.invoke(script, args)
}

// Scenario: fully populated Maker API configuration renders an embeddable URL with encoded parameters.
appScript.binding.setVariable('settings', [
    makerApiBaseUrl : 'http://192.168.1.50',
    makerApiAppId   : '501',
    makerApiToken   : 's3cr3tTOKEN',
    makerApiDeviceIds: '10, 11,12\n13'
])
appScript.binding.setVariable('location', [hub: [localIP: '127.0.0.1']] as Expando)
String embedUrl = invokePrivate(appScript, 'buildDashboardEmbedUrl') as String
assert embedUrl?.startsWith('/local/weather-dashboard-app.html?')
assert embedUrl.contains('hubBaseUrl=http%3A%2F%2F192.168.1.50')
assert embedUrl.contains('appId=501')
assert embedUrl.contains('makerToken=s3cr3tTOKEN')
assert embedUrl.contains('deviceIds=10%2C11%2C12%2C13')
assert !embedUrl.contains('hub=')
assert !embedUrl.contains('makerApiToken=')
assert !embedUrl.contains('token=')
assert !embedUrl.contains('devices=')

// Scenario: fresh app initialization creates the dashboard child device before weather devices are configured.
childDevices.clear()
childDeviceCreations.clear()
deletedChildDevices.clear()
runInCalls.clear()
appScript.binding.setVariable('settings', [:])
appScript.binding.setVariable('state', [:])
appScript.initialize()
assert childDeviceCreations.size() == 1
assert childDeviceCreations[0].namespace == 'hubitat-weather-dashboard'
assert childDeviceCreations[0].typeName == 'Weather Dashboard Device'
assert childDeviceCreations[0].dni == 'weather-dashboard-101'
assert childDeviceCreations[0].options.label == 'Weather Dashboard'
assert childDeviceCreations[0].options.isComponent == true
assert runInCalls.empty

// Scenario: dashboard setup JSON contains the required Attribute tiles for import.
String layoutJson = invokePrivate(appScript, 'buildDashboardLayoutTemplateJson') as String
Map layoutTemplate = new groovy.json.JsonSlurper().parseText(layoutJson) as Map
assert layoutTemplate.name == 'Weather Dashboard'
assert layoutTemplate.bgColor == 'black'
assert layoutTemplate.customColors == [[
    template  : 'attribute',
    bgColor   : 'rgb(0,0,0)',
    iconColor : '',
    state     : 'default',
    customIcon: ''
]]
assert layoutTemplate.gridGap == 8
assert layoutTemplate.cols == '6'
assert layoutTemplate.rows == '6'
assert layoutTemplate.tiles.size() == 12
assert layoutTemplate.tiles[0].id == 0
assert layoutTemplate.tiles[0].device == '9001'
assert layoutTemplate.tiles[0].template == 'attribute'
assert layoutTemplate.tiles[0].templateExtra == 'dashboardScript'
assert layoutTemplate.tiles[0].row == 1
assert layoutTemplate.tiles[0].col == 1
assert layoutTemplate.tiles[0].rowSpan == 4
assert layoutTemplate.tiles[0].colSpan == 6
assert layoutTemplate.tiles*.templateExtra == [
    'dashboardScript',
    'segmentCore',
    'segmentPrecip',
    'segmentAirQuality',
    'segmentMeta',
    'segmentLayout',
    'segmentAmbient1',
    'segmentAmbient2',
    'segmentAmbient3',
    'segmentAmbient4',
    'segmentAmbient5',
    'segmentAmbient6'
]
assert layoutTemplate.customCSS.contains('#tile-1')
assert layoutTemplate.customCSS.contains('#tile-11')

// Scenario: uninstall removes the dashboard child device owned by the app.
appScript.uninstalled()
assert deletedChildDevices == ['weather-dashboard-101']
assert !childDevices.containsKey('weather-dashboard-101')

// Scenario: HTML attribute encoding prevents iframe injection issues.
String encoded = invokePrivate(appScript, 'htmlAttributeEncode', [String] as Class<?>[], '"foo&bar<baz>') as String
assert encoded == '&quot;foo&amp;bar&lt;baz&gt;'

// Scenario: missing configuration disables the preview instead of emitting a malformed URL.
appScript.binding.setVariable('settings', [makerApiBaseUrl: null, makerApiAppId: '502', makerApiToken: 'abc'])
assert invokePrivate(appScript, 'buildDashboardEmbedUrl') == null

// Scenario: Maker API detection tolerates missing location metadata and recognizes standard descriptors.
appScript.binding.setVariable('settings', [
    makerApiBaseUrl: 'http://192.168.1.60',
    makerApiAppId  : '777',
    makerApiToken  : 'configured'
])
appScript.binding.setVariable('location', new Expando())
Map missingMaker = invokePrivate(appScript, 'makerApiAppInfo') as Map
assert missingMaker.installed == true // configuration fallback marks Maker API as present even without location metadata

def makerLocation = new Expando()
makerLocation.metaClass.getAppsByName = { String name ->
    if (name == 'Maker API') {
        return [[label: 'Maker API', namespace: 'hubitat']]
    }
    return []
}
appScript.binding.setVariable('location', makerLocation)
Map detectedMaker = invokePrivate(appScript, 'makerApiAppInfo') as Map
assert detectedMaker.installed == true
assert detectedMaker.label == 'Maker API'

// Scenario: Maker API token validation accepts restored bare hub addresses and redacts diagnostics.
httpGetCalls.clear()
appScript.binding.setVariable('settings', [
    makerApiBaseUrl: '192.168.1.60/local/weather-dashboard-app.html?old=true',
    makerApiAppId  : '777',
    makerApiToken  : 'restored-token'
])
appScript.binding.setVariable('state', [:])
Map tokenValidation = invokePrivate(appScript, 'validateMakerApiTokenSetting') as Map
assert tokenValidation.valid == true
assert httpGetCalls.last().uri == 'http://192.168.1.60/apps/api/777/devices?access_token=restored-token'
assert tokenValidation.endpoint == 'http://192.168.1.60/apps/api/777/devices?access_token=REDACTED'
assert !tokenValidation.endpoint.contains('restored-token')

// Scenario: stale import feedback is cleared after leaving the Backup & Recovery workflow.
appScript.binding.setVariable('state', [
    loadedBackupJson         : '{"app":"Weather Dashboard App"}',
    loadedBackupFileName     : 'weather-dashboard-backup-20260507-150000.json',
    lastBackupFileLoadResult : [success: true],
    lastBackupValidation     : [valid: true],
    lastImportReport         : [applied: true],
    lastBackupFileResult     : [success: true]
])
invokePrivate(appScript, 'clearTransientBackupImportState')
Map clearedImportState = appScript.binding.getVariable('state') as Map
assert !clearedImportState.containsKey('loadedBackupJson')
assert !clearedImportState.containsKey('loadedBackupFileName')
assert !clearedImportState.containsKey('lastBackupFileLoadResult')
assert !clearedImportState.containsKey('lastBackupValidation')
assert !clearedImportState.containsKey('lastImportReport')
assert clearedImportState.lastBackupFileResult.success == true

// Scenario: backup export preserves operational configuration/state but excludes secrets.
def weatherDevice = [
    id: 22,
    displayName: 'Weather Gateway',
    label: 'Weather Gateway',
    name: 'weather-gateway',
    typeName: 'Virtual Weather'
] as Expando
appSettings = [
    weatherDevices        : [weatherDevice],
    attrOutdoorTemp       : 'temperature',
    attrOutdoorTempDevice : '22',
    temperatureInputUnit  : 'F',
    temperatureDisplayUnit: 'F',
    makerApiBaseUrl       : 'http://192.168.1.50',
    makerApiAppId         : '501',
    makerApiToken         : 'do-not-export',
    dashboardDeviceLabel  : 'Weather Dashboard'
]
appScript.binding.setVariable('settings', appSettings)
appScript.binding.setVariable('state', [
    dashboardAccessToken: 'do-not-export-dashboard-token',
    windHistory         : [[time: 1000L, speed: 4.2G, direction: 180G]],
    pressureHistory     : [[time: 1000L, pressure: 29.91G]],
    pressureBaseline    : [currentDay: '2026-05-06', dailySum: 29.91G, dailyCount: 1, history: [[day: '2026-05-05', avg: 29.88G]]],
    temperatureHistory  : [[time: 1000L, temperature: 72.3G]],
    dailyOutdoorTemp    : [day: '2026-05-06', high: 75.1G, low: 62.0G],
    dailyOutdoorAQ      : [day: '2026-05-06', aqiPeak: 45],
    dailyIndoorAQ       : [day: '2026-05-06', carbonDioxidePeak: 700],
    forecastDiagnostics : [summary: 'Pressure steady'],
    lastPayloadDayKey   : '2026-05-06'
])
Map backup = invokePrivate(appScript, 'buildBackupDocument') as Map
assert backup.schema.version == 1
assert backup.settings.scalars.makerApiBaseUrl == 'http://192.168.1.50'
assert !backup.settings.scalars.containsKey('makerApiToken')
assert backup.settings.devices.weatherDevices[0].id == '22'
assert backup.state.windHistory[0].speed == 4.2G
assert backup.state.pressureBaseline.currentDay == '2026-05-06'
assert !backup.state.containsKey('dashboardAccessToken')

Map writeResult = invokePrivate(appScript, 'writeBackupFile') as Map
assert writeResult.success == true
assert writeResult.fileName ==~ /weather-dashboard-backup-\d{8}-\d{6}\.json/
assert uploadedFiles[writeResult.fileName]?.contains('"Weather Dashboard App"')
assert appScript.binding.getVariable('state').lastBackupJson == null

appSettings.backupImportFileName = writeResult.fileName
appScript.binding.setVariable('settings', appSettings)
Map loadResult = invokePrivate(appScript, 'loadBackupFileForImport') as Map
assert loadResult.success == true
assert appScript.binding.getVariable('state').loadedBackupJson?.contains('"Weather Dashboard App"')
assert appScript.binding.getVariable('state').loadedBackupFileName == writeResult.fileName
assert appScript.binding.getVariable('state').lastBackupValidation.valid == true

appScript.binding.setVariable('location', [hub: [localIP: '127.0.0.1']] as Expando)
Map listResult = invokePrivate(appScript, 'refreshBackupFileList') as Map
assert listResult.success == true
assert listResult.files*.name.contains(writeResult.fileName)
assert !listResult.files*.name.contains('not-a-weather-dashboard-backup.json')

// Scenario: malformed import is rejected without being applied.
Map invalidImport = invokePrivate(appScript, 'validateBackupImportJson', [String] as Class<?>[], '{"notBackup":true}') as Map
assert invalidImport.valid == false
assert invalidImport.errors

// Scenario: missing Maker API token is optional and can be skipped.
String backupJson = JsonOutput.toJson(backup)
appSettings.makerApiToken = ''
appScript.binding.setVariable('settings', appSettings)
appScript.binding.setVariable('state', [lastBackupValidation: null])
Map importValidation = invokePrivate(appScript, 'validateBackupImportJson', [String] as Class<?>[], backupJson) as Map
assert importValidation.valid == true
assert importValidation.missingSecrets == ['makerApiToken']
invokePrivate(appScript, 'skipMakerApiTokenRecovery')
Map skippedValidation = appScript.binding.getVariable('state').lastBackupValidation as Map
assert appScript.binding.getVariable('state').makerApiTokenSkipped == true
assert skippedValidation.missingSecrets == []

// Scenario: preflight validates backup shape without claiming hub-global device resolution failures.
appScript.binding.setVariable('settings', [:])
appScript.binding.setVariable('state', [:])
Map remapValidation = invokePrivate(appScript, 'validateBackupImportJson', [String] as Class<?>[], backupJson) as Map
assert remapValidation.valid == true
assert remapValidation.unresolvedDevices == []
assert !remapValidation.warnings.any { it.toString().contains('device references') }

// Scenario: post-apply device verification groups repeated mapping issues by device.
appScript.binding.setVariable('settings', [
    weatherDevices: ['22']
])
List groupedDeviceIssues = invokePrivate(appScript, 'deviceMappingIssuesAfterImport', [Map, List] as Class<?>[], [
    weatherDevices            : [[id: '22', displayName: 'Weather Gateway']],
    attrOutdoorTempDevice     : [id: '22'],
    attrOutdoorHumidityDevice : [id: '22']
], ['weatherDevices', 'attrOutdoorTempDevice', 'attrOutdoorHumidityDevice']) as List
assert groupedDeviceIssues.size() == 1
assert groupedDeviceIssues[0].id == '22'
assert groupedDeviceIssues[0].displayName == 'Weather Gateway'
assert groupedDeviceIssues[0].settings == ['attrOutdoorHumidityDevice', 'attrOutdoorTempDevice']

// Scenario: importing a sparse backup clears stale durable state that is absent from the backup.
Map sparseBackup = new groovy.json.JsonSlurper().parseText(backupJson) as Map
sparseBackup.state.remove('pressureHistory')
sparseBackup.state.remove('temperatureHistory')
sparseBackup.state.remove('pressureBaseline')
appScript.binding.setVariable('app', appStub)
appScript.binding.setVariable('settings', [:])
appScript.binding.setVariable('state', [
    pressureHistory   : [[time: 1L, pressure: 30.01G]],
    temperatureHistory: [[time: 1L, temperature: 99.9G]],
    pressureBaseline  : [currentDay: 'stale', dailySum: 99.9G, dailyCount: 9, history: [[day: 'stale', avg: 99.9G]]]
])
Map sparseReport = invokePrivate(appScript, 'applyBackupImportJson', [String] as Class<?>[], JsonOutput.toJson(sparseBackup)) as Map
Map sparseState = appScript.binding.getVariable('state') as Map
assert sparseReport.applied == true
assert sparseReport.clearedState.contains('pressureHistory')
assert sparseReport.clearedState.contains('temperatureHistory')
assert sparseReport.clearedState.contains('pressureBaseline')
assert !sparseState.containsKey('pressureHistory')
assert !sparseState.containsKey('temperatureHistory')
assert sparseState.pressureBaseline.history == []
assert sparseState.pressureBaseline.currentDay == null

// Scenario: failed setting persistence is reported as an import error instead of success.
def failingApp = [id: 102] as Expando
failingApp.updateSetting = { String name, Map spec -> throw new RuntimeException("cannot update ${name}") }
appScript.binding.setVariable('app', failingApp)
appScript.binding.setVariable('settings', [:])
appScript.binding.setVariable('state', [:])
Map failedReport = invokePrivate(appScript, 'applyBackupImportJson', [String] as Class<?>[], backupJson) as Map
assert failedReport.applied == false
assert failedReport.errors.any { it.toString().contains('could not be imported') }
assert !failedReport.importedSettings.contains('dashboardDeviceLabel')

// Scenario: event debounce and cron refresh paths record scheduling/skip metrics.
runInCalls.clear()
appScript.binding.setVariable('settings', [enableEventTriggers: true, refreshCronMinutes: 1])
appScript.binding.setVariable('state', [:])
appScript.handleWeatherEvent([displayName: 'Gateway', name: 'temperature'] as Expando)
Map eventState = appScript.binding.getVariable('state') as Map
assert eventState.eventDebounceActive == true
assert runInCalls.any { it[0] == 2 && it[1] == 'refreshFromEvent' }
assert eventState.metrics.events.totalEvents == 1L

runInCalls.clear()
appScript.binding.setVariable('settings', [enableEventTriggers: true, refreshCronMinutes: 1])
appScript.binding.setVariable('state', [eventDebounceActive: true, metrics: [:]])
appScript.scheduledCronRefresh()
Map cronState = appScript.binding.getVariable('state') as Map
assert cronState.metrics.refresh.cron.skippedDuringEvent == 1L
assert runInCalls.any { it[0] == 60 && it[1] == 'scheduledCronRefresh' }

// Scenario: time-series histories prune stale entries and preserve fresh samples.
long baseTs = 1778103354260L
appScript.binding.setVariable('settings', [windAverageMinutes: 10, pressureBaselineDays: 2])
appScript.binding.setVariable('state', [
    windHistory       : [[time: baseTs - 900000L, speed: 1.0G, direction: 90G], [time: baseTs - 60000L, speed: 3.0G, direction: 180G]],
    pressureHistory   : [[time: baseTs - (25L * 60L * 60L * 1000L), pressure: 28.0G], [time: baseTs - 60000L, pressure: 29.9G]],
    temperatureHistory: [[time: baseTs - (7L * 60L * 60L * 1000L), temperature: 60.0G], [time: baseTs - 60000L, temperature: 70.0G]],
    pressureBaseline  : [history: [[day: '2026-05-04', avg: 29.7G], [day: '2026-05-05', avg: 29.8G], [day: '2026-05-06', avg: 29.9G]]],
    metrics           : [:]
])
invokePrivate(appScript, 'updateWindHistory', [BigDecimal, BigDecimal, Long.TYPE] as Class<?>[], 5.0G, 270.0G, baseTs)
invokePrivate(appScript, 'updatePressureHistory', [BigDecimal, Long.TYPE] as Class<?>[], 30.01G, baseTs)
invokePrivate(appScript, 'updateTemperatureHistory', [BigDecimal, Long.TYPE] as Class<?>[], 75.0G, baseTs)
Map baselineForLimit = (appScript.binding.getVariable('state') as Map).pressureBaseline as Map
invokePrivate(appScript, 'enforcePressureBaselineLimit', [Map] as Class<?>[], baselineForLimit)
Map historyState = appScript.binding.getVariable('state') as Map
assert historyState.windHistory.size() == 2
assert historyState.windHistory*.speed.contains(5.0G)
assert historyState.pressureHistory.size() == 2
assert historyState.temperatureHistory.size() == 2
assert baselineForLimit.history*.day == ['2026-05-05', '2026-05-06']
assert historyState.metrics.histories.wind.totalPruned == 1L
assert historyState.metrics.histories.pressure.totalPruned == 1L
assert historyState.metrics.histories.temperature.totalPruned == 1L

// Scenario: payload metadata and forecast helpers handle explicit layout and pressure inputs.
Map layoutOverride = invokePrivate(appScript, 'parseLayoutOverrideSetting', [String] as Class<?>[], '{"baseWidth":1000,"desktop":{"gap":"4px"}}') as Map
Map metadata = invokePrivate(appScript, 'buildMetadata', [Date, TimeZone, String, Map] as Class<?>[], new Date(baseTs), TimeZone.getTimeZone('UTC'), 'station-time', layoutOverride) as Map
assert metadata.layout.baseWidth == 1000
assert metadata.weatherStationTime == 'station-time'
Map dryOutlook = invokePrivate(appScript, 'computeOutlook', [BigDecimal, Map, BigDecimal, Map, String] as Class<?>[], 29.4G, [label: 'falling', ratePerHour: -0.05G], 20.0G, [:], 'inHg') as Map
assert dryOutlook.summary

println JsonOutput.toJson([status: 'ok', message: 'Weather Dashboard landing helpers verified'])
