#!/usr/bin/env node
const assert = require('assert');

const { createHubitatTilesAdapter } = require('../src/adapters/hubitat-tiles');

function createTile(id, text) {
  return {
    id,
    textContent: text,
  };
}

const consoleMessages = [];
const fakeConsole = {
  info: (msg) => consoleMessages.push({ level: 'info', msg }),
  warn: (msg) => consoleMessages.push({ level: 'warn', msg })
};

const tiles = [
  createTile('tile-0', ''),
  createTile('tile-1', 'prefix {"foo": 1, "nested": {"bar": 2}} trailing } }'),
  createTile('tile-2', 'noise before {"foo": "brace } inside string", "list": [1, 2, {"bar": "]"}]} extra ] }'),
  createTile('tile-3', 'garbage {"segmentIndex": 0, "payload": {"foo": 3}} trailing text'),
  createTile('tile-4', 'mismatched {"foo": 4'),
  createTile('tile-5', '{"unknown": true}'),
  createTile('tile-6', 'no json here')
];

const document = {
  querySelectorAll: () => tiles
};

const adapter = createHubitatTilesAdapter({
  document,
  window: { console: fakeConsole },
  knownPayloadKeys: new Set(['foo', 'nested', 'payload'])
});

const payloads = adapter.readPayloads();

assert.strictEqual(payloads.length, 3, 'Expected three valid payloads');
assert.deepStrictEqual(payloads[0], { foo: 1, nested: { bar: 2 } });
assert.deepStrictEqual(payloads[1], { foo: 'brace } inside string', list: [1, 2, { bar: ']' }] });
assert.deepStrictEqual(payloads[2], { segmentIndex: 0, payload: { foo: 3 } });

assert(consoleMessages.some(entry => entry.msg.includes('no JSON object found')), 'Expected a warning for missing JSON');
assert(consoleMessages.some(entry => entry.msg.includes('unrecognized JSON payload')), 'Expected a warning for unrecognized payload');

console.log('hubitat-tiles-adapter-harness.js passed');
