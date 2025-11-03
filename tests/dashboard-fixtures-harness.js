#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  bootstrapRenderer,
  normalizeMarkup
} = require('./support/dashboard-test-utils');

const FIXTURE_DIR = path.join(__dirname, 'fixtures');
const EXPECTED_DIR = path.join(FIXTURE_DIR, 'expected-dom');
const UPDATE_EXPECTED = process.env.WDASH_UPDATE_EXPECTED === '1';

function resolveFixtureNowTimestamp(data) {
  const candidate = data?.metadata?.generatedAt;
  if (!candidate) return null;
  const parsed = Date.parse(candidate);
  return Number.isFinite(parsed) ? parsed : null;
}

function stubDateNow(window, timestamp) {
  if (!Number.isFinite(timestamp)) {
    return () => {};
  }

  const fixed = Math.floor(timestamp);
  const stub = () => fixed;

  const originalNodeDateNow = Date.now;
  Date.now = stub;

  let restoreWindowDateNow = null;
  if (window && window.Date && typeof window.Date.now === 'function') {
    const originalWindowDateNow = window.Date.now;
    window.Date.now = stub;
    restoreWindowDateNow = () => {
      window.Date.now = originalWindowDateNow;
    };
  }

  return () => {
    Date.now = originalNodeDateNow;
    if (restoreWindowDateNow) restoreWindowDateNow();
  };
}

function normalizeTempUnit(unit) {
  const value = typeof unit === 'string' ? unit.trim().toUpperCase() : '';
  return value === 'C' ? 'C' : 'F';
}

function normalizeRainUnit(unit) {
  const value = typeof unit === 'string' ? unit.trim().toLowerCase() : '';
  return value === 'mm' ? 'mm' : 'in';
}

function normalizeWindUnit(unit) {
  const value = typeof unit === 'string' ? unit.trim().toLowerCase() : '';
  if (value === 'kph' || value === 'kts') {
    return value;
  }
  return 'mph';
}

function normalizeLightningUnit(unit) {
  const value = typeof unit === 'string' ? unit.trim().toLowerCase() : '';
  return value === 'km' ? 'km' : 'mi';
}

function getFixtureEntries() {
  return fs
    .readdirSync(FIXTURE_DIR)
    .filter(name => name.endsWith('.json'))
    .sort();
}

function loadFixturePayload(fixturePath) {
  const raw = fs.readFileSync(fixturePath, 'utf8');
  try {
    return { raw, data: JSON.parse(raw) };
  } catch (error) {
    throw new Error(`Unable to parse fixture ${path.basename(fixturePath)}: ${error.message}`);
  }
}

function ensureExpectedDirectory() {
  if (!fs.existsSync(EXPECTED_DIR)) {
    fs.mkdirSync(EXPECTED_DIR, { recursive: true });
  }
}

function expectedMarkupPath(fixtureName) {
  return path.join(EXPECTED_DIR, fixtureName.replace(/\.json$/i, '.html'));
}

