/*
 * Pressure Tendency App
 * Calculates barometric tendency and 24 hour forecast approximation using Ecowitt data.
 */

import groovy.json.JsonOutput
import java.math.RoundingMode

definition(
    name: "Pressure Tendency App",
    namespace: "ecowitt",
    author: "OpenAI",
    description: "Calculates pressure tendency & forecast for dashboard tile",
    category: "Convenience",
    iconUrl: "",
    iconX2Url: "",
    iconX3Url: ""
)

preferences {
    page(name: "mainPage")
}

def mainPage() {
    dynamicPage(name: "mainPage", title: "Pressure Tendency", install: true, uninstall: true) {
        section("Pressure source") {
            input name: "sourceDevice", type: "capability.sensor", title: "Weather source device", required: true, submitOnChange: true
            input name: "referenceAttribute", type: "enum", title: "Reference pressure attribute", required: true,
                options: [["relative": "Relative"], ["absolute": "Absolute"]], defaultValue: "relative"
            input name: "relativeAttribute", type: "text", title: "Relative pressure attribute name", required: true, defaultValue: "pressure"
            input name: "absoluteAttribute", type: "text", title: "Absolute pressure attribute name", required: false, defaultValue: "pressureAbsolute"
            input name: "unitOverride", type: "enum", title: "Override units", required: false,
                options: ["", "inHg", "hPa", "mbar", "kPa", "mmHg"]
        }
        section("Virtual device") {
            input name: "targetDevice", type: "capability.sensor", title: "Pressure tendency virtual device", required: true
        }
        section("Advanced options") {
            input name: "historyLength", type: "number", title: "Days to keep in 30-day history", required: true, defaultValue: 30
        }
        section("About") {
            paragraph "Updates run when new pressure events are received. The 30-day history is built opportunistically from live data."
        }
    }
}

def installed() {
    initialize()
}

def updated() {
    unsubscribe()
    unschedule()
    initialize()
}

def initialize() {
    state.history = (state.history instanceof List) ? state.history : []
    state.currentDay = state.currentDay ?: currentDay()
    state.dailyCount = state.dailyCount ?: 0
    state.dailySum = state.dailySum ?: 0.0G
    subscribeToPressure()
}

private void subscribeToPressure() {
    if (!sourceDevice) {
        log.warn "Pressure Tendency App: no source device selected"
        return
    }
    if (relativeAttribute) {
        subscribe(sourceDevice, relativeAttribute, "handlePressureEvent")
    }
    if (absoluteAttribute && absoluteAttribute != relativeAttribute) {
        subscribe(sourceDevice, absoluteAttribute, "handlePressureEvent")
    }
}

def handlePressureEvent(evt) {
    try {
        processPressure()
    } catch (Throwable t) {
        log.error "Pressure Tendency App failed to process pressure", t
    }
}

private void processPressure() {
    Map readings = readCurrentPressures()
    if (!readings.reference) {
        log.debug "Pressure Tendency App: waiting for reference pressure value"
        return
    }

    BigDecimal reference = readings.reference as BigDecimal
    BigDecimal relative = readings.relative as BigDecimal
    BigDecimal absolute = readings.absolute as BigDecimal
    String unit = resolveUnit(readings.unit)

    updateDailyStats(reference)

    BigDecimal dailyAverage = computeDailyAverage()
    BigDecimal avg30 = computeThirtyDayAverage(dailyAverage)
    BigDecimal tendency = (dailyAverage != null && avg30 != null) ? (dailyAverage - avg30) : 0.0G

    Map forecast = determineForecast(tendency, unit)
    Map summary = buildSummary(relative, absolute, unit, tendency, dailyAverage, avg30, forecast)

    if (targetDevice?.hasCommand("updatePressure")) {
        BigDecimal tendencyValue = convertFromHpa(summary.tendencyHpa, unit)
        if (tendencyValue != null) {
            tendencyValue = tendencyValue.setScale(3, RoundingMode.HALF_UP)
        }
        BigDecimal dailyRounded = dailyAverage != null ? dailyAverage.setScale(3, RoundingMode.HALF_UP) : null
        BigDecimal avg30Rounded = avg30 != null ? avg30.setScale(3, RoundingMode.HALF_UP) : null

        targetDevice.updatePressure(relative, absolute, unit, tendencyValue,
            summary.tendencyText, dailyRounded, avg30Rounded,
            forecast.key, forecast.text, JsonOutput.toJson(summary.publicData))
    }
}

private Map readCurrentPressures() {
    Map result = [relative: null, absolute: null, reference: null, unit: null]
    if (relativeAttribute) {
        result.relative = parseBigDecimal(sourceDevice?.currentValue(relativeAttribute))
        result.unit = sourceDevice?.currentUnit(relativeAttribute) ?: result.unit
    }
    if (absoluteAttribute) {
        result.absolute = parseBigDecimal(sourceDevice?.currentValue(absoluteAttribute))
        result.unit = sourceDevice?.currentUnit(absoluteAttribute) ?: result.unit
    }
    if ("absolute" == referenceAttribute) {
        result.reference = result.absolute ?: result.relative
    } else {
        result.reference = result.relative ?: result.absolute
    }
    return result
}

