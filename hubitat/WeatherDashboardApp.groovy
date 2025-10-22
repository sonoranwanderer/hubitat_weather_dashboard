/*
 * WeatherDashboardApp.groovy
 *
 * Aggregates Hubitat weather device data, computes derived statistics, and publishes
 * a JSON payload for consumption by the Weather Dashboard driver/JS tile.
 */

import groovy.json.JsonOutput
import groovy.json.JsonSlurper
import groovy.transform.Field
import java.math.RoundingMode
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.TimeZone

definition(
    name: "Weather Dashboard App",
    namespace: "ecowitt-dashboard",
    author: "Gatewood Green",
    description: "Aggregates weather data for the JavaScript dashboard tile.",
    category: "Convenience",
    importUrl: "https://raw.githubusercontent.com/sonoranwanderer/ecowitt_weather_hubitat_dashboard/main/hubitat/WeatherDashboardApp.groovy",
    iconUrl: "https://raw.githubusercontent.com/sonoranwanderer/ecowitt_weather_hubitat_dashboard/main/assets/weather-dashboard-icon.svg",
    iconX2Url: "https://raw.githubusercontent.com/sonoranwanderer/ecowitt_weather_hubitat_dashboard/main/assets/weather-dashboard-icon.svg"
)

@Field final TimeZone UTC_ZONE = TimeZone.getTimeZone('UTC')

preferences {
    page(name: "mainPage", title: "Weather Dashboard", install: true, uninstall: true)
    page(name: "diagnosticsPage")
}

def mainPage() {
    dynamicPage(name: "mainPage") {
        section("Weather data sources") {
            input name: "weatherDevices", type: "capability.sensor", title: "Weather devices", multiple: true, required: true, submitOnChange: true
            if (!settings.weatherDevices) {
                paragraph "Select one or more devices that provide the core weather attributes."
            }
        }

        def deviceOptions = weatherDeviceOptions()

        section("Attribute mapping (choose a device and override attribute names if needed)") {
            attributeInputs("Outdoor temperature", "attrOutdoorTemp", "temperature", deviceOptions)
            attributeInputs("Feels like", "attrFeelsLike", "feelsLike", deviceOptions)
            attributeInputs("Dew point", "attrDewPoint", "dewPoint", deviceOptions)
            attributeInputs("Outdoor humidity", "attrOutdoorHumidity", "humidity", deviceOptions)
            attributeInputs("Indoor temperature", "attrIndoorTemp", "temperatureIndoor", deviceOptions)
            attributeInputs("Indoor humidity", "attrIndoorHumidity", "humidityIndoor", deviceOptions)
            attributeInputs("Wind speed", "attrWindSpeed", "windSpeed", deviceOptions)
            attributeInputs("Wind gust", "attrWindGust", "windGust", deviceOptions)
            attributeInputs("Max Daily Gust", "attrWindGustMaxDaily", "windGustMaxDaily", deviceOptions)
            attributeInputs("Wind direction (cardinal)", "attrWindDirection", "windDirection", deviceOptions)
            attributeInputs("Wind direction (degrees)", "attrWindDirectionDegrees", "windDirectionDegrees", deviceOptions)
            attributeInputs("Relative pressure", "attrPressure", "pressure", deviceOptions)
            attributeInputs("Absolute pressure", "attrAbsolutePressure", "pressureAbsolute", deviceOptions)
            attributeInputs("Rain rate", "attrRainRate", "rainRate", deviceOptions)
            attributeInputs("Daily rain", "attrRainDaily", "rainDaily", deviceOptions)
            attributeInputs("Event rain", "attrRainEvent", "rainEvent", deviceOptions)
            attributeInputs("Hourly rain", "attrRainHourly", "rainHourly", deviceOptions)
            attributeInputs("Weekly rain", "attrRainWeekly", "rainWeekly", deviceOptions)
            attributeInputs("Monthly rain", "attrRainMonthly", "rainMonthly", deviceOptions)
            attributeInputs("Yearly rain", "attrRainYearly", "rainYearly", deviceOptions)
            attributeInputs("UV index", "attrUVIndex", "uv", deviceOptions)
            attributeInputs("Solar radiation", "attrSolarRadiation", "solarRadiation", deviceOptions)
            attributeInputs("Weather station update time", "attrStationUpdatedAt", "lastUpdateTime", deviceOptions)
        }

        section("Outdoor Air Quality (optional)") {
            attributeInputs("AQI", "attrOutdoorAQI", "aqi", deviceOptions)
            attributeInputs("AQI (24h Avg)", "attrOutdoorAQI24h", "aqi_avg_24h", deviceOptions)
            attributeInputs("AQI Color", "attrOutdoorAQIColor", "aqiColor", deviceOptions)
            attributeInputs("AQI Color (24h Avg)", "attrOutdoorAQIColor24h", "aqiColor_avg_24h", deviceOptions)
            attributeInputs("AQI Danger", "attrOutdoorAQIDanger", "aqiDanger", deviceOptions)
            attributeInputs("AQI Danger (24h Avg)", "attrOutdoorAQIDanger24h", "aqiDanger_avg_24h", deviceOptions)
            attributeInputs("PM2.5", "attrOutdoorPM25", "pm25", deviceOptions)
            attributeInputs("PM2.5 (24h Avg)", "attrOutdoorPM25_24h", "pm25_avg_24h", deviceOptions)
            attributeInputs("Battery", "attrOutdoorAQIBattery", "battery", deviceOptions)
        }

        section("Indoor Air Quality (optional)") {
            // Using the same structure as outdoor for consistency
            attributeInputs("AQI",                  "attrIndoorAQI",              "aqi", deviceOptions)
            attributeInputs("AQI (24h Avg)",        "attrIndoorAQI24h",           "aqi_avg_24h", deviceOptions)
            attributeInputs("AQI Color",            "attrIndoorAQIColor",         "aqiColor", deviceOptions)
            attributeInputs("AQI Color (24h Avg)",  "attrIndoorAQIColor24h",      "aqiColor_avg_24h", deviceOptions)
            attributeInputs("AQI Danger",           "attrIndoorAQIDanger",        "aqiDanger", deviceOptions)
            attributeInputs("AQI Danger (24h Avg)", "attrIndoorAQIDanger24h",     "aqiDanger_avg_24h", deviceOptions)
            attributeInputs("CO2",                  "attrIndoorCO2",              "carbonDioxide", deviceOptions)
            attributeInputs("CO2 (24h Avg)",        "attrIndoorCO2_24h",          "carbonDioxide_avg_24h", deviceOptions)
            attributeInputs("PM10",                 "attrIndoorPM10",             "pm10", deviceOptions)
            attributeInputs("PM10 (24h Avg)",       "attrIndoorPM10_24h",         "pm10_avg_24h", deviceOptions)
            attributeInputs("PM2.5",                "attrIndoorPM25",             "pm25", deviceOptions)
            attributeInputs("PM2.5 (24h Avg)",      "attrIndoorPM25_24h",         "pm25_avg_24h", deviceOptions)
            attributeInputs("Battery",              "attrIndoorAQIBattery",       "battery", deviceOptions)
        }

        section("Lightning sensor (optional)") {
            attributeInputs("Lightning count", "attrLightningCount", "lightningCount", deviceOptions)
            attributeInputs("Lightning distance", "attrLightningDistance", "lightningDistance", deviceOptions)
            attributeInputs("Lightning time", "attrLightningTime", "lightningTime", deviceOptions)
        }

        section("Battery attributes (optional)") {
            attributeInputs("Outdoor sensor battery", "attrOutdoorBattery", "battery", deviceOptions)
            attributeInputs("Wind sensor battery", "attrBatteryWind", "batteryWind", deviceOptions)
            attributeInputs("Rain sensor battery", "attrBatteryRain", "batteryRain", deviceOptions)
            attributeInputs("Lightning sensor battery", "attrLightningBattery", "battery", deviceOptions)
        }

        section("Ambient rotation sensors (optional)") {
            input name: "ambientSensors", type: "capability.sensor", title: "Ambient temperature/humidity sensors", multiple: true, required: false, submitOnChange: true
            if (settings.ambientSensors) {
                input name: "ambientTempAttr", type: "text", title: "Ambient temperature attribute", defaultValue: "temperature"
                input name: "ambientHumidityAttr", type: "text", title: "Ambient humidity attribute", defaultValue: "humidity"
                input name: "ambientBatteryAttr", type: "text", title: "Ambient battery attribute", defaultValue: "battery"
                input name: "ambientTemperatureUnit", type: "text", title: "Ambient temperature unit label", defaultValue: "°F"
                input name: "ambientHumidityUnit", type: "text", title: "Ambient humidity unit label", defaultValue: "%"
                input name: "ambientRotationSeconds", type: "number", title: "Rotation interval (seconds)", defaultValue: 12, range: "3..120"
            }
        }

        section("Derived calculation settings") {
            input name: "windAverageMinutes", type: "number", title: "Wind average window (minutes)", defaultValue: 10, range: "5..60"
            input name: "pressureTrendHours", type: "number", title: "Pressure tendency window (hours)", defaultValue: 3, range: "1..12"
            input name: "pressureBaselineDays", type: "number", title: "Pressure baseline window (days)", defaultValue: 30, range: "7..60"
        }

        section("Layout overrides (optional)") {
            paragraph "Provide JSON to fine-tune the dashboard canvas size and grid rows/columns. Leave blank to use the built-in defaults."
            paragraph "Set `baseWidth` and `baseHeight` (in pixels) to control the canvas size. Rows accept objects like `{ \"height\": 360, \"columns\": [\"temp-wind\", \"ambient\"] }`."
            paragraph "Repeat a card name in consecutive rows to make it span multiple heights, and use `\".\"` as a placeholder when you want the other column to stay empty so the next card can start higher."
            paragraph "Example:<br><code>{\n  \"baseWidth\": 1200,\n  \"baseHeight\": 900,\n  \"desktop\": {\n    \"rows\": [\n      { \"height\": 220, \"columns\": [\"temp-wind\", \"ambient\"] },\n      { \"height\": 200, \"columns\": [\"temp-wind\", \".\"] },\n      { \"height\": 180, \"columns\": [\"air\", \"rain\"] }\n    ]\n  }\n}</code>"
            input name: "layoutOverrideJson", type: "textarea", title: "Layout configuration JSON", required: false
        }

        section("Dashboard device") {
            input name: "dashboardDeviceLabel", type: "text", title: "Dashboard device label", defaultValue: "Weather Dashboard"
        }

        section("Actions") {
            input name: "saveAndPreview", type: "button", title: "Save & Refresh"
            input name: "refreshNow", type: "button", title: "Refresh"
        }
        section("Diagnostics") {
            href "diagnosticsPage", title: "View Latest Payload", description: "Show the last generated JSON payload for troubleshooting."
        }
    }
}