async function runFixture(fixturePath) {
  const fixtureName = path.basename(fixturePath);
  const { raw, data } = loadFixturePayload(fixturePath);

  const { dom, window, grid, hooks } = bootstrapRenderer({
    dataTiles: [
      { id: 'tile-1', textContent: raw }
    ]
  });

  const consoleErrors = [];
  const originalConsoleError = window.console?.error ? window.console.error.bind(window.console) : null;
  window.console.error = (...args) => {
    consoleErrors.push(args);
    if (originalConsoleError) {
      originalConsoleError(...args);
    }
  };

  const restoreDateNow = stubDateNow(window, resolveFixtureNowTimestamp(data));

  try {
    hooks.safeRenderFromData();
    await new Promise(resolve => window.setTimeout(resolve, 0));

    assert.strictEqual(consoleErrors.length, 0, `Console error emitted for ${fixtureName}`);
    assert.strictEqual(grid.dataset.empty, 'false', `Dashboard did not render payload for ${fixtureName}`);

    const markup = grid.innerHTML || '';
    assert(markup.includes('wdash-card'), `Rendered markup missing cards for ${fixtureName}`);

    const normalizedActual = normalizeMarkup(markup);
    const expectedPath = expectedMarkupPath(fixtureName);

    if (UPDATE_EXPECTED) {
      ensureExpectedDirectory();
      fs.writeFileSync(expectedPath, `${normalizedActual}\n`, 'utf8');
      console.log(`Updated expected markup for ${fixtureName}`);
    } else {
      assert(fs.existsSync(expectedPath), `Expected markup missing for ${fixtureName}. Re-run with WDASH_UPDATE_EXPECTED=1 to generate fixtures.`);
      const expectedMarkup = fs.readFileSync(expectedPath, 'utf8');
      const normalizedExpected = normalizeMarkup(expectedMarkup);
      assert.strictEqual(normalizedActual, normalizedExpected, `Rendered markup mismatch for ${fixtureName}`);
    }

    if (typeof hooks.getDisplayTemperatureUnit === 'function') {
      const expectedTemp = normalizeTempUnit(data?.metadata?.temperatureDisplayUnit);
      assert.strictEqual(hooks.getDisplayTemperatureUnit(), expectedTemp, `Temperature unit state mismatch for ${fixtureName}`);
    }

    if (typeof hooks.getDisplayRainUnit === 'function') {
      const expectedRain = normalizeRainUnit(data?.metadata?.rainDisplayUnit);
      assert.strictEqual(hooks.getDisplayRainUnit(), expectedRain, `Rain unit state mismatch for ${fixtureName}`);
    }

    if (typeof hooks.getDisplayWindUnit === 'function') {
      const expectedWind = normalizeWindUnit(data?.metadata?.windDisplayUnit);
      assert.strictEqual(hooks.getDisplayWindUnit(), expectedWind, `Wind unit state mismatch for ${fixtureName}`);
    }

    if (typeof hooks.getDisplayLightningUnit === 'function') {
      const expectedLightning = normalizeLightningUnit(data?.metadata?.lightningDisplayUnit);
      assert.strictEqual(hooks.getDisplayLightningUnit(), expectedLightning, `Lightning unit state mismatch for ${fixtureName}`);
    }

    if (hooks.tempWindState && hooks.tempWindState.data) {
      const rendered = hooks.tempWindState.data;
      if (data.metadata && data.metadata.generatedAt) {
        assert.strictEqual(rendered.metadata?.generatedAt, data.metadata.generatedAt, `Metadata.generatedAt mismatch for ${fixtureName}`);
      }
      if (data.ambientSensors && data.ambientSensors.length) {
        assert(Array.isArray(rendered.ambientSensors), `Temp/wind ambient sensors missing for ${fixtureName}`);
        assert.strictEqual(rendered.ambientSensors.length, data.ambientSensors.length, `Ambient sensor count mismatch for ${fixtureName}`);
      }
    }

    if (typeof hooks.getAirQualityRotationState === 'function' && (data.outdoorAirQuality || data.indoorAirQuality)) {
      const rotationState = hooks.getAirQualityRotationState();
      assert(Array.isArray(rotationState?.sources) && rotationState.sources.length > 0, `Air quality rotation not initialised for ${fixtureName}`);
    }

    console.log(`Rendered dashboard fixture: ${fixtureName}`);
  } finally {
    restoreDateNow();
    if (typeof hooks.stopAirQualityRotationTimer === 'function') {
      hooks.stopAirQualityRotationTimer();
    }
    window.console.error = originalConsoleError || (() => {});
    dom.window.close();
  }
}

async function main() {
  const entries = getFixtureEntries();
  assert(entries.length > 0, 'No dashboard fixtures found');

  const failures = [];
  for (const entry of entries) {
    const fixturePath = path.join(FIXTURE_DIR, entry);
    try {
      await runFixture(fixturePath);
    } catch (error) {
      failures.push({ label: entry, error });
      console.error(`Fixture ${entry} failed: ${error.message}`);
    }
  }

  if (failures.length > 0) {
    console.error('Dashboard fixture harness encountered failures:');
    for (const failure of failures) {
      console.error(` - ${failure.label}: ${failure.error?.stack || failure.error}`);
    }
    process.exit(1);
  }

  if (UPDATE_EXPECTED) {
    console.log('Dashboard fixture expectations updated');
  } else {
    console.log('Dashboard fixture harness passed');
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
