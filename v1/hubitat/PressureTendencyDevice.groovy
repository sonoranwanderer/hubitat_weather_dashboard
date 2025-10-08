/*
 * Pressure Tendency Virtual Device
 * Tracks calculated barometric tendency and forecast for dashboard tile consumption.
 */

import groovy.json.JsonOutput

metadata {
    definition(name: "Pressure Tendency Device", namespace: "ecowitt", author: "OpenAI") {
        capability "Sensor"

        attribute "pressureSummary", "string"
        attribute "pressureRelative", "number"
        attribute "pressureAbsolute", "number"
        attribute "pressureUnit", "string"
        attribute "pressureTendency", "number"
        attribute "pressureTendencyText", "string"
        attribute "pressureDailyAverage", "number"
        attribute "pressureThirtyDayAverage", "number"
        attribute "pressureForecastKey", "string"
        attribute "pressureForecastText", "string"

        command "reset"
        command "updatePressure", [
            [name: "relative", type: "NUMBER"],
            [name: "absolute", type: "NUMBER"],
            [name: "unit", type: "STRING"],
            [name: "tendency", type: "NUMBER"],
            [name: "tendencyText", type: "STRING"],
            [name: "dailyAvg", type: "NUMBER"],
            [name: "avg30", type: "NUMBER"],
            [name: "forecastKey", type: "STRING"],
            [name: "forecastText", type: "STRING"],
            [name: "summaryJson", type: "STRING"]
        ]
    }
}

void installed() {
    log.debug "Pressure Tendency Device installed"
    reset()
}

void updated() {
    log.debug "Pressure Tendency Device updated"
}

void reset() {
    sendEvent(name: "pressureSummary", value: JsonOutput.toJson([:]))
    sendEvent(name: "pressureRelative", value: null)
    sendEvent(name: "pressureAbsolute", value: null)
    sendEvent(name: "pressureUnit", value: null)
    sendEvent(name: "pressureTendency", value: null)
    sendEvent(name: "pressureTendencyText", value: "Unknown")
    sendEvent(name: "pressureDailyAverage", value: null)
    sendEvent(name: "pressureThirtyDayAverage", value: null)
    sendEvent(name: "pressureForecastKey", value: "unknown")
    sendEvent(name: "pressureForecastText", value: "Insufficient data")
}

void updatePressure(BigDecimal relative, BigDecimal absolute, String unit, BigDecimal tendency,
                    String tendencyText, BigDecimal dailyAvg, BigDecimal avg30,
                    String forecastKey, String forecastText, String summaryJson) {
    if (summaryJson == null) {
        Map data = [
            relative : [value: relative, unit: unit],
            absolute : [value: absolute, unit: unit],
            tendency : [value: tendency, unit: unit, text: tendencyText],
            dailyAvg : [value: dailyAvg, unit: unit],
            avg30    : [value: avg30, unit: unit],
            forecast : [key: forecastKey, text: forecastText]
        ]
        summaryJson = JsonOutput.toJson(data)
    }

    if (relative != null) {
        sendEvent(name: "pressureRelative", value: relative, unit: unit)
    }
    if (absolute != null) {
        sendEvent(name: "pressureAbsolute", value: absolute, unit: unit)
    }
    if (unit != null) {
        sendEvent(name: "pressureUnit", value: unit)
    }
    if (tendency != null) {
        sendEvent(name: "pressureTendency", value: tendency, unit: unit)
    }
    if (tendencyText != null) {
        sendEvent(name: "pressureTendencyText", value: tendencyText)
    }
    if (dailyAvg != null) {
        sendEvent(name: "pressureDailyAverage", value: dailyAvg, unit: unit)
    }
    if (avg30 != null) {
        sendEvent(name: "pressureThirtyDayAverage", value: avg30, unit: unit)
    }
    if (forecastKey != null) {
        sendEvent(name: "pressureForecastKey", value: forecastKey)
    }
    if (forecastText != null) {
        sendEvent(name: "pressureForecastText", value: forecastText)
    }
    if (summaryJson != null) {
        sendEvent(name: "pressureSummary", value: summaryJson, isStateChange: true)
    }
}