private void attributeInputs(String label, String attrSetting, String defaultAttr, Map options) {
    input name: "${attrSetting}Device", type: "enum", title: "${label} device", options: options ?: [:], required: false
    input name: attrSetting, type: "text", title: "${label} attribute", defaultValue: defaultAttr
}

private Map weatherDeviceOptions() {
    def devices = getWeatherDevices()
    devices.collectEntries { dev ->
        [(dev.id?.toString()): dev.displayName]
    }
}

def appButtonHandler(String buttonName) {
    switch (buttonName) {
        case 'saveAndPreview':
            log.info "Weather Dashboard App save & refresh requested"
            updated()
            refreshWeatherData()
            break
        case 'refreshNow':
            log.info "Weather Dashboard App manual refresh requested"
            refreshWeatherData()
            break
        default:
            log.warn "Unhandled button press: ${buttonName}"
    }
}

def installed() {
    log.info "Installing Weather Dashboard App"
    initialize()
}

def updated() {
    log.info "Updating Weather Dashboard App"
    unschedule()
    unsubscribe()
    initialize()
}

def initialize() {
    def devices = getWeatherDevices()
    if (!devices) {
        log.warn "Weather devices not configured yet"
        return
    }

    createOrUpdateChildDevice()
    state.windHistory = state.windHistory ?: []
    state.pressureHistory = state.pressureHistory ?: []
    state.pressureBaseline = normalizePressureBaselineState(state.pressureBaseline)
    state.temperatureHistory = state.temperatureHistory ?: []
    state.dailyOutdoorAQ = state.dailyOutdoorAQ ?: [:]
    state.dailyIndoorAQ = state.dailyIndoorAQ ?: [:]

    subscribeToSource()
    runEvery1Minute("refreshWeatherData")
    runIn(5, "refreshWeatherData")
}

private void subscribeToSource() {
    def subscriptions = []
    subscriptions.addAll(getAttributeSubscriptions())
    subscriptions.addAll(getAmbientSubscriptions())

    def seen = [] as Set
    subscriptions.each { sub ->
        def device = sub.device
        def attr = sub.attribute
        if (!device || !attr) return
        def key = "${device.id}:${attr}"
        if (seen.contains(key)) return
        try {
            subscribe(device, attr, "handleWeatherEvent")
            seen << key
        } catch (Throwable t) {
            log.debug "Unable to subscribe to ${device.displayName}.${attr}: ${t.message}"
        }
    }
}

private List<Map> getAttributeSubscriptions() {
    def attrs = [
        "attrOutdoorTemp",
        "attrFeelsLike",
        "attrDewPoint",
        "attrOutdoorHumidity",
        "attrIndoorTemp",
        "attrIndoorHumidity",
        "attrWindSpeed",
        "attrWindGust",
        "attrWindGustMaxDaily",
        "attrWindDirection",
        "attrWindDirectionDegrees",
        "attrPressure",
        "attrAbsolutePressure",
        "attrRainRate",
        "attrRainDaily",
        "attrRainEvent",
        "attrRainHourly",
        "attrRainWeekly",
        "attrRainMonthly",
        "attrRainYearly",
        "attrUVIndex",
        "attrSolarRadiation",
        "attrStationUpdatedAt",
        "attrOutdoorAQI",
        "attrOutdoorPM25",
        "attrIndoorAQI",
        "attrIndoorAQI24h",
        "attrIndoorAQIColor",
        "attrIndoorAQIColor24h",
        "attrIndoorAQIDanger",
        "attrIndoorAQIDanger24h",
        "attrIndoorCO2",
        "attrIndoorCO2_24h",
        "attrIndoorPM10",
        "attrIndoorPM10_24h",
        "attrIndoorPM25",
        "attrIndoorPM25_24h"
    ].plus([
        "attrLightningCount",
        "attrLightningDistance",
        "attrLightningTime",
        "attrOutdoorBattery",
        "attrBatteryWind",
        "attrBatteryRain",
        "attrLightningBattery",
        "attrOutdoorAQIBattery",
        "attrIndoorAQIBattery"
    ])

    attrs.collect { settingName ->
        def config = attributeConfig(settingName)
        if (config?.device && config?.attribute) {
            [device: config.device, attribute: config.attribute]
        }
    }.findAll { it }
}

