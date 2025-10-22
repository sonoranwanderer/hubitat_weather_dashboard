/*
 * Pressure Tendency App
 * Calculates barometric tendency and 24 hour forecast approximation using Ecowitt data.
 */

import groovy.json.JsonOutput
import java.math.RoundingMode
import java.math.BigDecimal

private static final BigDecimal HPA_PER_INHG = 33.8638866667G
private static final BigDecimal RAPID_RATE_INHG = 0.03G
private static final BigDecimal MODERATE_RATE_INHG = 0.01G
private static final BigDecimal RAPID_RISE_HPA = HPA_PER_INHG * RAPID_RATE_INHG
private static final BigDecimal MODERATE_RISE_HPA = HPA_PER_INHG * MODERATE_RATE_INHG
private static final BigDecimal RAPID_FALL_HPA = RAPID_RISE_HPA.negate()
private static final BigDecimal MODERATE_FALL_HPA = MODERATE_RISE_HPA.negate()
private static final long ONE_HOUR_MS = 3_600_000L
private static final long TWENTY_FOUR_HOURS_MS = 24L * ONE_HOUR_MS
private static final List ICON_ORDER = ['stormy', 'rainy', 'cloudy', 'partly', 'sunny']
private static final Map ICON_LABELS = [
    sunny : 'Sunny',
    partly: 'Partly Cloudy',
    cloudy: 'Cloudy',
    rainy : 'Rainy',
    stormy: 'Stormy'
]

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
            input name: "pressureTrendHours", type: "number", title: "Short-term trend window (hours)", required: true, defaultValue: 3
            input name: "humidityAttribute", type: "text", title: "Humidity attribute name", required: false, defaultValue: "humidity"
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
    state.pressureHistory = (state.pressureHistory instanceof List) ? state.pressureHistory : []
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
        log.error "Pressure Tendency App failed to process pressure: ${t?.message ?: t}"
        log.debug "Pressure Tendency App exception details: ${t}"
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
    long timestamp = now()

    updateDailyStats(reference)

    BigDecimal dailyAverage = computeDailyAverage()
    BigDecimal avg30 = computeThirtyDayAverage(dailyAverage)
    BigDecimal tendency = (dailyAverage != null && avg30 != null) ? (dailyAverage - avg30) : 0.0G

    Map trend = updateShortTermTrend(reference, unit, timestamp)
    BigDecimal humidity = readCurrentHumidity()
    Map baselineForecast = determineBaselineForecast(tendency, unit)
    Map combinedForecast = combineForecasts(baselineForecast, trend, humidity)
    Map summary = buildSummary(relative, absolute, unit, tendency, dailyAverage, avg30, humidity, baselineForecast, trend, combinedForecast)

    if (targetDevice?.hasCommand("updatePressure")) {
        BigDecimal tendencyValue = convertFromHpa(summary.tendencyHpa, unit)
        if (tendencyValue != null) {
            tendencyValue = tendencyValue.setScale(3, RoundingMode.HALF_UP)
        }
        BigDecimal dailyRounded = dailyAverage != null ? dailyAverage.setScale(3, RoundingMode.HALF_UP) : null
        BigDecimal avg30Rounded = avg30 != null ? avg30.setScale(3, RoundingMode.HALF_UP) : null

        targetDevice.updatePressure(relative, absolute, unit, tendencyValue,
            summary.tendencyText, dailyRounded, avg30Rounded,
            combinedForecast.key, combinedForecast.summary, JsonOutput.toJson(summary.publicData))
    }
}

private Map readCurrentPressures() {
    Map result = [relative: null, absolute: null, reference: null, unit: null]
    if (relativeAttribute) {
        def state = sourceDevice?.currentState(relativeAttribute)
        result.relative = parseBigDecimal(state?.value)
        result.unit = state?.unit ?: result.unit
    }
    if (absoluteAttribute) {
        def state = sourceDevice?.currentState(absoluteAttribute)
        result.absolute = parseBigDecimal(state?.value)
        result.unit = state?.unit ?: result.unit
    }
    if ("absolute" == referenceAttribute) {
        result.reference = result.absolute ?: result.relative
    } else {
        result.reference = result.relative ?: result.absolute
    }
    return result
}

