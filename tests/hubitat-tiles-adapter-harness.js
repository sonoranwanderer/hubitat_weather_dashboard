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

const observerInstances = [];
let renderCount = 0;
window.MutationObserver = class MutationObserver {
  constructor(callback) {
    this.callback = callback;
    this.observed = [];
    this.disconnected = false;
    observerInstances.push(this);
  }

  observe(target, options) {
    this.observed.push({ target, options });
  }

  disconnect() {
    this.disconnected = true;
  }
};

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
    globalThis: window,
    knownPayloadKeys: hooks.KNOWN_PAYLOAD_KEYS,
    safeRenderFromData: () => { renderCount += 1; }
  });

  const payloads = adapter.readPayloads();

  assert.strictEqual(payloads.length, 2, 'Adapter should return two payload segments');
  assert.deepStrictEqual(payloads[0], segmentOne, 'First payload segment mismatch');
  assert.deepStrictEqual(payloads[1], segmentTwo, 'Second payload segment mismatch');

  const merged = hooks.mergePayloads(payloads);
  assert.deepStrictEqual(merged, fixture, 'Merged payload does not match fixture data');

  const incompleteMerged = hooks.mergePayloads([segmentOne]);
  assert(incompleteMerged.outdoor, 'Single available segment should still produce a partial payload');
  assert(!incompleteMerged.pressure, 'Missing segment data should stay absent');
  assert.strictEqual(hooks.mergePayloads([{ segmentIndex: 0, segmentSize: 2 }]), null, 'Empty segment envelope should not create a payload');

  document.getElementById('tile-3').querySelector('.tile-primary').textContent = '{"segmentIndex":0,"segmentSize":2}';
  const payloadsWithEmptyEnvelope = adapter.readPayloads();
  assert.strictEqual(payloadsWithEmptyEnvelope.length, 3, 'Recognized segment envelope should be returned for merge handling');
  assert.strictEqual(hooks.mergePayloads([payloadsWithEmptyEnvelope[2]]), null, 'Malformed/missing chunk envelope should merge to null');

  adapter.toggleSourceTileMask(true);
  assert(document.getElementById('tile-1').classList.contains('wdash-source-tile'), 'Expected tile-1 to be masked');
  assert(document.getElementById('tile-2').classList.contains('wdash-source-tile'), 'Expected tile-2 to be masked');
  assert(document.getElementById('tile-3').classList.contains('wdash-source-tile'), 'Recognized empty envelope should be tracked as a source');

  document.getElementById('tile-2').querySelector('.tile-primary').textContent = noiseTileText;
  const payloadsAfterTileTwoWentStale = adapter.readPayloads();
  assert.strictEqual(payloadsAfterTileTwoWentStale.length, 2, 'Tile-1 and the empty envelope should remain as valid payload sources');
  adapter.toggleSourceTileMask(true);
  assert(document.getElementById('tile-1').classList.contains('wdash-source-tile'), 'Current source tile should stay masked');
  assert(!document.getElementById('tile-2').classList.contains('wdash-source-tile'), 'Stale source tile mask should be removed');
  assert(document.getElementById('tile-3').classList.contains('wdash-source-tile'), 'Remaining source tile should stay masked');

  adapter.toggleSourceTileMask(false);
  assert(!document.getElementById('tile-1').classList.contains('wdash-source-tile'), 'Tile-1 mask should be cleared');
  assert(!document.getElementById('tile-2').classList.contains('wdash-source-tile'), 'Tile-2 mask should be cleared');

  assert(infoMessages.some(message => message.includes('Ignoring non-JSON content from tile-3')), 'Expected warning for invalid tile payload');
  assert(infoMessages.some(message => message.includes('Ignoring non-JSON content from tile-2')), 'Expected warning for stale invalid tile payload');

  adapter.ensureDataTileObservers();
  assert(observerInstances.length >= 3, 'Expected data tile observers to be created');
  assert(renderCount > 0, 'Observer setup should trigger a render when sources are discovered');
  const tileTwoObserver = observerInstances.find(observer => observer.observed.some(entry => entry.target.id === 'tile-2'));
  assert(tileTwoObserver, 'Expected observer for tile-2');
  document.getElementById('tile-2').remove();
  adapter.ensureDataTileObservers();
  assert(tileTwoObserver.disconnected, 'Observer for removed tile should be disconnected');

  console.log('hubitat-tiles-adapter-harness.js passed');
} finally {
  window.console.info = originalInfo || (() => {});
  dom.window.close();
}