private List<Map> getAmbientSubscriptions() {
    def sensors = getAmbientSensors()
    if (!sensors) return []

    def tempAttr = settings.ambientTempAttr ?: "temperature"
    def humidityAttr = settings.ambientHumidityAttr ?: "humidity"
    def batteryAttr = settings.ambientBatteryAttr ?: "battery"

    def subs = []
    sensors.each { dev ->
        if (tempAttr) {
            subs << [device: dev, attribute: tempAttr]
        }
        if (humidityAttr) {
            subs << [device: dev, attribute: humidityAttr]
        }
        if (batteryAttr) {
            subs << [device: dev, attribute: batteryAttr]
        }
    }
    subs
}

private List getWeatherDevices() {
    def devices = []
    def configured = settings.weatherDevices
    if (configured instanceof Collection) {
        configured.each { if (it) devices << it }
    } else if (configured) {
        devices << configured
    }
    if (!devices && settings.weatherDevice) {
        devices << settings.weatherDevice
    }
    def unique = []
    devices.each { dev ->
        if (dev && !unique.any { it.id == dev.id }) {
            unique << dev
        }
    }
    unique
}

private List getAmbientSensors() {
    def sensors = []
    def configured = settings.ambientSensors
    if (configured instanceof Collection) {
        configured.each { if (it) sensors << it }
    } else if (configured) {
        sensors << configured
    }
    def unique = []
    sensors.each { dev ->
        if (dev && !unique.any { it.id == dev.id }) {
            unique << dev
        }
    }
    unique
}

private def resolveDevice(def deviceSettingValue) {
    def devices = getWeatherDevices()
    if (!deviceSettingValue) {
        return devices ? devices.first() : null
    }
    devices.find { it.id?.toString() == deviceSettingValue.toString() }
}

private def primaryWeatherDevice() {
    def devices = getWeatherDevices()
    devices ? devices.first() : null
}

private Map attributeConfig(String attrSetting) {
    def attrName = settings[attrSetting]
    if (!attrName) return null
    def deviceSetting = "${attrSetting}Device"
    def device = resolveDevice(settings[deviceSetting]) ?: primaryWeatherDevice()
    if (!device) return null
    [device: device, attribute: attrName]
}

private BigDecimal readDecimalFor(String attrSetting) {
    def config = attributeConfig(attrSetting)
    readDecimal(config?.device, config?.attribute)
}

private Map normalizePressureBaselineState(Object raw) {
    Map baseline = [:]
    if (raw instanceof Map) {
        baseline.putAll(raw as Map)
    }

    def history = (baseline.history instanceof List) ? baseline.history : []
    List normalizedHistory = history.collect { entry ->
        if (!(entry instanceof Map)) return null
        def day = entry.day
        def avg = entry.avg
        String dayString = day != null ? day.toString() : null
        BigDecimal avgValue = toBigDecimal(avg)
        if (!dayString || avgValue == null) return null
        [day: dayString, avg: avgValue]
    }.findAll { it != null }

    baseline.history = normalizedHistory
    baseline.currentDay = baseline.currentDay ? baseline.currentDay.toString() : null
    baseline.dailySum = baseline.dailySum != null ? (toBigDecimal(baseline.dailySum) ?: 0.0G) : 0.0G
    baseline.dailyCount = baseline.dailyCount != null ? (baseline.dailyCount as Integer) : 0
    baseline.lastUnit = baseline.lastUnit ?: null
    baseline.lastUpdated = baseline.lastUpdated ?: null

    return baseline
}

private Map readPressureSample(String attrSetting) {
    def config = attributeConfig(attrSetting)
    readPressureSample(config?.device, config?.attribute)
}

private String readStringFor(String attrSetting) {
    def config = attributeConfig(attrSetting)
    readString(config?.device, config?.attribute)
}

def handleWeatherEvent(evt) {
    // Debounce frequent events by scheduling a refresh shortly after the last update.
    runIn(2, "refreshWeatherData")
}

