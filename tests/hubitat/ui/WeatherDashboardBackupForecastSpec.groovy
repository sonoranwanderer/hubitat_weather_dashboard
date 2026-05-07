#!/usr/bin/env groovy
/**
 * Regression harness for backup/recovery forecast continuity.
 *
 * The fixture is a full Weather Dashboard backup. The test verifies that a
 * fresh app instance importing that backup preserves the durable forecast
 * inputs and produces the same next forecast calculations for a fixed current
 * reading and timestamp, excluding any real-world data gap after backup time.
 */

import groovy.json.JsonSlurper

File fixtureFile = new File('tests/fixtures/hubitat/forecast-history-full.json')
if (!fixtureFile.exists()) {
    throw new FileNotFoundException("Missing ${fixtureFile}. Run this script from the project root directory.")
}

Map backup = new JsonSlurper().parse(fixtureFile) as Map
String backupJson = fixtureFile.getText('UTF-8')

Script loadApp(Map initialSettings = [:], Map initialState = [:]) {
    Binding binding = new Binding()
    binding.setVariable('definition', { Map config -> config })
    binding.setVariable('preferences', { Closure<?> handler -> })
    binding.setVariable('mappings', { Closure<?> handler -> })
    binding.setVariable('settings', initialSettings)
    binding.setVariable('state', initialState)
    binding.setVariable('createAccessToken', { -> 'generated-dashboard-token' })
    binding.setVariable('now', { -> 1778103354260L })
    binding.setVariable('unschedule', { Object... args -> })
    binding.setVariable('unsubscribe', { Object... args -> })
    binding.setVariable('runIn', { Object... args -> })
    binding.setVariable('subscribe', { Object... args -> })
    Map childDevices = [:]
    binding.setVariable('getChildDevice', { String dni -> childDevices[dni] })
    binding.setVariable('addChildDevice', { String namespace, String typeName, String dni, Map options ->
        def device = new Expando([
            namespace  : namespace,
            typeName   : typeName,
            dni        : dni,
            label      : options?.label,
            displayName: options?.label ?: typeName
        ])
        device.setLabel = { String label -> device.label = label }
        childDevices[dni] = device
        return device
    })
    binding.setVariable('deleteChildDevice', { String dni -> childDevices.remove(dni) })
    binding.setVariable('log', new Expando(
        info : { Object... args -> },
        warn : { Object... args -> },
        error: { Object... args -> },
        debug: { Object... args -> },
        trace: { Object... args -> }
    ))
    binding.setVariable('location', [timeZone: TimeZone.getTimeZone('US/Arizona')] as Expando)

    Map appSettings = initialSettings
    def appStub = [id: 999] as Expando
    appStub.updateSetting = { String name, Map spec -> appSettings[name] = spec?.value }
    binding.setVariable('app', appStub)

    def shell = new GroovyShell(binding)
    Script script = shell.parse(new File('hubitat/WeatherDashboardApp.groovy'))
    script.run()
    return script
}

Object invokePrivate(Script script, String methodName, Class<?>[] parameterTypes = [] as Class<?>[], Object... args) {
    def method = script.class.getDeclaredMethod(methodName, parameterTypes)
    method.accessible = true
    return method.invoke(script, args)
}

Map normalizedSettings(Map document) {
    Map scalars = new LinkedHashMap((document.settings?.scalars ?: [:]) as Map)
    scalars.remove('makerApiToken')
    return scalars
}

Map normalizedState(Map document) {
    new LinkedHashMap((document.state ?: [:]) as Map)
}

