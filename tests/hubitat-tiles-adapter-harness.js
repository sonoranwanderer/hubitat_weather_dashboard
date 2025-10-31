#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  bootstrapRenderer
} = require('./support/dashboard-test-utils');
const { createHubitatTilesAdapter } = require('../src/adapters/hubitat-tiles');

const fixturePath = path.join(__dirname, 'fixtures/full-capabilities.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

const segmentOne = {
  segmentIndex: 0,
  segmentSize: 2,
  outdoor: fixture.outdoor,
  wind: fixture.wind,
  rain: fixture.rain,
  lightning: fixture.lightning,
  metadata: {
    generatedAt: fixture.metadata.generatedAt,
    weatherStationTimezone: fixture.metadata.weatherStationTimezone,
    weatherStationTime: fixture.metadata.weatherStationTime,
    temperatureDisplayUnit: fixture.metadata.temperatureDisplayUnit,
    rainDisplayUnit: fixture.metadata.rainDisplayUnit,
    windDisplayUnit: fixture.metadata.windDisplayUnit,
    pressureDisplayUnit: fixture.metadata.pressureDisplayUnit,
    lightningDisplayUnit: fixture.metadata.lightningDisplayUnit
  }
};

const segmentTwo = {
  segmentIndex: 1,
  segmentSize: 2,
  indoor: fixture.indoor,
  pressure: fixture.pressure,
  solar: fixture.solar,
  outdoorAirQuality: fixture.outdoorAirQuality,
  indoorAirQuality: fixture.indoorAirQuality,
  ambientSensors: fixture.ambientSensors,
  totalAmbientSensors: fixture.totalAmbientSensors,
  ambientRotationSeconds: fixture.ambientRotationSeconds,
  ambientHumidityUnit: fixture.ambientHumidityUnit,
  metadata: {
    layout: fixture.metadata.layout
  }
};

const noiseTileText = 'status: ok -- no json payload provided';

const { window, document, hooks, dom } = bootstrapRenderer({
  dataTiles: [
    { id: 'tile-1', textContent: `Weather Dashboard ${JSON.stringify(segmentOne)} ` },
    { id: 'tile-2', textContent: `Segment payload ${JSON.stringify(segmentTwo)}` },
    { id: 'tile-3', textContent: noiseTileText }
  ]
});

const infoMessages = [];
const originalInfo = window.console?.info ? window.console.info.bind(window.console) : null;
window.console.info = (...args) => {
  infoMessages.push(args.join(' '));
  if (originalInfo) {
    originalInfo(...args);
  }
};

try {
  if (!hooks.KNOWN_PAYLOAD_KEYS) {
    throw new Error('KNOWN_PAYLOAD_KEYS test hook missing');
  }

  const adapter = createHubitatTilesAdapter({
    window,
    document,
    knownPayloadKeys: hooks.KNOWN_PAYLOAD_KEYS,
    safeRenderFromData: () => {}
  });

  const payloads = adapter.readPayloads();

  assert.strictEqual(payloads.length, 2, 'Adapter should return two payload segments');
  assert.deepStrictEqual(payloads[0], segmentOne, 'First payload segment mismatch');
  assert.deepStrictEqual(payloads[1], segmentTwo, 'Second payload segment mismatch');

  const merged = hooks.mergePayloads(payloads);
  assert.deepStrictEqual(merged, fixture, 'Merged payload does not match fixture data');

  adapter.toggleSourceTileMask(true);
  assert(document.getElementById('tile-1').classList.contains('wdash-source-tile'), 'Expected tile-1 to be masked');
  assert(document.getElementById('tile-2').classList.contains('wdash-source-tile'), 'Expected tile-2 to be masked');
  assert(!document.getElementById('tile-3').classList.contains('wdash-source-tile'), 'Noise tile should not be masked');

  adapter.toggleSourceTileMask(false);
  assert(!document.getElementById('tile-1').classList.contains('wdash-source-tile'), 'Tile-1 mask should be cleared');
  assert(!document.getElementById('tile-2').classList.contains('wdash-source-tile'), 'Tile-2 mask should be cleared');

  assert(infoMessages.some(message => message.includes('Ignoring non-JSON content from tile-3')), 'Expected warning for invalid tile payload');

  console.log('hubitat-tiles-adapter-harness.js passed');
} finally {
  window.console.info = originalInfo || (() => {});
  dom.window.close();
}
