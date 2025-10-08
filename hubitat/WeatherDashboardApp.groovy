/*
 * WeatherDashboardApp.groovy
 *
 * Aggregates Hubitat weather device data, computes derived statistics, and publishes
 * a JSON payload for consumption by the Weather Dashboard driver/JS tile.
 */

import groovy.json.JsonOutput
import java.math.RoundingMode

definition(
    name: "Weather Dashboard App",
    namespace: "ecowitt-dashboard",
    author: "OpenAI",
    description: "Aggregates weather data for the JavaScript dashboard tile.",
    category: "Convenience",
    importUrl: "https://raw.githubusercontent.com/<owner>/ecowitt_weather_hubitat_dashboard/main/hubitat/WeatherDashboardApp.groovy",
    iconUrl: "https://raw.githubusercontent.com/<owner>/ecowitt_weather_hubitat_dashboard/main/assets/weather-dashboard-icon.svg",
    iconX2Url: "https://raw.githubusercontent.com/<owner>/ecowitt_weather_hubitat_dashboard/main/assets/weather-dashboard-icon.svg"
)

preferences {
    page(name: "mainPage", title: "Weather Dashboard", install: true, uninstall: true)
}

def mainPage() {
    dynamicPage(name: "mainPage") {
        section("Weather data source") {
            input name: "weatherDevice", type: "capability.sensor", title: "Primary weather device", required: true, submitOnChange: true
        }

        section("Attribute mapping (override if your driver uses different names)") {
            input name: "attrOutdoorTemp", type: "text", title: "Outdoor temperature attribute", defaultValue: "temperature"
            input name: "attrFeelsLike", type: "text", title: "Feels like attribute", defaultValue: "feelsLike"
            input name: "attrDewPoint", type: "text", title: "Dew point attribute", defaultValue: "dewPoint"
            input name: "attrOutdoorHumidity", type: "text", title: "Outdoor humidity attribute", defaultValue: "humidity"
            input name: "attrIndoorTemp", type: "text", title: "Indoor temperature attribute", defaultValue: "temperatureIndoor"
            input name: "attrIndoorHumidity", type: "text", title: "Indoor humidity attribute", defaultValue: "humidityIndoor"
            input name: "attrWindSpeed", type: "text", title: "Wind speed attribute", defaultValue: "windSpeed"
            input name: "attrWindGust", type: "text", title: "Wind gust attribute", defaultValue: "windGust"
            input name: "attrWindDirection", type: "text", title: "Wind direction (cardinal) attribute", defaultValue: "windDirection"
            input name: "attrWindDirectionDegrees", type: "text", title: "Wind direction (degrees) attribute", defaultValue: "windDirectionDegrees"
            input name: "attrPressure", type: "text", title: "Relative pressure attribute", defaultValue: "pressure"
            input name: "attrAbsolutePressure", type: "text", title: "Absolute pressure attribute", defaultValue: "pressureAbsolute"
            input name: "attrRainRate", type: "text", title: "Rain rate (per hour) attribute", defaultValue: "rainRate"
            input name: "attrRainDaily", type: "text", title: "Daily rain attribute", defaultValue: "rainDaily"
            input name: "attrRainWeekly", type: "text", title: "Weekly rain attribute", defaultValue: "rainWeekly"
            input name: "attrRainMonthly", type: "text", title: "Monthly rain attribute", defaultValue: "rainMonthly"
            input name: "attrUVIndex", type: "text", title: "UV index attribute", defaultValue: "uv"
            input name: "attrSolarRadiation", type: "text", title: "Solar radiation attribute", defaultValue: "solarRadiation"
            input name: "attrAQI", type: "text", title: "Air quality index attribute", defaultValue: "aqi"
            input name: "attrPM25", type: "text", title: "PM2.5 attribute", defaultValue: "pm25"
            input name: "attrSunrise", type: "text", title: "Sunrise attribute", defaultValue: "sunrise"
            input name: "attrSunset", type: "text", title: "Sunset attribute", defaultValue: "sunset"
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
    if (!settings.weatherDevice) {
        log.warn "Weather device not configured yet"
        return
    }

    createOrUpdateChildDevice()
    state.windHistory = state.windHistory ?: []
    state.pressureHistory = state.pressureHistory ?: []
    state.temperatureHistory = state.temperatureHistory ?: []

    subscribeToSource()
    runEvery1Minute("refreshWeatherData")
    runIn(5, "refreshWeatherData")
}

private void subscribeToSource() {
    def attrs = getConfiguredAttributes()
    attrs.each { attr ->
        try {
            if (attr) {
                subscribe(settings.weatherDevice, attr, "handleWeatherEvent")
            }
        } catch (Throwable t) {
            log.debug "Unable to subscribe to ${attr}: ${t.message}"
        }
    }
}

private Set<String> getConfiguredAttributes() {
    [
        settings.attrOutdoorTemp,
        settings.attrFeelsLike,
        settings.attrDewPoint,
        settings.attrOutdoorHumidity,
        settings.attrIndoorTemp,
        settings.attrIndoorHumidity,
        settings.attrWindSpeed,
        settings.attrWindGust,
        settings.attrWindDirection,
        settings.attrWindDirectionDegrees,
        settings.attrPressure,
        settings.attrAbsolutePressure,
        settings.attrRainRate,
        settings.attrRainDaily,
        settings.attrRainWeekly,
        settings.attrRainMonthly,
        settings.attrUVIndex,
        settings.attrSolarRadiation,
        settings.attrAQI,
        settings.attrPM25,
        settings.attrSunrise,
        settings.attrSunset
    ].findAll { it }
}

def handleWeatherEvent(evt) {
    // Debounce frequent events by scheduling a refresh shortly after the last update.
    runIn(2, "refreshWeatherData")
}

def refreshWeatherData() {
    def weather = settings.weatherDevice
    if (!weather) {
        log.warn "No weather device configured"
        return
    }

    def now = now()
    def tz = location?.timeZone ?: TimeZone.getTimeZone('UTC')
    def generated = new Date(now)
    def payload = [:]

    def outdoor = [:]
    def tempF = readDecimal(weather, settings.attrOutdoorTemp)
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

    def feels = readDecimal(weather, settings.attrFeelsLike)
    if (feels != null) outdoor.feelsLikeF = round(feels, 1)

    def dew = readDecimal(weather, settings.attrDewPoint)
    if (dew != null) outdoor.dewPointF = round(dew, 1)

    def humidity = readDecimal(weather, settings.attrOutdoorHumidity)
    if (humidity != null) outdoor.humidity = round(humidity, 1)

    if (outdoor) payload.outdoor = outdoor

    def indoor = [:]
    def indoorTemp = readDecimal(weather, settings.attrIndoorTemp)
    if (indoorTemp != null) indoor.temperatureF = round(indoorTemp, 1)
    def indoorHum = readDecimal(weather, settings.attrIndoorHumidity)
    if (indoorHum != null) indoor.humidity = round(indoorHum, 1)
    if (indoor) payload.indoor = indoor

    def wind = [:]
    def windSpeed = readDecimal(weather, settings.attrWindSpeed)
    if (windSpeed != null) {
        wind.speedMph = round(windSpeed, 1)
    }
    def windGust = readDecimal(weather, settings.attrWindGust)
    if (windGust != null) {
        wind.gustMph = round(windGust, 1)
    }

    def directionDegrees = readDecimal(weather, settings.attrWindDirectionDegrees)
    def directionText = readString(weather, settings.attrWindDirection)
    if (directionDegrees == null && directionText) {
        directionDegrees = cardinalToDegrees(directionText)
    }
    if (directionDegrees != null) {
        wind.directionDegrees = round(directionDegrees, 1)
        wind.directionCardinal = degreesToCardinal(directionDegrees)
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
    def relPressure = readDecimal(weather, settings.attrPressure)
    if (relPressure != null) {
        pressure.relativeInHg = round(relPressure, 2)
    }
    def absPressure = readDecimal(weather, settings.attrAbsolutePressure)
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
    def rainRate = readDecimal(weather, settings.attrRainRate)
    if (rainRate != null) rain.rateInPerHour = round(rainRate, 2)
    def rainDaily = readDecimal(weather, settings.attrRainDaily)
    if (rainDaily != null) rain.dailyIn = round(rainDaily, 2)
    def rainWeekly = readDecimal(weather, settings.attrRainWeekly)
    if (rainWeekly != null) rain.weeklyIn = round(rainWeekly, 2)
    def rainMonthly = readDecimal(weather, settings.attrRainMonthly)
    if (rainMonthly != null) rain.monthlyIn = round(rainMonthly, 2)
    if (rain) payload.rain = rain

    def solar = [:]
    def uv = readDecimal(weather, settings.attrUVIndex)
    if (uv != null) solar.uvIndex = round(uv, 1)
    def solarRad = readDecimal(weather, settings.attrSolarRadiation)
    if (solarRad != null) solar.solarRadiationWm2 = round(solarRad, 1)
    if (solar) payload.solar = solar

    def air = [:]
    def aqi = readDecimal(weather, settings.attrAQI)
    if (aqi != null) air.aqi = Math.round(aqi)
    def pm25 = readDecimal(weather, settings.attrPM25)
    if (pm25 != null) air.pm25 = round(pm25, 1)
    if (air) payload.airQuality = air

    def sun = [:]
    def sunrise = readString(weather, settings.attrSunrise)
    if (sunrise) sun.sunrise = sunrise
    def sunset = readString(weather, settings.attrSunset)
    if (sunset) sun.sunset = sunset
    if (sun) payload.sun = sun

    if (!payload.outlook24h) {
        def outlook = computeOutlook(payload.pressure?.relativeInHg ?: payload.pressure?.absoluteInHg, trend?.ratePerHour, outdoor?.humidity)
        if (outlook) payload.outlook24h = outlook
    }

    payload.metadata = [
        generatedAt: generated.format("yyyy-MM-dd'T'HH:mm:ssXXX", tz),
        sourceDevice: [
            id: weather.id,
            name: weather.displayName
        ]
    ]

    def json = JsonOutput.toJson(payload)
    def pretty = JsonOutput.prettyPrint(json)

    state.lastPayload = payload
    state.lastPrettyPayload = pretty

    def child = getChildDevice(childDeviceDni())
    if (child) {
        child.updateDashboardData(json, pretty)
    }
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
