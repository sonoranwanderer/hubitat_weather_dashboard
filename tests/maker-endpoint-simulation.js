#!/usr/bin/env node
const assert = require('assert');

function simulateEndpoint({ configuredToken, requestToken, snapshot }) {
  const trim = (value) => (typeof value === 'string' ? value.trim() : (value == null ? '' : String(value).trim()));
  const stored = trim(configuredToken);
  if (!stored) {
    return { status: 503, message: 'Maker API token not configured.' };
  }
  const provided = trim(requestToken);
  if (!provided) {
    return { status: 401, message: 'Maker token missing.' };
  }
  if (stored !== provided) {
    return { status: 401, message: 'Maker token invalid.' };
  }

  const snapshotState = snapshot || {};
  if (!snapshotState.json || snapshotState.withinLimit === false) {
    return { status: 503, message: 'Dashboard payload unavailable.' };
  }

  return { status: 200, body: snapshotState.json };
}

const baseSnapshot = {
  json: JSON.stringify({ hello: 'world' }),
  withinLimit: true,
};

assert.deepStrictEqual(
  simulateEndpoint({ configuredToken: 'abc123', requestToken: 'abc123', snapshot: baseSnapshot }),
  { status: 200, body: baseSnapshot.json },
  'valid token should return payload'
);

assert.deepStrictEqual(
  simulateEndpoint({ configuredToken: 'abc123', requestToken: ' abc123 ', snapshot: baseSnapshot }),
  { status: 200, body: baseSnapshot.json },
  'tokens should be trimmed before comparison'
);

assert.strictEqual(
  simulateEndpoint({ configuredToken: '', requestToken: 'abc123', snapshot: baseSnapshot }).status,
  503,
  'missing configured token should return 503'
);

assert.strictEqual(
  simulateEndpoint({ configuredToken: 'abc123', requestToken: '', snapshot: baseSnapshot }).status,
  401,
  'missing request token should return 401'
);

assert.strictEqual(
  simulateEndpoint({ configuredToken: 'abc123', requestToken: 'wrong', snapshot: baseSnapshot }).status,
  401,
  'invalid token should return 401'
);

assert.strictEqual(
  simulateEndpoint({ configuredToken: 'abc123', requestToken: 'abc123', snapshot: { json: null, withinLimit: true } }).status,
  503,
  'missing snapshot json should return 503'
);

assert.strictEqual(
  simulateEndpoint({ configuredToken: 'abc123', requestToken: 'abc123', snapshot: { json: baseSnapshot.json, withinLimit: false } }).status,
  503,
  'snapshot outside size limit should return 503'
);

console.log('maker-endpoint-simulation.js passed');