def refreshWeatherData() {
    def devices = getWeatherDevices()
    if (!devices) {
        log.warn "No weather devices configured"
        return
    }

    def now = now()
    def tz = location?.timeZone ?: UTC_ZONE
    def latitude = location?.latitude
    def longitude = location?.longitude
    def generated = new Date(now)
    def payload = [:]

    def outdoor = [:]
    def tempF = readDecimalFor("attrOutdoorTemp")
    if (tempF != null) {
        outdoor.temperatureF = round(tempF, 1)
        def tempC = fahrenheitToCelsius(tempF)
        outdoor.temperatureC = round(tempC, 1)
        updateTemperatureHistory(tempF, now)
        def trend = computeTemperatureTrend()
        if (trend != null) {
            outdoor.trendFPerHour = round(trend, 2)
        }
    }

    def dailyExtrema = updateDailyOutdoorExtrema(tempF, now, tz)
    if (dailyExtrema?.high != null) {
        outdoor.dailyHighF = dailyExtrema.high
    }
    if (dailyExtrema?.low != null) {
        outdoor.dailyLowF = dailyExtrema.low
    }

    def feels = readDecimalFor("attrFeelsLike")
    if (feels != null) outdoor.feelsLikeF = round(feels, 1)

    def dew = readDecimalFor("attrDewPoint")
    if (dew != null) outdoor.dewPointF = round(dew, 1)

    def humidity = readDecimalFor("attrOutdoorHumidity")
    if (humidity != null) outdoor.humidity = round(humidity, 1)

    def outdoorBattery = readDecimalFor("attrOutdoorBattery")
    if (outdoorBattery != null) outdoor.battery = outdoorBattery

    if (outdoor) payload.outdoor = outdoor

    def indoor = [:]
    def indoorTemp = readDecimalFor("attrIndoorTemp")
    if (indoorTemp != null) indoor.temperatureF = round(indoorTemp, 1)
    def indoorHum = readDecimalFor("attrIndoorHumidity")
    if (indoorHum != null) indoor.humidity = round(indoorHum, 1)
    if (indoor) payload.indoor = indoor

    def wind = [:]
    def windSpeed = readDecimalFor("attrWindSpeed")
    if (windSpeed != null) {
        wind.speedMph = round(windSpeed, 1)
    }
    def windGust = readDecimalFor("attrWindGust")
    if (windGust != null) {
        wind.gustMph = round(windGust, 1)
    }
    def dailyMaxGust = readDecimalFor("attrWindGustMaxDaily")
    if (dailyMaxGust != null) {
        wind.dailyMaxGustMph = round(dailyMaxGust, 1)
    }
    def windBattery = readDecimalFor("attrBatteryWind")
    if (windBattery != null) {
        wind.battery = windBattery
    }

    def directionDegrees = readDecimalFor("attrWindDirectionDegrees")
    def directionText = readStringFor("attrWindDirection")
    if (directionDegrees == null && directionText) {
        directionDegrees = cardinalToDegrees(directionText)
    }
    if (directionDegrees != null) {
        wind.directionDegrees = round(directionDegrees, 1)
        wind.directionCardinal = degreesToCardinal(directionDegrees as double)
    } else if (directionText) {
        wind.directionCardinal = directionText
    }

    updateWindHistory(windSpeed, directionDegrees, now)
    def avgWind = computeWindAverage(now)
    if (avgWind) {
        wind.averageMinutes = (settings.windAverageMinutes ?: 10) as Integer
        wind.average = avgWind
    }
    if (wind) payload.wind = wind

    def pressure = [:]
    def relSample = readPressureSample("attrPressure")
    def absSample = readPressureSample("attrAbsolutePressure")
    def relPressure = relSample.value
    def absPressure = absSample.value
    if (relPressure != null) {
        pressure.relativeInHg = round(relPressure, 2)
    }
    if (absPressure != null) {
        pressure.absoluteInHg = round(absPressure, 2)
    }
    String pressureUnit = relSample.unit ?: absSample.unit ?: state.pressureBaseline?.lastUnit ?: "inHg"
    def referencePressure = relPressure ?: absPressure
    updatePressureHistory(referencePressure, now)
    updatePressureBaseline(referencePressure, pressureUnit, now, tz)
    def trend = computePressureTrend(now)
    if (trend) {
        pressure.trendInHgPerHour = round(trend.ratePerHour, 3)
        pressure.trend = trend.label
        if (trend.changeTotal != null) {
            pressure.changeInTrendWindow = round(trend.changeTotal, 3)
        }
    }
    def baseline = computePressureBaselineSummary(pressureUnit)
    if (baseline) {
        def baselinePayload = [:]
        if (baseline.dailyAverage != null) {
            baselinePayload.dailyAverageInHg = round(baseline.dailyAverage, 3)
        }
        if (baseline.thirtyDayAverage != null) {
            baselinePayload.thirtyDayAverageInHg = round(baseline.thirtyDayAverage, 3)
        }
        if (baseline.tendencyInHg != null) {
            baselinePayload.tendencyInHg = round(baseline.tendencyInHg, 3)
        }
        if (baseline.tendencyHpa != null) {
            baselinePayload.tendencyHpa = round(baseline.tendencyHpa, 1)
        }
        if (baseline.trendText) {
            baselinePayload.trend = baseline.trendText
        }
        if (baseline.iconKey) {
            baselinePayload.iconKey = baseline.iconKey
        }
        if (baseline.iconLabel) {
            baselinePayload.iconLabel = baseline.iconLabel
        }
        if (baseline.forecastText) {
            baselinePayload.forecastText = baseline.forecastText
        }
        if (baselinePayload) {
            pressure.baseline = baselinePayload
        }
    }
    if (pressure) payload.pressure = pressure

    def rain = [:]
    def rainRate = readDecimalFor("attrRainRate")
    if (rainRate != null) rain.rateInPerHour = round(rainRate, 2)
    def rainDaily = readDecimalFor("attrRainDaily")
    if (rainDaily != null) rain.dailyIn = round(rainDaily, 2)
    def rainEvent = readDecimalFor("attrRainEvent")
    if (rainEvent != null) rain.eventIn = round(rainEvent, 2)
    def rainHourly = readDecimalFor("attrRainHourly")
    if (rainHourly != null) rain.hourlyIn = round(rainHourly, 2)
    def rainWeekly = readDecimalFor("attrRainWeekly")
    if (rainWeekly != null) rain.weeklyIn = round(rainWeekly, 2)
    def rainMonthly = readDecimalFor("attrRainMonthly")
    if (rainMonthly != null) rain.monthlyIn = round(rainMonthly, 2)
    def rainYearly = readDecimalFor("attrRainYearly")
    if (rainYearly != null) rain.yearlyIn = round(rainYearly, 2)
    def rainBattery = readDecimalFor("attrBatteryRain")
    if (rainBattery != null) rain.battery = rainBattery
    if (rain) payload.rain = rain

    def solar = [:]
    def uv = readDecimalFor("attrUVIndex")
    if (uv != null) solar.uvIndex = round(uv, 1)
    def solarRad = readDecimalFor("attrSolarRadiation")
    if (solarRad != null) solar.solarRadiationWm2 = round(solarRad, 1)

    def outdoorAir = [:]
    def outdoorAqi = readDecimalFor("attrOutdoorAQI")
    if (outdoorAqi != null) outdoorAir.aqi = Math.round(outdoorAqi)
    def outdoorPm25 = readDecimalFor("attrOutdoorPM25")
    if (outdoorPm25 != null) outdoorAir.pm25 = round(outdoorPm25, 1)

    def dailyOutdoorAQExtrema = updateDailyAQExtrema("outdoor", [aqi: outdoorAqi, pm25: outdoorPm25], now, tz)
    if (dailyOutdoorAQExtrema?.aqiPeak != null) outdoorAir.aqiPeak = dailyOutdoorAQExtrema.aqiPeak
    if (dailyOutdoorAQExtrema?.pm25Peak != null) outdoorAir.pm25Peak = dailyOutdoorAQExtrema.pm25Peak

    outdoorAir.aqi_avg_24h = readDecimalFor("attrOutdoorAQI24h")
    outdoorAir.aqiColor = readStringFor("attrOutdoorAQIColor")
    outdoorAir.aqiColor_avg_24h = readStringFor("attrOutdoorAQIColor24h")
    outdoorAir.aqiDanger = readStringFor("attrOutdoorAQIDanger")
    outdoorAir.aqiDanger_avg_24h = readStringFor("attrOutdoorAQIDanger24h")
    outdoorAir.pm25_avg_24h = readDecimalFor("attrOutdoorPM25_24h")
    outdoorAir.battery = readDecimalFor("attrOutdoorAQIBattery")

    if (outdoorAir.any { it.value != null }) payload.outdoorAirQuality = outdoorAir.findAll { it.value != null }

    def indoorAir = [:]
    def indoorAqi = readDecimalFor("attrIndoorAQI")
    if (indoorAqi != null) indoorAir.aqi = Math.round(indoorAqi)
    def indoorPm10 = readDecimalFor("attrIndoorPM10")
    if (indoorPm10 != null) indoorAir.pm10 = round(indoorPm10, 1)
    def indoorPm25 = readDecimalFor("attrIndoorPM25")
    if (indoorPm25 != null) indoorAir.pm25 = round(indoorPm25, 1)
    def indoorCo2 = readDecimalFor("attrIndoorCO2")
    if (indoorCo2 != null) indoorAir.carbonDioxide = Math.round(indoorCo2)

    def dailyIndoorAQExtrema = updateDailyAQExtrema("indoor", [aqi: indoorAqi, pm10: indoorPm10, pm25: indoorPm25, carbonDioxide: indoorCo2], now, tz)
    if (dailyIndoorAQExtrema?.aqiPeak != null) indoorAir.aqiPeak = dailyIndoorAQExtrema.aqiPeak
    if (dailyIndoorAQExtrema?.pm10Peak != null) indoorAir.pm10Peak = dailyIndoorAQExtrema.pm10Peak
    if (dailyIndoorAQExtrema?.pm25Peak != null) indoorAir.pm25Peak = dailyIndoorAQExtrema.pm25Peak
    if (dailyIndoorAQExtrema?.carbonDioxidePeak != null) indoorAir.carbonDioxidePeak = dailyIndoorAQExtrema.carbonDioxidePeak

    indoorAir.aqi_avg_24h = readDecimalFor("attrIndoorAQI24h")
    indoorAir.aqiColor = readStringFor("attrIndoorAQIColor")
    indoorAir.aqiColor_avg_24h = readStringFor("attrIndoorAQIColor24h")
    indoorAir.aqiDanger = readStringFor("attrIndoorAQIDanger")
    indoorAir.aqiDanger_avg_24h = readStringFor("attrIndoorAQIDanger24h")
    indoorAir.carbonDioxide_avg_24h = readDecimalFor("attrIndoorCO2_24h")
    indoorAir.pm10_avg_24h = readDecimalFor("attrIndoorPM10_24h")
    indoorAir.pm25_avg_24h = readDecimalFor("attrIndoorPM25_24h")
    indoorAir.battery = readDecimalFor("attrIndoorAQIBattery")

    if (indoorAir.any { it.value != null }) payload.indoorAirQuality = indoorAir.findAll { it.value != null }
    
    def sunriseDate = location?.sunrise
    if (sunriseDate) solar.sunrise = formatDateTime(sunriseDate, tz)
    def sunsetDate = location?.sunset
    if (sunsetDate) solar.sunset = formatDateTime(sunsetDate, tz)
    def moon = computeMoonPhase(generated, tz, latitude, longitude)
    if (moon) solar.moon = moon
    if (solar) payload.solar = solar

    def lightning = [:]
    def lightningCount = readDecimalFor("attrLightningCount")
    if (lightningCount != null) lightning.count = lightningCount
    def lightningDistance = readDecimalFor("attrLightningDistance")
    if (lightningDistance != null) lightning.distance = lightningDistance
    def lightningTime = readStringFor("attrLightningTime")
    if (lightningTime != null) {
        lightning.time = lightningTime
    }
    def lightningBattery = readDecimalFor("attrLightningBattery")
    if (lightningBattery != null) {
        lightning.battery = lightningBattery
    }
    if (lightning) payload.lightning = lightning

    if (!payload.outlook24h) {
        def outlook = computeOutlook(
            payload.pressure?.relativeInHg ?: payload.pressure?.absoluteInHg,
            trend,
            outdoor?.humidity,
            baseline,
            pressureUnit
        )
        if (outlook) payload.outlook24h = outlook
    }

    def ambient = buildAmbientSensorsPayload()
    if (ambient?.sensors) {
        payload.ambientSensors = ambient.sensors
        if (ambient.rotationSeconds) payload.ambientRotationSeconds = ambient.rotationSeconds
        if (ambient.temperatureUnit) payload.ambientTemperatureUnit = ambient.temperatureUnit
        if (ambient.humidityUnit) payload.ambientHumidityUnit = ambient.humidityUnit
    }

    def stationUpdatedAt = readStringFor("attrStationUpdatedAt")
    if (stationUpdatedAt instanceof CharSequence) {
        stationUpdatedAt = stationUpdatedAt.toString().trim()
        if (!stationUpdatedAt) {
            stationUpdatedAt = null
        }
    }

    def layoutOverride = parseLayoutOverrideSetting()
    payload.metadata = buildMetadata(generated, tz, stationUpdatedAt, layoutOverride)

    def json = JsonOutput.toJson(payload)
    def pretty = JsonOutput.prettyPrint(json)

    state.lastPayload = payload
    state.lastPrettyPayload = pretty

    def child = getChildDevice(childDeviceDni())
    if (child) {
        child.updateDashboardData(json)
    }
}