private String resolveUnit(String eventUnit) {
    String unit = unitOverride
    if (!unit) {
        unit = eventUnit
    }
    if (!unit) {
        unit = state.lastUnit ?: "inHg"
    }
    state.lastUnit = unit
    return unit
}

private void updateDailyStats(BigDecimal reference) {
    String today = currentDay()
    if (state.currentDay != today) {
        finalizeCurrentDay()
        state.currentDay = today
        state.dailySum = 0.0G
        state.dailyCount = 0
    }
    state.dailySum = (state.dailySum as BigDecimal) + reference
    state.dailyCount = (state.dailyCount as Integer) + 1
}

private void finalizeCurrentDay() {
    if (state.dailyCount && (state.dailyCount as Integer) > 0) {
        BigDecimal avg = (state.dailySum as BigDecimal) / (state.dailyCount as Integer)
        List history = (state.history ?: []) as List
        history = history.findAll { it?.date != state.currentDay }
        history << [date: state.currentDay, avg: avg]
        history.sort { it.date }
        Integer keep = (historyLength ?: 30) as Integer
        if (keep > 0 && history.size() > keep) {
            history = history.takeRight(keep)
        }
        state.history = history
    }
}

private BigDecimal computeDailyAverage() {
    if (state.dailyCount && (state.dailyCount as Integer) > 0) {
        return (state.dailySum as BigDecimal) / (state.dailyCount as Integer)
    }
    List history = (state.history ?: []) as List
    if (!history) {
        return null
    }
    return history?.last()?.avg as BigDecimal
}

private BigDecimal computeThirtyDayAverage(BigDecimal todayAvg) {
    List history = (state.history ?: []) as List
    List values = history?.collect { it.avg as BigDecimal }?.findAll { it != null }
    if (values && !values.isEmpty()) {
        BigDecimal sum = values.inject(0.0G) { acc, val -> acc + val }
        return sum / values.size()
    }
    return todayAvg
}

private Map determineForecast(BigDecimal tendency, String unit) {
    BigDecimal tendencyHpa = convertToHpa(tendency ?: 0.0G, unit)
    String trendText
    if (tendencyHpa > 1.0G) {
        trendText = "Rising"
    } else if (tendencyHpa < -1.0G) {
        trendText = "Falling"
    } else {
        trendText = "Steady"
    }

    String key
    String text
    if (tendencyHpa >= 3.0G) {
        key = "sunny"
        text = "Pressure increases for a sustained period"
    } else if (tendencyHpa >= 1.0G) {
        key = "partly"
        text = "Pressure increasing slightly"
    } else if (tendencyHpa > -1.0G) {
        key = "cloudy"
        text = "Pressure steady"
    } else if (tendencyHpa > -3.0G) {
        key = "rainy"
        text = "Pressure decreasing"
    } else {
        key = "stormy"
        text = "Pressure rapidly decreasing"
    }

    return [key: key, text: text, tendencyHpa: tendencyHpa, trendText: trendText]
}

private Map buildSummary(BigDecimal relative, BigDecimal absolute, String unit, BigDecimal tendency,
                         BigDecimal dailyAverage, BigDecimal avg30, Map forecast) {
    BigDecimal tendencyHpa = convertToHpa(tendency ?: 0.0G, unit)
    String tendencyText = forecast.trendText ?: "Steady"
    BigDecimal tendencyValue = convertFromHpa(tendencyHpa, unit)
    if (tendencyValue != null) {
        tendencyValue = tendencyValue.setScale(3, RoundingMode.HALF_UP)
    }
    BigDecimal dailyRounded = dailyAverage != null ? dailyAverage.setScale(3, RoundingMode.HALF_UP) : null
    BigDecimal avg30Rounded = avg30 != null ? avg30.setScale(3, RoundingMode.HALF_UP) : null

    Map publicData = [
        relative: relative,
        absolute: absolute,
        unit: unit,
        tendency: [value: tendencyValue, text: tendencyText],
        dailyAverage: dailyRounded,
        thirtyDayAverage: avg30Rounded,
        forecast: [key: forecast.key, text: forecast.text]
    ]

    return [
        publicData: publicData,
        tendencyText: tendencyText,
        tendencyHpa: tendencyHpa
    ]
}

private BigDecimal parseBigDecimal(Object value) {
    if (value == null) {
        return null
    }
    if (value instanceof BigDecimal) {
        return value
    }
    if (value instanceof Number) {
        return new BigDecimal(value.toString())
    }
    String str = value.toString()
    def matcher = (str =~ /-?\d+(?:\.\d+)?/)
    if (matcher.find()) {
        try {
            return new BigDecimal(matcher.group())
        } catch (Exception ignored) {
            return null
        }
    }
    return null
}

private String currentDay() {
    TimeZone tz = location?.timeZone ?: TimeZone.getDefault()
    return new Date().format('yyyy-MM-dd', tz)
}

private static BigDecimal convertToHpa(BigDecimal value, String unit) {
    if (value == null) {
        return 0.0G
    }
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

private static BigDecimal convertFromHpa(BigDecimal value, String unit) {
    if (value == null) {
        return null
    }
    switch ((unit ?: "inHg").toLowerCase()) {
        case "inhg":
            return value / 33.8638866667G
        case "mmhg":
            return value / 1.3332239G
        case "kpa":
            return value / 10.0G
        case "mbar":
        case "mb":
        case "hpa":
            return value
        default:
            return value
    }
}
