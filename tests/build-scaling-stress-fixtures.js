#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'scaling');
const SOURCE_PATH = path.join(FIXTURE_DIR, 'live-maker-2026-05-26.json');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function writeFixture(name, payload) {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  const target = path.join(FIXTURE_DIR, name);
  fs.writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${target}`);
}

function baseFixture(kind, notes) {
  const payload = clone(JSON.parse(fs.readFileSync(SOURCE_PATH, 'utf8')));
  payload.__fixture = {
    kind,
    derivedFrom: path.basename(SOURCE_PATH),
    generatedAt: '2026-05-26T18:00:00.000Z',
    notes
  };
  payload.metadata = payload.metadata || {};
  payload.metadata.generatedAt = '2026-05-26T11:00:00-07:00';
  payload.metadata.dashboardUpdatedAt = '2026-05-26T11:00:00-07:00';
  return payload;
}

function extremeWeatherFixture() {
  const payload = baseFixture(
    'synthetic-scaling-stress',
    'Contrived weather extremes for card scaling: high heat, strong wind, heavy rain, pressure drop, active lightning.'
  );

  payload.outdoor = {
    battery: 5,
    dailyHigh: 121.4,
    dailyLow: -18.7,
    dewPoint: 83.2,
    feelsLike: 131.8,
    humidity: 94,
    temperature: 118.6,
    trendPerHour: 11.25
  };
  payload.indoor = {
    battery: 12,
    humidity: 68,
    temperature: 88.4
  };
  payload.wind = {
    average: {
      directionCardinal: 'WNW',
      directionDegrees: 292,
      minutes: 10,
      speedMph: 48.6
    },
    averageMinutes: 10,
    battery: 9,
    dailyMaxGustMph: 104.8,
    directionCardinal: 'WNW',
    directionDegrees: 298,
    gustMph: 86.7,
    speedMph: 57.4
  };
  payload.pressure = {
    absoluteInHg: 23.88,
    baseline: {
      dailyAverageInHg: 28.914,
      forecastText: 'Rapid pressure fall with severe storm risk.',
      iconKey: 'storm',
      iconLabel: 'Storm',
      tendencyHpa: -12.9,
      tendencyInHg: -0.381,
      thirtyDayAverageInHg: 29.712,
      trend: 'Falling Rapidly'
    },
    changeInTrendWindow: -0.44,
    relativeInHg: 28.73,
    trend: 'Falling Rapidly',
    trendInHgPerHour: -0.146
  };
  payload.rain = {
    battery: 8,
    dailyIn: 12.84,
    eventIn: 18.62,
    hourlyIn: 4.91,
    monthlyIn: 42.75,
    rateInPerHour: 9.87,
    weeklyIn: 24.38,
    yearlyIn: 123.45
  };
  payload.lightning = {
    battery: 7,
    count: 128,
    distance: 0.4,
    distanceKm: 0.6,
    distanceMi: 0.4,
    time: '5/26/26, 10:59 AM'
  };
  payload.solar = {
    ...payload.solar,
    solarRadiationWm2: 1298.4,
    uvColor: 'b567ff',
    uvDanger: 'Extreme',
    uvIndex: 14.7
  };
  payload.outlook24h = {
    category: 'Severe Storm',
    humidityNote: 'Very humid air is supporting heavy rain potential.',
    iconKey: 'storm',
    iconLabel: 'Storm',
    shortSummary: 'Rapid Fall • Severe Storm',
    summary: 'Rapid pressure fall with severe storm risk. Very humid air is supporting heavy rain potential.',
    trendLabel: 'Falling Rapidly',
    baseline: payload.pressure.baseline
  };

  return payload;
}

function airQualityLongLabelsFixture() {
  const payload = baseFixture(
    'synthetic-scaling-stress',
    'Contrived poor air quality and long labels for AQ rotation stability and text alignment.'
  );

  payload.ambientSensors = [
    { id: 'long-1', name: 'Primary Bedroom West Window Multi Sensor', temperature: 72.1, humidity: 44.2, battery: 100 },
    { id: 'long-2', name: 'Downstairs Utility Closet Freezer Probe', temperature: -14.6, humidity: 72.4, battery: 88 },
    { id: 'long-3', name: 'Outdoor Patio North Shade Reference Sensor', temperature: 109.7, humidity: 11.5, battery: 67 },
    { id: 'long-4', name: 'Garage Workshop High Shelf Temperature Monitor', temperature: 96.3, humidity: 18.9, battery: 42 },
    { id: 'long-5', name: 'Pool Equipment Pad Waterproof Probe', temperature: 82.8, battery: 91 },
    { id: 'long-6', name: 'Greenhouse Seedling Bench Humidity Station', temperature: 101.2, humidity: 83.7, battery: 35 }
  ];
  payload.totalAmbientSensors = payload.ambientSensors.length;
  payload.outdoorAirQuality = {
    aqi: 287,
    aqiColor: '8f3f97',
    aqiDanger: 'Very Unhealthy',
    aqiPeak: 321,
    aqi_avg_24h: 241,
    aqiColor_avg_24h: 'b567ff',
    aqiDanger_avg_24h: 'Very Unhealthy',
    battery: 13,
    pm25: 188.6,
    pm25Peak: 241.8,
    pm25_avg_24h: 162.4
  };
  payload.indoorAirQuality = {
    aqi: 156,
    aqiColor: 'ff6f61',
    aqiDanger: 'Unhealthy',
    aqiPeak: 199,
    aqi_avg_24h: 133,
    aqiColor_avg_24h: 'ff9445',
    aqiDanger_avg_24h: 'Unhealthy for Sensitive Groups',
    battery: 18,
    carbonDioxide: 2488,
    carbonDioxidePeak: 3012,
    carbonDioxide_avg_24h: 1724,
    pm10: 212.4,
    pm10Peak: 288.7,
    pm10_avg_24h: 184.1,
    pm25: 71.9,
    pm25Peak: 102.6,
    pm25_avg_24h: 64.3
  };

  return payload;
}

function sparseOptionalFixture() {
  const payload = baseFixture(
    'synthetic-scaling-sparse',
    'Sparse optional data fixture for fallback states and missing-card resilience.'
  );
  delete payload.indoor;
  delete payload.solar;
  delete payload.lightning;
  delete payload.outdoorAirQuality;
  delete payload.indoorAirQuality;
  delete payload.ambientSensors;
  delete payload.totalAmbientSensors;
  delete payload.ambientRotationSeconds;
  delete payload.ambientHumidityUnit;
  delete payload.outlook24h;
  payload.outdoor = {
    temperature: -22.4,
    humidity: 8,
    feelsLike: -38.1,
    dailyHigh: -4.2,
    dailyLow: -29.9,
    dewPoint: -52.6,
    battery: 1
  };
  payload.wind = {
    speedMph: 0,
    gustMph: 0,
    dailyMaxGustMph: 0,
    directionDegrees: null,
    directionCardinal: '',
    battery: 1
  };
  payload.rain = {
    dailyIn: 0,
    eventIn: 0,
    hourlyIn: 0,
    weeklyIn: 0,
    monthlyIn: 0,
    yearlyIn: 0,
    rateInPerHour: 0,
    battery: 1
  };
  payload.pressure = {
    relativeInHg: 31.12,
    absoluteInHg: 27.89,
    trend: 'Steady',
    trendInHgPerHour: 0,
    changeInTrendWindow: 0
  };
  return payload;
}

writeFixture('stress-extreme-weather.json', extremeWeatherFixture());
writeFixture('stress-air-quality-long-labels.json', airQualityLongLabelsFixture());
writeFixture('stress-sparse-optional.json', sparseOptionalFixture());
