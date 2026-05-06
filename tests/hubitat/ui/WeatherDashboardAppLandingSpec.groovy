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
binding.setVariable('runIn', { Object... args -> })
Map uploadedFiles = [:]
binding.setVariable('uploadHubFile', { String fileName, byte[] bytes -> uploadedFiles[fileName] = new String(bytes, 'UTF-8') })
binding.setVariable('downloadHubFile', { String fileName ->
    if (!uploadedFiles.containsKey(fileName)) {
        throw new FileNotFoundException(fileName)
    }
    return uploadedFiles[fileName].getBytes('UTF-8')
})
binding.setVariable('httpGet', { Map params, Closure handler ->
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
assert embedUrl.contains('makerApiToken=s3cr3tTOKEN')
assert embedUrl.contains('deviceIds=10%2C11%2C12%2C13')
assert embedUrl.contains('devices=10%2C11%2C12%2C13')

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

// Scenario: backup export preserves operational configuration/state but excludes secrets.
def weatherDevice = [
    id: 22,
    displayName: 'Ecowitt Gateway',
    label: 'Ecowitt Gateway',
    name: 'ecowitt-gateway',
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

println JsonOutput.toJson([status: 'ok', message: 'Weather Dashboard landing helpers verified'])
