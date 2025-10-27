'use strict';

const fs = require('fs');
const path = require('path');

const {
  createTestEnvironment,
  loadWeatherDashboard,
  createElement
} = require('./support/fake-dom');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function createTile(document, id, textContent = '', size = { width: 1200, height: 900 }) {
  const tile = createElement(document, 'div');
  tile.setAttribute('id', id);
  tile.setBoundingClientRect(size);
  const primary = createElement(document, 'div', ['tile-primary']);
  primary.textContent = textContent;
  primary.setBoundingClientRect(size);
  tile.appendChild(primary);
  document.body.appendChild(tile);
  return tile;
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

async function runFixture(fixturePath) {
  const label = path.basename(fixturePath);
  const raw = fs.readFileSync(fixturePath, 'utf8');
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Fixture ${label} does not contain valid JSON: ${err.message}`);
  }

  const { window, document } = createTestEnvironment();

  const displayTile = createTile(document, 'tile-0');
  const dataTile = createTile(document, 'tile-1', raw, { width: 400, height: 200 });
  void dataTile;

  const primary = displayTile.querySelector('.tile-primary');
  const root = createElement(document, 'div', ['wdash-root']);
  const frame = createElement(document, 'div', ['wdash-frame']);
  const wrapper = createElement(document, 'div', ['wdash']);
  const grid = createElement(document, 'div', ['wdash-grid']);
  grid.dataset.empty = 'true';
  wrapper.appendChild(grid);
  frame.appendChild(wrapper);
  root.appendChild(frame);
  primary.appendChild(root);

  const errors = [];
  const originalConsole = window.console;
  const originalError = originalConsole.error ? originalConsole.error.bind(originalConsole) : null;
  window.console.error = (...args) => {
    errors.push(args);
    if (originalError) {
      originalError(...args);
    }
  };

  const hooks = loadWeatherDashboard(window);
  assert(hooks && typeof hooks.safeRenderFromData === 'function', 'Weather dashboard test hooks missing');

  hooks.safeRenderFromData();
  await new Promise(resolve => setTimeout(resolve, 0));

  assert(errors.length === 0, `Console error emitted for ${label}`);

  assert(grid.dataset.empty === 'false', `Dashboard did not render payload for ${label}`);
  const markup = grid.innerHTML || '';
  assert(markup.includes('wdash-card'), `Grid markup missing cards for ${label}`);

  if (typeof hooks.getDisplayTemperatureUnit === 'function') {
    const expectedTemp = normalizeTempUnit(payload?.metadata?.temperatureDisplayUnit);
    assert(hooks.getDisplayTemperatureUnit() === expectedTemp, `Temperature unit state mismatch for ${label}`);
  }

  if (typeof hooks.getDisplayRainUnit === 'function') {
    const expectedRain = normalizeRainUnit(payload?.metadata?.rainDisplayUnit);
    assert(hooks.getDisplayRainUnit() === expectedRain, `Rain unit state mismatch for ${label}`);
  }

  if (typeof hooks.getDisplayWindUnit === 'function') {
    const expectedWind = normalizeWindUnit(payload?.metadata?.windDisplayUnit);
    assert(hooks.getDisplayWindUnit() === expectedWind, `Wind unit state mismatch for ${label}`);
  }

  if (typeof hooks.getDisplayLightningUnit === 'function') {
    const expectedLightning = normalizeLightningUnit(payload?.metadata?.lightningDisplayUnit);
    assert(hooks.getDisplayLightningUnit() === expectedLightning, `Lightning unit state mismatch for ${label}`);
  }

  if (hooks.tempWindState && hooks.tempWindState.data) {
    const rendered = hooks.tempWindState.data;
    if (payload.metadata && payload.metadata.generatedAt) {
      assert(rendered.metadata && rendered.metadata.generatedAt === payload.metadata.generatedAt, `Metadata.generatedAt mismatch for ${label}`);
    }
    if (payload.ambientSensors && payload.ambientSensors.length) {
      assert(Array.isArray(rendered.ambientSensors) && rendered.ambientSensors.length === payload.ambientSensors.length, `Ambient sensor count mismatch for ${label}`);
    }
  }

  if (typeof hooks.getAirQualityRotationState === 'function' && (payload.outdoorAirQuality || payload.indoorAirQuality)) {
    const rotationState = hooks.getAirQualityRotationState();
    assert(Array.isArray(rotationState.sources) && rotationState.sources.length > 0, `Air quality rotation not initialised for ${label}`);
  }

  console.log(`Rendered dashboard fixture: ${label}`);
}

async function main() {
  const fixturesDir = path.join(__dirname, 'fixtures');
  const entries = fs.readdirSync(fixturesDir).filter(name => name.endsWith('.json')).sort();
  assert(entries.length > 0, 'No dashboard fixtures found');
  for (const name of entries) {
    await runFixture(path.join(fixturesDir, name));
  }
  console.log('Dashboard fixture harness passed');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