private Map parseLayoutOverrideSetting() {
    def raw = settings.layoutOverrideJson
    if (!(raw instanceof CharSequence)) {
        state.remove('lastLayoutOverrideError')
        return null
    }
    def text = raw.toString().trim()
    if (!text) {
        state.remove('lastLayoutOverrideError')
        return null
    }
    try {
        def parsed = new JsonSlurper().parseText(text)
        if (parsed instanceof Map) {
            state.remove('lastLayoutOverrideError')
            return parsed as Map
        }
        if (state.lastLayoutOverrideError != text) {
            log.warn "Weather Dashboard App: Layout override JSON must be an object."
            state.lastLayoutOverrideError = text
        }
    } catch (Exception ex) {
        if (state.lastLayoutOverrideError != text) {
            log.warn "Weather Dashboard App: Unable to parse layout override JSON (${ex?.message ?: ex})."
            state.lastLayoutOverrideError = text
        }
    }
    return null
}

private Map buildMetadata(Date generated, TimeZone tz, String stationUpdatedAt, Map layoutOverride) {
    def metadata = [
        generatedAt: generated.format("yyyy-MM-dd'T'HH:mm:ssXXX", tz)
    ]
    if (tz) {
        metadata.weatherStationTimezone = tz?.ID
    }
    if (stationUpdatedAt) {
        metadata.weatherStationTime = stationUpdatedAt
    }
    if (layoutOverride) {
        metadata.layout = layoutOverride
    }
    metadata
}

private Map buildAmbientSensorsPayload() {
    def sensors = getAmbientSensors()
    if (!sensors) return null

    def tempAttr = settings.ambientTempAttr ?: "temperature"
    def humidityAttr = settings.ambientHumidityAttr ?: "humidity"
    def batteryAttr = settings.ambientBatteryAttr ?: "battery"
    Integer rotation = settings.ambientRotationSeconds ? (settings.ambientRotationSeconds as Integer) : 12
    if (rotation < 3) {
        rotation = 3
    }
    def tempUnit = settings.ambientTemperatureUnit ?: "°F"
    def humidityUnit = settings.ambientHumidityUnit ?: "%"

    def entries = []
    sensors.each { dev ->
        def entry = [
            id  : dev.id,
            name: dev.displayName
        ]
        def tempVal = tempAttr ? readDecimal(dev, tempAttr) : null
        if (tempVal != null) {
            entry.temperatureF = round(tempVal, 1)
            entry.temperatureC = round(fahrenheitToCelsius(tempVal), 1)
        }
        def humidityVal = humidityAttr ? readDecimal(dev, humidityAttr) : null
        if (humidityVal != null) {
            entry.humidity = round(humidityVal, 1)
        }
        def batteryVal = batteryAttr ? readDecimal(dev, batteryAttr) : null
        if (batteryVal != null) {
            entry.battery = batteryVal
        }
        if (entry.temperatureF != null || entry.humidity != null || entry.battery != null) {
            entries << entry
        }
    }

    if (!entries) return null

    [
        sensors: entries,
        rotationSeconds: rotation,
        temperatureUnit: tempUnit,
        humidityUnit: humidityUnit
    ]
}

private String formatDateTime(Date date, TimeZone tz) {
    if (!date) return null
    def formatter = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX")
    formatter.setTimeZone(tz ?: TimeZone.getTimeZone('UTC'))
    formatter.format(date)
}