Map forecastSnapshot(Script script, long timestamp, BigDecimal currentPressure, BigDecimal humidity) {
    Map trend = invokePrivate(script, 'computePressureTrend', [Long.TYPE] as Class<?>[], timestamp) as Map
    Map baseline = invokePrivate(script, 'computePressureBaselineSummary', [String] as Class<?>[], 'inHg') as Map
    Map outlook = invokePrivate(
        script,
        'computeOutlook',
        [BigDecimal, Map, BigDecimal, Map, String] as Class<?>[],
        currentPressure,
        trend,
        humidity,
        baseline,
        'inHg'
    ) as Map

    [
        trend   : normalizeForecastMap(trend),
        baseline: normalizeForecastMap(baseline),
        outlook : normalizeForecastMap(outlook)
    ]
}

Object normalizeForecastValue(Object value) {
    if (value == null) return null
    if (value instanceof Number) {
        return new BigDecimal(value.toString()).setScale(6, BigDecimal.ROUND_HALF_UP).stripTrailingZeros().toPlainString()
    }
    if (value instanceof Map) {
        return normalizeForecastMap(value as Map)
    }
    if (value instanceof Collection) {
        return (value as Collection).collect { normalizeForecastValue(it) }
    }
    value.toString()
}

Map normalizeForecastMap(Map value) {
    if (!value) return [:]
    Map normalized = new TreeMap()
    value.each { key, entryValue ->
        if (entryValue != null) {
            normalized[key.toString()] = normalizeForecastValue(entryValue)
        }
    }
    normalized
}

long forecastTimestamp = ((backup.state?.forecastDiagnostics?.generatedAt ?: backup.state?.pressureBaseline?.lastUpdated) as Number).longValue()
BigDecimal currentPressure = new BigDecimal(backup.state.forecastDiagnostics.inputs.pressure.toString())
BigDecimal currentHumidity = new BigDecimal(backup.state.forecastDiagnostics.inputs.humidity.toString())

Script original = loadApp(normalizedSettings(backup), normalizedState(backup))
Map originalForecast = forecastSnapshot(original, forecastTimestamp, currentPressure, currentHumidity)

Script recovered = loadApp([:], [:])
Map importReport = invokePrivate(recovered, 'applyBackupImportJson', [String] as Class<?>[], backupJson) as Map
assert importReport.applied == true
assert importReport.importedState.contains('pressureHistory')
assert importReport.importedState.contains('pressureBaseline')
assert importReport.importedState.contains('temperatureHistory')

Map recoveredState = recovered.binding.getVariable('state') as Map
assert recoveredState.pressureHistory.size() == backup.state.pressureHistory.size()
assert recoveredState.temperatureHistory.size() == backup.state.temperatureHistory.size()
assert recoveredState.pressureBaseline.history.size() == backup.state.pressureBaseline.history.size()
assert recoveredState.pressureBaseline.dailyCount == backup.state.pressureBaseline.dailyCount
assert recoveredState.pressureBaseline.currentDay == backup.state.pressureBaseline.currentDay

Map recoveredSettings = recovered.binding.getVariable('settings') as Map
assert recoveredSettings.pressureTrendHours == backup.settings.scalars.pressureTrendHours
assert recoveredSettings.pressureBaselineDays == backup.settings.scalars.pressureBaselineDays
assert recoveredSettings.pressureInputUnit == backup.settings.scalars.pressureInputUnit

Map recoveredForecast = forecastSnapshot(recovered, forecastTimestamp, currentPressure, currentHumidity)
assert recoveredForecast == originalForecast

// A controlled recovery gap should age short-window pressure samples naturally
// while preserving the long baseline history imported from backup.
long gapTimestamp = forecastTimestamp + (4L * 60L * 60L * 1000L)
Map gapForecast = forecastSnapshot(recovered, gapTimestamp, currentPressure, currentHumidity)
assert gapForecast.baseline.historyDays == originalForecast.baseline.historyDays
assert gapForecast.baseline.requiredHistoryDays == originalForecast.baseline.requiredHistoryDays
assert gapForecast.baseline.thirtyDayAverage == originalForecast.baseline.thirtyDayAverage

println 'Weather Dashboard backup forecast continuity verified'
