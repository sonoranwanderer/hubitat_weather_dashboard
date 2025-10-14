/*
 * WeatherDashboardApp.groovy
 *
 * Aggregates Hubitat weather device data, computes derived statistics, and publishes
 * a JSON payload for consumption by the Weather Dashboard driver/JS tile.
 */

import groovy.json.JsonOutput
import java.math.RoundingMode
import java.text.SimpleDateFormat
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

preferences {
    page(name: "mainPage", title: "Weather Dashboard", install: true, uninstall: true)
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
        }

        section("Dashboard device") {
            input name: "dashboardDeviceLabel", type: "text", title: "Dashboard device label", defaultValue: "Weather Dashboard"
        }

        if (state?.lastPrettyPayload) {
            section("Latest payload preview") {
                paragraph "<pre style='white-space:pre-wrap;font-family:monospace;'>${htmlEncode(state.lastPrettyPayload)}</pre>"
            }
        }

        section("Actions") {
            href "refreshNow", title: "Refresh data now", description: "Tap to recompute and push the dashboard payload"
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

def refreshNow() {
    refreshWeatherData()
    return dynamicPage(name: "refreshNow") {
        section("Refresh queued") {
            paragraph "The dashboard payload will update momentarily."
        }
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
    def tz = location?.timeZone ?: TimeZone.getTimeZone('UTC')
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
    def relPressure = readDecimalFor("attrPressure")
    if (relPressure != null) {
        pressure.relativeInHg = round(relPressure, 2)
    }
    def absPressure = readDecimalFor("attrAbsolutePressure")
    if (absPressure != null) {
        pressure.absoluteInHg = round(absPressure, 2)
    }
    updatePressureHistory(relPressure ?: absPressure, now)
    def trend = computePressureTrend(now)
    if (trend) {
        pressure.trendInHgPerHour = round(trend.ratePerHour, 3)
        pressure.trend = trend.label
        if (trend.changeTotal != null) {
            pressure.changeInTrendWindow = round(trend.changeTotal, 3)
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
    if (solar) payload.solar = solar

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
    
    def sun = [:]
    def sunriseDate = location?.sunrise
    if (sunriseDate) sun.sunrise = formatDateTime(sunriseDate, tz)
    def sunsetDate = location?.sunset
    if (sunsetDate) sun.sunset = formatDateTime(sunsetDate, tz)
    if (sun) payload.sun = sun

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
        def outlook = computeOutlook(payload.pressure?.relativeInHg ?: payload.pressure?.absoluteInHg, trend?.ratePerHour, outdoor?.humidity)
        if (outlook) payload.outlook24h = outlook
    }

    def ambient = buildAmbientSensorsPayload()
    if (ambient?.sensors) {
        payload.ambientSensors = ambient.sensors
        if (ambient.rotationSeconds) payload.ambientRotationSeconds = ambient.rotationSeconds
        if (ambient.temperatureUnit) payload.ambientTemperatureUnit = ambient.temperatureUnit
        if (ambient.humidityUnit) payload.ambientHumidityUnit = ambient.humidityUnit
    }

    def metadata = [
        generatedAt: generated.format("yyyy-MM-dd'T'HH:mm:ssXXX", tz),
        sourceDevices: devices.collect { dev -> [id: dev.id, name: dev.displayName] }
    ]
    def primary = primaryWeatherDevice()
    if (primary) {
        metadata.sourceDevice = [id: primary.id, name: primary.displayName]
        metadata.primaryDeviceId = primary.id
    }
    payload.metadata = metadata

    def json = JsonOutput.toJson(payload)
    def pretty = JsonOutput.prettyPrint(json)

    state.lastPayload = payload
    state.lastPrettyPayload = pretty

    def child = getChildDevice(childDeviceDni())
    if (child) {
        child.updateDashboardData(json, pretty)
    }
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

private Map computeOutlook(BigDecimal pressure, BigDecimal rate, BigDecimal humidity) {
    if (pressure == null && rate == null) return null
    def summary
    def category
    def trend = rate ?: 0

    if (trend >= 0.03) {
        category = "Improving"
        summary = "Pressure rising quickly — improving weather expected."
    } else if (trend >= 0.01) {
        category = "Fair"
        summary = "Pressure rising — conditions should gradually improve."
    } else if (trend <= -0.03) {
        category = "Stormy"
        summary = "Pressure falling quickly — unsettled weather likely within 24 hours."
    } else if (trend <= -0.01) {
        category = "Unsettled"
        summary = "Pressure falling — precipitation possible in the next day."
    } else if (pressure != null) {
        if (pressure >= 30.2) {
            category = "Fair"
            summary = "High pressure dominant — fair skies expected."
        } else if (pressure <= 29.5) {
            category = "Unsettled"
            summary = "Low pressure system — clouds or rain possible."
        }
    }

    if (!category) {
        category = "Stable"
        summary = "Little pressure change — current conditions likely to persist."
    }

    def humidityNote = null
    if (humidity != null) {
        if (humidity >= 85) {
            humidityNote = "High humidity could support fog or drizzle."
        } else if (humidity <= 35) {
            humidityNote = "Dry air may keep skies clear."
        }
    }

    if (humidityNote) {
        summary = summary + " " + humidityNote
    }

    [category: category, summary: summary]
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

private String htmlEncode(String value) {
    if (!value) return ''
    value.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
}