private void createOrUpdateChildDevice() {
    def dni = childDeviceDni()
    def existing = getChildDevice(dni)
    if (!existing) {
        try {
            existing = addChildDevice(
                "ecowitt-dashboard",
                "Weather Dashboard Device",
                dni,
                [label: settings.dashboardDeviceLabel ?: "Weather Dashboard", isComponent: false]
            )
            log.info "Created dashboard device: ${existing?.displayName}"
        } catch (Throwable t) {
            log.error "Unable to create dashboard device: ${t.message}", t
        }
    } else {
        if (settings.dashboardDeviceLabel && existing.label != settings.dashboardDeviceLabel) {
            existing.setLabel(settings.dashboardDeviceLabel)
        }
    }
}

private String childDeviceDni() {
    "weather-dashboard-${app.id}"
}

private BigDecimal readDecimal(device, String attrName) {
    if (!device || !attrName) return null
    def value = device.currentValue(attrName)
    if (value == null) return null
    return toBigDecimal(value)
}

private Map readPressureSample(device, String attrName) {
    if (!device || !attrName) {
        return [value: null, unit: null]
    }
    def eventState = device.currentState(attrName)
    if (!eventState) {
        return [value: null, unit: null]
    }
    return [value: toBigDecimal(eventState.value), unit: eventState.unit]
}

private String readString(device, String attrName) {
    if (!device || !attrName) return null
    def value = device.currentValue(attrName)
    return value != null ? value.toString() : null
}

private BigDecimal toBigDecimal(value) {
    if (value instanceof Number) {
        return value as BigDecimal
    }
    if (value instanceof String) {
        def matcher = (value =~ /-?\d+(?:\.\d+)?/)
        if (matcher.find()) {
            return matcher.group(0) as BigDecimal
        }
    }
    return null
}

private BigDecimal round(value, int scale) {
    if (value == null) return null
    return (value as BigDecimal).setScale(scale, RoundingMode.HALF_UP)
}

private BigDecimal fahrenheitToCelsius(BigDecimal tempF) {
    ((tempF - 32) * 5 / 9) as BigDecimal
}

private void updateWindHistory(BigDecimal speed, BigDecimal direction, long timestamp) {
    def minutes = (settings.windAverageMinutes ?: 10) as Integer
    def cutoff = timestamp - (minutes * 60 * 1000L)
    def history = (state.windHistory ?: []) as List
    history = history.findAll { it.time >= cutoff }
    if (speed != null) {
        history << [time: timestamp, speed: speed as BigDecimal, direction: direction]
    }
    state.windHistory = history
}

private Map computeWindAverage(long timestamp) {
    def history = (state.windHistory ?: []) as List
    if (!history) return null
    def minutes = (settings.windAverageMinutes ?: 10) as Integer
    def cutoff = timestamp - (minutes * 60 * 1000L)
    def samples = history.findAll { it.time >= cutoff && it.speed != null }
    if (!samples) return null

    BigDecimal speedSum = 0
    samples.each { sample ->
        speedSum += sample.speed
    }
    def avgSpeed = speedSum / samples.size()

    BigDecimal avgDir = null
    def dirs = samples.findAll { it.direction != null }
    if (dirs) {
        double sumX = 0
        double sumY = 0
        dirs.each { sample ->
            double radians = Math.toRadians(sample.direction as double)
            sumX += Math.sin(radians) * (sample.speed as double)
            sumY += Math.cos(radians) * (sample.speed as double)
        }
        double angle = Math.atan2(sumX, sumY)
        double deg = Math.toDegrees(angle)
        if (deg < 0) deg += 360
        avgDir = deg as BigDecimal
    }

    def result = [
        speedMph: round(avgSpeed, 1),
        minutes: (settings.windAverageMinutes ?: 10) as Integer
    ]
    if (avgDir != null) {
        result.directionDegrees = round(avgDir, 1)
        result.directionCardinal = degreesToCardinal(avgDir as double)
    }
    return result
}

private void updatePressureHistory(BigDecimal pressure, long timestamp) {
    def history = (state.pressureHistory ?: []) as List
    def cutoff = timestamp - (24 * 60 * 60 * 1000L)
    history = history.findAll { it.time >= cutoff }
    if (pressure != null) {
        history << [time: timestamp, pressure: pressure as BigDecimal]
    }
    state.pressureHistory = history
}

private void updatePressureBaseline(BigDecimal pressure, String unit, long timestamp, TimeZone tz) {
    def baseline = normalizePressureBaselineState(state.pressureBaseline)
    String dayKey = dayKeyFor(timestamp, tz)

    if (!baseline.currentDay) {
        baseline.currentDay = dayKey
        baseline.dailySum = 0.0G
        baseline.dailyCount = 0
    } else if (baseline.currentDay != dayKey) {
        finalizePressureBaselineDay(baseline)
        baseline.currentDay = dayKey
        baseline.dailySum = 0.0G
        baseline.dailyCount = 0
    }

    if (pressure != null) {
        baseline.dailySum = ((baseline.dailySum ?: 0.0G) as BigDecimal) + (pressure as BigDecimal)
        baseline.dailyCount = ((baseline.dailyCount ?: 0) as Integer) + 1
    }

    if (unit) {
        baseline.lastUnit = unit
    }
    baseline.lastUpdated = timestamp
    state.pressureBaseline = baseline
}

private void finalizePressureBaselineDay(Map baseline) {
    if (!baseline?.currentDay) return
    Integer count = (baseline.dailyCount ?: 0) as Integer
    if (!count) return
    BigDecimal sum = (baseline.dailySum ?: 0.0G) as BigDecimal
    if (sum == null) return
    BigDecimal avg = sum / count
    List history = (baseline.history instanceof List) ? baseline.history : []
    history = history.findAll { it?.day && it.day != baseline.currentDay }
    history << [day: baseline.currentDay, avg: avg]
    history.sort { it.day }
    baseline.history = history
    enforcePressureBaselineLimit(baseline)
}

private void enforcePressureBaselineLimit(Map baseline) {
    List history = (baseline?.history instanceof List) ? baseline.history : []
    Integer keep = (settings.pressureBaselineDays ?: 30) as Integer
    if (keep > 0 && history.size() > keep) {
        history = history.sort { it.day }.takeRight(keep)
        baseline.history = history
    }
}

private Map computePressureBaselineSummary(String unit) {
    def baseline = normalizePressureBaselineState(state.pressureBaseline)
    enforcePressureBaselineLimit(baseline)

    List history = (baseline.history instanceof List) ? baseline.history : []
    history = history.sort { it.day }

    BigDecimal dailyAverage = null
    Integer count = (baseline.dailyCount ?: 0) as Integer
    if (count && baseline.dailySum != null) {
        BigDecimal sum = (baseline.dailySum as BigDecimal)
        if (sum != null && count > 0) {
            dailyAverage = sum / count
        }
    }
    if (dailyAverage == null && history) {
        def last = history.last()
        dailyAverage = toBigDecimal(last?.avg)
    }

    List<BigDecimal> values = history.collect { toBigDecimal(it?.avg) }.findAll { it != null }
    BigDecimal thirtyDayAverage = null
    if (values) {
        BigDecimal sum = values.inject(0.0G) { acc, val -> acc + val }
        thirtyDayAverage = sum / values.size()
    } else {
        thirtyDayAverage = dailyAverage
    }

    BigDecimal tendency = null
    if (dailyAverage != null && thirtyDayAverage != null) {
        tendency = dailyAverage - thirtyDayAverage
    }

    BigDecimal tendencyHpa = convertPressureToHpa(tendency, unit ?: baseline.lastUnit)
    def forecast = determineBaselineForecast(tendencyHpa)

    boolean hasSamples = (count ?: 0) > 0 || (values && !values.isEmpty())
    if (!hasSamples && dailyAverage == null && thirtyDayAverage == null) {
        state.pressureBaseline = baseline
        return null
    }

    Map result = [
        dailyAverage      : dailyAverage,
        thirtyDayAverage  : thirtyDayAverage,
        tendencyInHg      : tendency,
        tendencyHpa       : tendencyHpa,
        trendText         : forecast.trendText,
        iconKey           : forecast.key,
        iconLabel         : forecast.label,
        forecastText      : forecast.text
    ]

    if (values) {
        result.historyDays = values.size()
    }

    state.pressureBaseline = baseline
    return result.findAll { it.value != null }
}

