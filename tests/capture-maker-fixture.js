#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const {
  buildMakerApiUrl,
  buildPayloadFromMakerApiResponse,
  fetchJson,
  redactUrlSecrets
} = require('./support/maker-payload');

function parseArgs(argv) {
  const options = {
    hubBaseUrl: process.env.WDASH_MAKER_HUB,
    appId: process.env.WDASH_MAKER_APP_ID,
    makerToken: process.env.WDASH_MAKER_TOKEN,
    deviceIds: process.env.WDASH_MAKER_DEVICE_IDS
      ? process.env.WDASH_MAKER_DEVICE_IDS.split(',').map(value => value.trim()).filter(Boolean)
      : [],
    timeoutMs: process.env.WDASH_MAKER_TIMEOUT_MS ? Number(process.env.WDASH_MAKER_TIMEOUT_MS) : 10000,
    out: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--hub' || arg === '--hubBaseUrl') {
      options.hubBaseUrl = next;
      index += 1;
    } else if (arg === '--app-id' || arg === '--appId') {
      options.appId = next;
      index += 1;
    } else if (arg === '--token' || arg === '--makerToken') {
      options.makerToken = next;
      index += 1;
    } else if (arg === '--device-ids' || arg === '--deviceIds') {
      options.deviceIds = String(next || '').split(',').map(value => value.trim()).filter(Boolean);
      index += 1;
    } else if (arg === '--out') {
      options.out = next;
      index += 1;
    } else if (arg === '--timeout-ms') {
      options.timeoutMs = Number(next);
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function usage() {
  return [
    'Usage:',
    '  node tests/capture-maker-fixture.js --hub 192.168.50.231 --app-id 377 --token TOKEN --device-ids 362 --out tests/fixtures/scaling/live-current.json',
    '',
    'Environment alternatives:',
    '  WDASH_MAKER_HUB, WDASH_MAKER_APP_ID, WDASH_MAKER_TOKEN, WDASH_MAKER_DEVICE_IDS'
  ].join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!options.hubBaseUrl || !options.appId || !options.makerToken) {
    throw new Error(`Missing Maker API configuration.\n${usage()}`);
  }

  const url = buildMakerApiUrl(options);
  const response = await fetchJson(url, { timeoutMs: options.timeoutMs });
  const result = buildPayloadFromMakerApiResponse(response, { deviceIds: options.deviceIds });
  const payload = {
    __fixture: {
      kind: 'live-maker-api-capture',
      capturedAt: new Date().toISOString(),
      source: redactUrlSecrets(url),
      selectedDevice: result.selectedDevice,
      deviceCount: result.deviceCount,
      notes: 'Captured from Maker API and converted from Weather Dashboard Device segments. Secrets redacted.'
    },
    ...result.payload
  };
  const json = `${JSON.stringify(payload, null, 2)}\n`;

  if (options.out) {
    const target = path.resolve(options.out);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, json, 'utf8');
    console.log(`Wrote Maker API fixture: ${target}`);
  } else {
    process.stdout.write(json);
  }
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
