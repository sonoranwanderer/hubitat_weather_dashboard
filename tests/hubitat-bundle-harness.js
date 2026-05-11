#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const {
  applyTestGlobals,
  createDashboardDom
} = require('./support/dashboard-test-utils');

const fixturePath = path.join(__dirname, 'fixtures/full-capabilities.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const bundlePath = path.join(__dirname, '../dashboard/weather-dashboard.js');
const bundleSource = fs.readFileSync(bundlePath, 'utf8');

const { window, document, dom } = createDashboardDom({
  dataTiles: [
    { id: 'tile-1', textContent: JSON.stringify(fixture) },
    { id: 'tile-2', textContent: '{}' },
    { id: 'tile-3', textContent: '{}' },
    { id: 'tile-4', textContent: '{}' },
    { id: 'tile-5', textContent: '{}' }
  ]
});

applyTestGlobals(window);
window.setInterval = () => 0;
window.clearInterval = () => {};

try {
  vm.runInNewContext(bundleSource, window, { filename: bundlePath });

  const hooks = window.__WDASH_TEST_HOOKS__;
  assert(hooks, 'Bundled dashboard should expose test hooks in test mode');
  assert.strictEqual(typeof hooks.readPayloads, 'function', 'Bundled dashboard should expose readPayloads');
  assert.strictEqual(typeof hooks.safeRenderFromData, 'function', 'Bundled dashboard should expose safeRenderFromData');

  const payloads = hooks.readPayloads();
  assert.strictEqual(payloads.length, 5, 'Bundled adapter should recognize valid and empty JSON data tiles');
  assert(payloads.slice(1).every(payload => payload && Object.keys(payload).length === 0), 'Bundled adapter should preserve empty JSON source envelopes');

  hooks.safeRenderFromData();

  for (const id of ['tile-1', 'tile-2', 'tile-3', 'tile-4', 'tile-5']) {
    assert(document.getElementById(id).classList.contains('wdash-source-tile'), `${id} should be hidden by bundled dashboard code`);
  }

  console.log('hubitat-bundle-harness.js passed');
} finally {
  dom.window.close();
}

process.exit(0);