private Map determineBaselineForecast(BigDecimal tendencyHpa) {
    BigDecimal value = tendencyHpa != null ? tendencyHpa : 0.0G
    String trendText
    if (value > 1.0G) {
        trendText = "Rising"
    } else if (value < -1.0G) {
        trendText = "Falling"
    } else {
        trendText = "Steady"
    }

    String key
    String label
    String text

    if (value >= 3.0G) {
        key = "sunny"
        label = "Sunny"
        text = "Pressure well above normal — clearing skies likely."
    } else if (value >= 1.0G) {
        key = "partly"
        label = "Partly Cloudy"
        text = "Pressure rising versus recent days — improving trend."
    } else if (value > -1.0G) {
        key = "cloudy"
        label = "Cloudy"
        text = "Pressure near seasonal baseline — conditions steady."
    } else if (value > -3.0G) {
        key = "rainy"
        label = "Rain"
        text = "Pressure below normal — showers possible."
    } else {
        key = "stormy"
        label = "Stormy"
        text = "Pressure far below normal — storms increasingly likely."
    }

    [key: key, label: label, text: text, trendText: trendText]
}

private String buildTrendNarrative(Map trend) {
    if (!trend) return null
    String label = trend.label
    if (!label) return null
    switch (label) {
        case "Rising Rapidly":
            return "Pressure rising rapidly now."
        case "Rising":
            return "Pressure rising steadily."
        case "Falling Rapidly":
            return "Pressure falling rapidly now."
        case "Falling":
            return "Pressure falling steadily."
        default:
            return null
    }
}

private String buildHumidityNote(BigDecimal humidity) {
    if (humidity == null) return null
    if (humidity >= 85) {
        return "High humidity could support fog or drizzle."
    }
    if (humidity <= 35) {
        return "Dry air may keep skies clear."
    }
    return null
}

private String truncateSummary(String text, int maxLength) {
    if (text == null) return null
    String trimmed = text.trim()
    if (!trimmed) return null
    if (maxLength <= 0 || trimmed.length() <= maxLength) {
        return trimmed
    }
    int end = Math.max(0, maxLength - 1)
    String shortened = trimmed.substring(0, end).trim()
    return shortened ? shortened + '…' : trimmed.substring(0, maxLength)
}

private Map computePressureTrend(long timestamp) {
    def history = (state.pressureHistory ?: []) as List
    if (!history) return null
    def pressureEntry = history.last()
    if (!pressureEntry) return null
    BigDecimal current = pressureEntry.pressure
    if (current == null) return null

    def hours = (settings.pressureTrendHours ?: 3) as Integer
    def cutoff = timestamp - (hours * 60 * 60 * 1000L)
    def comparison = history.find { it.time >= cutoff }
    if (!comparison) {
        comparison = history.first()
    }
    if (!comparison || comparison.pressure == null) return null

    def elapsedHours = ((pressureEntry.time - comparison.time) / 3600000.0)
    if (elapsedHours <= 0) elapsedHours = hours
    def change = current - comparison.pressure
    def rate = change / elapsedHours

    String label
    if (rate >= 0.03) {
        label = "Rising Rapidly"
    } else if (rate >= 0.01) {
        label = "Rising"
    } else if (rate <= -0.03) {
        label = "Falling Rapidly"
    } else if (rate <= -0.01) {
        label = "Falling"
    } else {
        label = "Steady"
    }

    [
        ratePerHour: rate,
        changeTotal: change,
        label: label
    ]
}

private Map computeOutlook(BigDecimal pressure, Map trend, BigDecimal humidity, Map baseline, String unit) {
    Map baselineInfo = baseline ?: computePressureBaselineSummary(unit)
    String trendNarrative = buildTrendNarrative(trend)
    String humidityNote = buildHumidityNote(humidity)

    String baselineNarrative = baselineInfo?.forecastText
    String summary = [trendNarrative, baselineNarrative, humidityNote].findAll { it }
        .join(' ')

    if (!summary) {
        if (pressure != null) {
            if (pressure >= 30.2) {
                summary = "High pressure dominant — fair skies expected."
            } else if (pressure <= 29.5) {
                summary = "Low pressure system — clouds or rain possible."
            }
        }
    }

    if (!summary) {
        summary = "Little pressure change — current conditions likely to persist."
    }

    String shortSummary
    String trendLabel = trend?.label
    if (trendLabel && trendLabel != 'Steady') {
        shortSummary = trendLabel
        if (baselineInfo?.iconLabel) {
            shortSummary = "${shortSummary} • ${baselineInfo.iconLabel}"
        }
    } else if (baselineInfo?.iconLabel) {
        shortSummary = baselineInfo.iconLabel
    }

    if (humidityNote && !shortSummary) {
        shortSummary = humidityNote
    }

    shortSummary = truncateSummary(shortSummary ?: summary, 40)

    Map baselinePayload = [:]
    if (baselineInfo?.dailyAverage != null) {
        baselinePayload.dailyAverageInHg = round(baselineInfo.dailyAverage, 3)
    }
    if (baselineInfo?.thirtyDayAverage != null) {
        baselinePayload.thirtyDayAverageInHg = round(baselineInfo.thirtyDayAverage, 3)
    }
    if (baselineInfo?.tendencyInHg != null) {
        baselinePayload.tendencyInHg = round(baselineInfo.tendencyInHg, 3)
    }
    if (baselineInfo?.tendencyHpa != null) {
        baselinePayload.tendencyHpa = round(baselineInfo.tendencyHpa, 1)
    }
    if (baselineInfo?.trendText) {
        baselinePayload.trend = baselineInfo.trendText
    }
    if (baselineInfo?.iconKey) {
        baselinePayload.iconKey = baselineInfo.iconKey
    }
    if (baselineInfo?.iconLabel) {
        baselinePayload.iconLabel = baselineInfo.iconLabel
    }
    if (baselineInfo?.forecastText) {
        baselinePayload.forecastText = baselineInfo.forecastText
    }

    def category = baselineInfo?.iconLabel ?: (trendLabel ?: 'Stable')

    Map result = [
        category    : category,
        summary     : summary,
        shortSummary: shortSummary,
        iconKey     : baselineInfo?.iconKey,
        iconLabel   : baselineInfo?.iconLabel,
        trendLabel  : trendLabel,
        humidityNote: humidityNote
    ]

    if (baselinePayload) {
        result.baseline = baselinePayload
    }

    return result.findAll { it.value != null }
}

