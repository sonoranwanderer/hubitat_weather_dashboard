#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  buildPayloadFromMakerApiResponse
} = require('./support/maker-payload');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'scaling');
const REQUIRED_FIXTURES = [
  'live-maker-2026-05-26.json',
  'stress-air-quality-long-labels.json',
  'stress-extreme-weather.json',
  'stress-sparse-optional.json'
];
const SECRET_PATTERNS = [
  /access_token=(?!REDACTED)[^&\s"]+/i,
  /makerToken=(?!REDACTED)[^&\s"]+/i,
  /dashboardToken=(?!REDACTED)[^&\s"]+/i,
  /d04a7060-33fd-4db2-8af7-40631e20bd60/i
];

function loadFixture(name) {
  const fixturePath = path.join(FIXTURE_DIR, name);
  const raw = fs.readFileSync(fixturePath, 'utf8');
  SECRET_PATTERNS.forEach(pattern => {
    assert(!pattern.test(raw), `${name} should not contain an unredacted secret`);
  });
  return JSON.parse(raw);
}

function assertFixtureShape(name, payload) {
  assert(payload.__fixture && typeof payload.__fixture === 'object', `${name} should include fixture metadata`);
  assert(payload.metadata && typeof payload.metadata === 'object', `${name} should include metadata`);
  assert(payload.metadata.layout && typeof payload.metadata.layout === 'object', `${name} should include layout metadata`);
  assert(payload.outdoor && typeof payload.outdoor === 'object', `${name} should include outdoor data`);
  assert(payload.wind && typeof payload.wind === 'object', `${name} should include wind data`);
  assert(payload.rain && typeof payload.rain === 'object', `${name} should include rain data`);
  assert(payload.pressure && typeof payload.pressure === 'object', `${name} should include pressure data`);
}

function assertLiveCoverage(payload) {
  assert(payload.solar, 'live fixture should include solar data');
  assert(payload.lightning, 'live fixture should include lightning data');
  assert(payload.outdoorAirQuality, 'live fixture should include outdoor AQ data');
  assert(payload.indoorAirQuality, 'live fixture should include indoor AQ data');
  assert(Array.isArray(payload.ambientSensors), 'live fixture should include ambient sensors');
  assert(payload.ambientSensors.length >= 8, 'live fixture should capture the current eight ambient sensors');
}

function assertSyntheticCoverage(name, payload) {
  if (name === 'stress-extreme-weather.json') {
    assert(payload.outdoor.temperature > 110, 'extreme weather fixture should stress high temperature');
    assert(payload.wind.gustMph > 80, 'extreme weather fixture should stress wind gusts');
    assert(payload.rain.rateInPerHour > 5, 'extreme weather fixture should stress rain rate');
    assert(payload.lightning.count > 100, 'extreme weather fixture should stress lightning count');
  }
  if (name === 'stress-air-quality-long-labels.json') {
    assert(payload.outdoorAirQuality.aqi >= 200, 'AQ stress fixture should include poor outdoor AQI');
    assert(payload.indoorAirQuality.carbonDioxide >= 2000, 'AQ stress fixture should include high CO2');
    assert(
      payload.ambientSensors.some(sensor => String(sensor.name || '').length > 32),
      'AQ stress fixture should include long ambient labels'
    );
  }
  if (name === 'stress-sparse-optional.json') {
    assert(!payload.solar, 'sparse fixture should omit solar data');
    assert(!payload.lightning, 'sparse fixture should omit lightning data');
    assert(!payload.outdoorAirQuality && !payload.indoorAirQuality, 'sparse fixture should omit AQ data');
  }
}

function assertSegmentedConversion(payload) {
  const device = {
    id: 'fixture-device',
    label: 'Weather Dashboard Device',
    type: 'Weather Dashboard Device',
    attributes: {
      segmentCore: JSON.stringify({
        outdoor: payload.outdoor,
        indoor: payload.indoor,
        wind: payload.wind,
        pressure: payload.pressure,
        solar: payload.solar,
        lightning: payload.lightning
      }),
      segmentPrecip: JSON.stringify({ rain: payload.rain }),
      segmentAirQuality: JSON.stringify({
        outdoorAirQuality: payload.outdoorAirQuality,
        indoorAirQuality: payload.indoorAirQuality
      }),
      segmentAmbient1: JSON.stringify({
        ambientSensors: Array.isArray(payload.ambientSensors) ? payload.ambientSensors.slice(0, 4) : [],
        totalAmbientSensors: Array.isArray(payload.ambientSensors) ? payload.ambientSensors.length : 0,
        ambientRotationSeconds: payload.ambientRotationSeconds,
        ambientHumidityUnit: payload.ambientHumidityUnit
      }),
      segmentAmbient2: JSON.stringify({
        ambientSensors: Array.isArray(payload.ambientSensors) ? payload.ambientSensors.slice(4) : []
      }),
      segmentMeta: JSON.stringify({
        outlook24h: payload.outlook24h,
        metadata: payload.metadata
      }),
      segmentLayout: JSON.stringify({ layout: payload.metadata.layout }),
      dashboardUpdated: payload.metadata.dashboardUpdatedAt || payload.metadata.generatedAt
    }
  };

  const result = buildPayloadFromMakerApiResponse([device], { deviceIds: [device.id] });
  assert(result.payload.outdoor, 'segmented conversion should preserve outdoor data');
  assert(result.payload.rain, 'segmented conversion should preserve rain data');
  assert.strictEqual(
    (result.payload.ambientSensors || []).length,
    (payload.ambientSensors || []).length,
    'segmented conversion should preserve ambient sensor count'
  );
}

(function main() {
  REQUIRED_FIXTURES.forEach(name => {
    const fixturePath = path.join(FIXTURE_DIR, name);
    assert(fs.existsSync(fixturePath), `Missing scaling fixture ${name}`);
    const payload = loadFixture(name);
    assertFixtureShape(name, payload);
    if (name === 'live-maker-2026-05-26.json') assertLiveCoverage(payload);
    assertSyntheticCoverage(name, payload);
  });

  assertSegmentedConversion(loadFixture('live-maker-2026-05-26.json'));

  console.log('Scaling fixture harness passed');
})();