private BigDecimal readCurrentHumidity() {
    if (!humidityAttribute) {
        return null
    }
    def state = sourceDevice?.currentState(humidityAttribute)
    return parseBigDecimal(state?.value)
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

private Map determineBaselineForecast(BigDecimal tendency, String unit) {
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

    return [
        key       : key,
        text      : text,
        trendText : trendText,
        tendencyHpa: tendencyHpa,
        label     : ICON_LABELS[key] ?: key?.capitalize()
    ]
}

private Map updateShortTermTrend(BigDecimal reference, String unit, long timestamp) {
    if (reference == null) {
        return null
    }

    BigDecimal pressureHpa = convertToHpa(reference, unit)
    if (pressureHpa == null) {
        return null
    }

    List history = (state.pressureHistory ?: []) as List
    long cutoff = timestamp - TWENTY_FOUR_HOURS_MS
    history = history.findAll { it?.time instanceof Long && it.time >= cutoff }
    history << [time: timestamp, pressureHpa: pressureHpa]
    state.pressureHistory = history

    if (history.size() < 2) {
        return null
    }

    Integer hours = (pressureTrendHours ?: 3) as Integer
    if (hours == null || hours <= 0) {
        hours = 3
    }
    long windowMs = hours * ONE_HOUR_MS
    Map comparison = history.find { it?.time instanceof Long && it.time >= (timestamp - windowMs) }
    if (!comparison) {
        comparison = history.first()
    }
    if (!comparison?.pressureHpa) {
        return null
    }

    BigDecimal comparisonPressure = comparison.pressureHpa as BigDecimal
    BigDecimal changeHpa = pressureHpa - comparisonPressure
    BigDecimal elapsedHours = BigDecimal.valueOf((timestamp - (comparison.time as Long)) / 3600000.0D)
    if (elapsedHours.compareTo(BigDecimal.ZERO) <= 0) {
        elapsedHours = BigDecimal.valueOf(hours)
    }
    BigDecimal rateHpa = changeHpa.divide(elapsedHours, 6, RoundingMode.HALF_UP)

    String label
    if (rateHpa.compareTo(RAPID_RISE_HPA) >= 0) {
        label = "Rising Rapidly"
    } else if (rateHpa.compareTo(MODERATE_RISE_HPA) >= 0) {
        label = "Rising"
    } else if (rateHpa.compareTo(RAPID_FALL_HPA) <= 0) {
        label = "Falling Rapidly"
    } else if (rateHpa.compareTo(MODERATE_FALL_HPA) <= 0) {
        label = "Falling"
    } else {
        label = "Steady"
    }

    BigDecimal rateNative = convertFromHpa(rateHpa, unit)
    if (rateNative != null) {
        rateNative = rateNative.setScale(3, RoundingMode.HALF_UP)
    }
    BigDecimal changeNative = convertFromHpa(changeHpa, unit)
    if (changeNative != null) {
        changeNative = changeNative.setScale(3, RoundingMode.HALF_UP)
    }

    return [
        label           : label,
        rateHpaPerHour  : rateHpa.setScale(3, RoundingMode.HALF_UP),
        changeHpa       : changeHpa.setScale(3, RoundingMode.HALF_UP),
        windowHours     : hours,
        ratePerHour     : rateNative,
        change          : changeNative
    ]
}

private Map combineForecasts(Map baseline, Map trend, BigDecimal humidity) {
    if (!baseline) {
        baseline = [key: "cloudy", text: "Pressure steady", label: ICON_LABELS.cloudy, trendText: "Steady", tendencyHpa: 0.0G]
    }

    BigDecimal rate = trend?.rateHpaPerHour as BigDecimal
    int adjustment = 0
    String adjustmentReason = null
    String adjustmentDirection = null
    if (rate != null) {
        if (rate.compareTo(RAPID_RISE_HPA) >= 0) {
            adjustment = 2
            adjustmentReason = "Rapid pressure rise"
            adjustmentDirection = "improved"
        } else if (rate.compareTo(MODERATE_RISE_HPA) >= 0) {
            adjustment = 1
            adjustmentReason = "Pressure rising"
            adjustmentDirection = "improved"
        } else if (rate.compareTo(RAPID_FALL_HPA) <= 0) {
            adjustment = -2
            adjustmentReason = "Rapid pressure drop"
            adjustmentDirection = "degraded"
        } else if (rate.compareTo(MODERATE_FALL_HPA) <= 0) {
            adjustment = -1
            adjustmentReason = "Pressure falling"
            adjustmentDirection = "degraded"
        }
    }

    int baselineIndex = ICON_ORDER.indexOf(baseline.key)
    if (baselineIndex < 0) {
        baselineIndex = ICON_ORDER.indexOf("cloudy")
    }
    int targetIndex = Math.max(0, Math.min(ICON_ORDER.size() - 1, baselineIndex + adjustment))
    String finalKey = ICON_ORDER[targetIndex]
    String finalLabel = ICON_LABELS[finalKey] ?: finalKey.capitalize()

    String humidityNote = buildHumidityNote(humidity)
    String trendLabel = trend?.label
    Integer windowHours = trend?.windowHours
    String summaryText
    if (trendLabel && trendLabel != "Steady" && windowHours) {
        summaryText = "${trendLabel} over last ${windowHours}h. ${baseline.text}".trim()
    } else if (trendLabel && trendLabel != "Steady") {
        summaryText = "${trendLabel}. ${baseline.text}".trim()
    } else {
        summaryText = baseline.text
    }
    if (humidityNote) {
        summaryText = "${summaryText} ${humidityNote}".trim()
    }

    String shortSummary = finalLabel
    if (trendLabel && trendLabel != "Steady") {
        shortSummary = "${trendLabel} • ${finalLabel}".trim()
    }
    shortSummary = shortenText(shortSummary, 32)

    Map adjustmentInfo = null
    if (adjustment != 0 && adjustmentReason) {
        adjustmentInfo = [direction: adjustmentDirection, reason: adjustmentReason, steps: adjustment]
    }

    return [
        key          : finalKey,
        label        : finalLabel,
        summary      : summaryText,
        shortSummary : shortSummary,
        humidityNote : humidityNote,
        adjustment   : adjustmentInfo,
        baselineKey  : baseline.key,
        baselineLabel: baseline.label
    ]
}

private Map buildSummary(BigDecimal relative, BigDecimal absolute, String unit, BigDecimal tendency,
                         BigDecimal dailyAverage, BigDecimal avg30, BigDecimal humidity,
                         Map baseline, Map trend, Map combined) {
    BigDecimal tendencyHpa = convertToHpa(tendency ?: 0.0G, unit)
    String tendencyText = baseline?.trendText ?: "Steady"
    BigDecimal tendencyValue = convertFromHpa(tendencyHpa, unit)
    if (tendencyValue != null) {
        tendencyValue = tendencyValue.setScale(3, RoundingMode.HALF_UP)
    }
    BigDecimal dailyRounded = dailyAverage != null ? dailyAverage.setScale(3, RoundingMode.HALF_UP) : null
    BigDecimal avg30Rounded = avg30 != null ? avg30.setScale(3, RoundingMode.HALF_UP) : null
    BigDecimal humidityRounded = humidity != null ? humidity.setScale(1, RoundingMode.HALF_UP) : null

    Map trendData = null
    if (trend) {
        trendData = [
            label          : trend.label,
            windowHours    : trend.windowHours,
            rateHpaPerHour : trend.rateHpaPerHour,
            changeHpa      : trend.changeHpa,
            ratePerHour    : trend.ratePerHour,
            change         : trend.change
        ]
    }

    Map forecastData = [
        key         : combined?.key,
        label       : combined?.label,
        summary     : combined?.summary,
        shortSummary: combined?.shortSummary,
        humidityNote: combined?.humidityNote,
        adjustment  : combined?.adjustment,
        baseline    : [
            key       : baseline?.key,
            label     : baseline?.label,
            text      : baseline?.text,
            trendText : baseline?.trendText,
            tendencyHpa: baseline?.tendencyHpa
        ],
        shortTerm   : trendData
    ]

    Map publicData = [
        relative: relative,
        absolute: absolute,
        unit: unit,
        tendency: [value: tendencyValue, text: tendencyText],
        dailyAverage: dailyRounded,
        thirtyDayAverage: avg30Rounded,
        humidity: humidityRounded,
        forecast: forecastData
    ]

    return [
        publicData: publicData,
        tendencyText: tendencyText,
        tendencyHpa: tendencyHpa
    ]
}

private String buildHumidityNote(BigDecimal humidity) {
    if (humidity == null) {
        return null
    }
    if (humidity >= 85.0G) {
        return "High humidity favors fog or drizzle."
    }
    if (humidity <= 35.0G) {
        return "Dry air may limit clouds."
    }
    return null
}

private static String shortenText(String value, int maxLength) {
    if (value == null) {
        return null
    }
    String text = value.toString().trim()
    if (!text) {
        return text
    }
    if (text.length() <= maxLength) {
        return text
    }
    int limit = Math.max(0, maxLength - 1)
    String clipped = text.substring(0, limit)
    if (clipped.endsWith(" ")) {
        clipped = clipped.trim()
    }
    return clipped + "…"
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