private Map computeMoonPhase(Date reference, TimeZone tz, BigDecimal latitude, BigDecimal longitude) {
    if (!reference) return null

    final long millisPerDay = 86_400_000L
    final double twoPi = Math.PI * 2D
    final double synodicMonthDays = 29.530588853D

    TimeZone zone = tz ?: UTC_ZONE
    long millis = reference.time
    long utcMillis = millis - zone.getOffset(millis)

    Calendar cal = Calendar.getInstance(UTC_ZONE)
    cal.set(Calendar.YEAR, 2000)
    cal.set(Calendar.MONTH, Calendar.JANUARY)
    cal.set(Calendar.DAY_OF_MONTH, 6)
    cal.set(Calendar.HOUR_OF_DAY, 18)
    cal.set(Calendar.MINUTE, 14)
    cal.set(Calendar.SECOND, 0)
    cal.set(Calendar.MILLISECOND, 0)
    long knownNewMoonMs = cal.timeInMillis

    double daysSince = (utcMillis - knownNewMoonMs) / (double) millisPerDay
    if (!Double.isFinite(daysSince)) return null

    double phaseDays = daysSince % synodicMonthDays
    if (phaseDays < 0) {
        phaseDays += synodicMonthDays
    }

    double phaseFraction = phaseDays / synodicMonthDays
    double illumination = 0.5D * (1 - Math.cos(twoPi * phaseFraction))
    double phaseAngle = (phaseFraction * 360.0D) % 360.0D
    if (phaseAngle < 0) {
        phaseAngle += 360.0D
    }

    boolean waxing = phaseFraction < 0.5D

    List phaseBounds = [
        [limit: 1.84566D, key: 'new-moon', name: 'New Moon'],
        [limit: 5.53699D, key: 'waxing-crescent', name: 'Waxing Crescent'],
        [limit: 9.22831D, key: 'first-quarter', name: 'First Quarter'],
        [limit: 12.91963D, key: 'waxing-gibbous', name: 'Waxing Gibbous'],
        [limit: 16.61096D, key: 'full-moon', name: 'Full Moon'],
        [limit: 20.30228D, key: 'waning-gibbous', name: 'Waning Gibbous'],
        [limit: 23.99361D, key: 'last-quarter', name: 'Last Quarter'],
        [limit: 27.68493D, key: 'waning-crescent', name: 'Waning Crescent'],
        [limit: synodicMonthDays + 0.0001D, key: 'new-moon', name: 'New Moon']
    ]

    def phaseDef = phaseBounds.find { phaseDays < (it.limit as double) }
    if (!phaseDef) {
        phaseDef = phaseBounds[phaseBounds.size() - 1]
    }

    def result = [
        phase              : phaseDef.name,
        phaseKey           : phaseDef.key,
        ageDays            : round(phaseDays, 2),
        illuminationFraction: round(illumination, 4),
        illuminationPercent: round(illumination * 100.0D, 1),
        phaseAngle         : round(phaseAngle, 2),
        waxing             : waxing
    ]

    if (latitude != null) {
        BigDecimal lat = latitude as BigDecimal
        result.hemisphere = lat < 0 ? 'southern' : 'northern'
    }

    return result
}

private void updateTemperatureHistory(BigDecimal temperature, long timestamp) {
    def history = (state.temperatureHistory ?: []) as List
    def cutoff = timestamp - (6 * 60 * 60 * 1000L)
    history = history.findAll { it.time >= cutoff }
    if (temperature != null) {
        history << [time: timestamp, temperature: temperature as BigDecimal]
    }
    state.temperatureHistory = history
}

private Map updateDailyOutdoorExtrema(BigDecimal temperature, long timestamp, TimeZone tz) {
    def record = (state.dailyOutdoorTemp ?: [:]) as Map
    def dayKey = dayKeyFor(timestamp, tz)
    if (!record.day || record.day != dayKey) {
        record = [day: dayKey, high: null, low: null]
    }
    if (temperature != null) {
        def rounded = round(temperature, 1)
        if (record.high == null || rounded > record.high) {
            record.high = rounded
        }
        if (record.low == null || rounded < record.low) {
            record.low = rounded
        }
    }
    record.updatedAt = timestamp
    state.dailyOutdoorTemp = record
    record
}

private Map updateDailyAQExtrema(String type, Map<String, BigDecimal> values, long timestamp, TimeZone tz) {
    def stateKey = (type == "indoor") ? "dailyIndoorAQ" : "dailyOutdoorAQ"
    def record = (state[stateKey] ?: [:]) as Map
    def dayKey = dayKeyFor(timestamp, tz)

    if (!record.day || record.day != dayKey) {
        record = [day: dayKey]
    }

    values.each { key, value ->
        if (value != null) {
            def peakKey = "${key}Peak"
            def rounded = (key == "aqi" || key == "carbonDioxide") ? Math.round(value) : round(value, 1)
            if (record[peakKey] == null || rounded > record[peakKey]) {
                record[peakKey] = rounded
            }
        }
    }

    record.updatedAt = timestamp
    state[stateKey] = record
    return record
}

private String dayKeyFor(long timestamp, TimeZone tz) {
    def formatter = new SimpleDateFormat("yyyy-MM-dd")
    formatter.setTimeZone(tz ?: TimeZone.getTimeZone('UTC'))
    formatter.format(new Date(timestamp))
}

private BigDecimal computeTemperatureTrend() {
    def history = (state.temperatureHistory ?: []) as List
    if (!history || history.size() < 2) return null
    def latest = history.last()
    def hourAgo = history.find { it.time <= (latest.time - 60 * 60 * 1000L) }
    if (!hourAgo) return null
    def delta = latest.temperature - hourAgo.temperature
    def hours = (latest.time - hourAgo.time) / 3600000.0
    if (hours <= 0) return null
    (delta / hours) as BigDecimal
}

private String degreesToCardinal(double deg) {
    def dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
    int index = Math.round(((deg % 360) / 22.5) as float) % dirs.size()
    dirs[index]
}

private BigDecimal cardinalToDegrees(String cardinal) {
    if (!cardinal) return null
    def lookup = [
        N: 0, NNE: 22.5, NE: 45, ENE: 67.5,
        E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
        S: 180, SSW: 202.5, SW: 225, WSW: 247.5,
        W: 270, WNW: 292.5, NW: 315, NNW: 337.5
    ]
    def key = cardinal.trim().toUpperCase()
    return lookup[key]
}

private static BigDecimal convertPressureToHpa(BigDecimal value, String unit) {
    if (value == null) return null
    switch ((unit ?: "inHg").toLowerCase()) {
        case "inhg":
            return value * 33.8638866667G
        case "mmhg":
            return value * 1.3332239G
        case "kpa":
            return value * 10.0G
        case "mbar":
        case "mb":
        case "hpa":
            return value
        default:
            return value
    }
}

private String htmlEncode(String value) {
    if (!value) return ''
    value.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
}

def diagnosticsPage() {
    refreshWeatherData()
    dynamicPage(name: "diagnosticsPage", title: "Diagnostics", install: false, uninstall: false) {
        section("Latest Payload") {
            def payload = state.lastPrettyPayload ?: 'No payload generated yet. Please save settings and refresh.'
            paragraph "<pre style='white-space:pre-wrap;font-family:monospace;'>${htmlEncode(payload)}</pre>"
        }
    }
}
