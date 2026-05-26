#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  applyTestGlobals,
  createDashboardDom
} = require('./support/dashboard-test-utils');
const { createRenderer } = require('../src/render');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'scaling');
const VIEWPORTS = [
  { label: 'small portrait', width: 360, height: 640 },
  { label: 'compact portrait', width: 375, height: 667 },
  { label: 'modern portrait', width: 390, height: 844 },
  { label: 'large portrait', width: 430, height: 932 },
  { label: 'narrow landscape', width: 700, height: 390 },
  { label: 'phone landscape', width: 932, height: 430 },
  { label: 'tablet portrait', width: 768, height: 1024 },
  { label: 'desktop base', width: 1200, height: 900 },
  { label: 'large display', width: 1600, height: 1200 }
];
const EXPECTED_CARD_SELECTORS = [
  '.wdash-card--temp-wind',
  '.wdash-card--rain',
  '.wdash-card--pressure'
];
const DEFAULT_MAX_SCALE = 2;

function loadFixtures() {
  return fs
    .readdirSync(FIXTURE_DIR)
    .filter(name => name.endsWith('.json'))
    .sort()
    .map(name => ({
      name,
      payload: JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8'))
    }));
}

function readPixels(element, propertyName) {
  const value = element.style.getPropertyValue(propertyName);
  const match = String(value).match(/^(-?\d+(?:\.\d+)?)px$/);
  return match ? Number(match[1]) : NaN;
}

function readScale(root) {
  return Number(root.style.getPropertyValue('--wdash-scale'));
}

function readUnitValue(element, propertyName, unit) {
  const value = element.style.getPropertyValue(propertyName);
  const match = String(value).match(new RegExp(`^(-?\\d+(?:\\.\\d+)?)${unit}$`));
  return match ? Number(match[1]) : NaN;
}

function assertCardPresence(grid, payload, context) {
  EXPECTED_CARD_SELECTORS.forEach(selector => {
    assert(grid.querySelector(selector), `${context} should render ${selector}`);
  });

  if (payload.solar) assert(grid.querySelector('.wdash-card--solar'), `${context} should render solar card`);
  if (payload.ambientSensors && payload.ambientSensors.length) {
    assert(grid.querySelector('.wdash-card--ambient'), `${context} should render ambient card`);
  }
  if (payload.outdoorAirQuality || payload.indoorAirQuality) {
    assert(grid.querySelector('.wdash-card--air'), `${context} should render air card`);
  }
  if (payload.lightning) {
    assert(grid.querySelector('.wdash-card--lightning'), `${context} should render lightning card`);
  }
}

function assertLayoutFits(root, hooks, viewport, context) {
  const scale = readScale(root);
  assert(Number.isFinite(scale) && scale > 0, `${context} should compute a positive scale`);
  assert(scale <= DEFAULT_MAX_SCALE + 0.0001, `${context} should not exceed the default upscale cap`);
  if (viewport.width >= 1600 && viewport.height >= 1200) {
    assert(scale > 1, `${context} should upscale on large displays`);
    assert(Number(root.style.getPropertyValue('--wdash-fluid-scale')) > 1, `${context} should increase internal card scale on large displays`);
  }

  const renderWidth = readPixels(root, '--wdash-render-width');
  const renderHeight = readPixels(root, '--wdash-render-height');
  assert(Number.isFinite(renderWidth) && renderWidth > 0, `${context} should expose render width`);
  assert(Number.isFinite(renderHeight) && renderHeight > 0, `${context} should expose render height`);
  assert(renderWidth <= viewport.width + 0.5, `${context} render width should fit viewport`);
  assert(renderHeight <= viewport.height + 0.5, `${context} render height should fit viewport`);

  const diagnostics = hooks.layoutState.lastDiagnostics;
  assert(diagnostics, `${context} should capture layout diagnostics`);
  assert(
    ['desktop', 'tablet', 'mobile'].includes(diagnostics.base.activeBreakpoint),
    `${context} should report an active breakpoint`
  );

  const percentRows = diagnostics.percentTracks && diagnostics.percentTracks.rows
    ? diagnostics.percentTracks.rows.find(entry => entry.breakpoint === diagnostics.base.activeBreakpoint)
    : null;
  if (percentRows) {
    assert(
      Math.abs(percentRows.finalPixels - percentRows.available) <= 0.5,
      `${context} percent rows should fill available height`
    );
  }
}

function assertMetricTextIntegrity(grid, context) {
  const markup = grid.innerHTML || '';
  assert(markup.includes('wdash-metric-value'), `${context} should render metric values`);
  assert(!/\bundefined\b|\bNaN\b/.test(markup), `${context} should not render invalid value text`);
}

function setupRendererWithFakeTimers(viewport) {
  const env = createDashboardDom({
    displayRect: { width: viewport.width, height: viewport.height }
  });
  const hooks = applyTestGlobals(env.window);
  const timers = [];
  const fakeSetTimeout = (fn, delay) => {
    const handle = { fn, delay, cleared: false };
    timers.push(handle);
    return handle;
  };
  const fakeClearTimeout = handle => {
    if (handle && typeof handle === 'object') handle.cleared = true;
  };

  env.window.setTimeout = fakeSetTimeout;
  env.window.clearTimeout = fakeClearTimeout;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  global.setTimeout = fakeSetTimeout;
  global.clearTimeout = fakeClearTimeout;

  createRenderer({
    window: env.window,
    document: env.document,
    globalThis: env.window
  });

  return {
    ...env,
    hooks,
    timers,
    restoreTimers() {
      global.setTimeout = originalSetTimeout;
      global.clearTimeout = originalClearTimeout;
    }
  };
}

function airMetricLabels(document) {
  return Array.from(document.querySelectorAll('.wdash-card--air .wdash-metric-label'))
    .filter(node => {
      const metric = node.closest ? node.closest('.wdash-metric') : null;
      return !metric || !metric.classList.contains('wdash-metric--placeholder');
    })
    .map(node => String(node.textContent || '').trim())
    .filter(Boolean);
}

function assertAirQualityRotationStability(payload, viewport) {
  if (!payload.outdoorAirQuality || !payload.indoorAirQuality) return;

  const env = setupRendererWithFakeTimers(viewport);
  const context = `${payload.__fixture ? payload.__fixture.kind : 'fixture'} at ${viewport.label} AQ rotation`;
  try {
    env.hooks.render(payload, env.grid);
    env.hooks.applyLayoutOverrides(payload.metadata);
    env.hooks.setupAirQualityRotation(payload);

    const beforeLabels = airMetricLabels(env.document);
    const state = env.hooks.getAirQualityRotationState();
    assert(state.sources.length === 2, `${context} should rotate both AQ sources`);
    assert(state.timer && typeof state.timer.fn === 'function', `${context} should schedule AQ rotation`);
    const beforeMetricCount = env.document.querySelectorAll('.wdash-card--air .wdash-metric').length;

    state.timer.fn();

    const afterLabels = airMetricLabels(env.document);
    const afterMetricCount = env.document.querySelectorAll('.wdash-card--air .wdash-metric').length;
    assert.strictEqual(afterMetricCount, beforeMetricCount, `${context} should keep AQ grid cell count stable`);
    assert(afterLabels.length >= beforeLabels.length, `${context} should not reduce visible AQ metric positions after rotation`);
  } finally {
    if (typeof env.hooks.stopAirQualityRotationTimer === 'function') env.hooks.stopAirQualityRotationTimer();
    env.restoreTimers();
    env.dom.window.close();
  }
}

function assertCssContracts() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'render', 'index.js'), 'utf8');
  assert(source.includes('function applyCanvasFluidScale(root, renderWidth, renderHeight)'), 'renderer should compute fluid scale from the rendered canvas');
  assert(source.includes("root.style.setProperty('--wdash-fluid-scale'"), 'renderer should expose the computed fluid scale');
  assert(!source.includes('@media (min-width: 1400px) and (min-height: 850px)'), 'large-canvas scaling should not depend on viewport-specific media queries');
  assert(source.includes('.wdash-air-metrics { flex: 1 1 auto; grid-auto-rows: minmax(var(--wdash-air-row-min-fluid, 42px), 1fr);'), 'air quality metrics should scale from renderer-provided row sizing');
  assert(source.includes('.wdash-ambient-circle { flex: 0 0 var(--wdash-ambient-circle-size-fluid, 130px);'), 'ambient circles should grow from renderer-provided sizing');
  assert(source.includes('.wdash-gauge-value { font-size: var(--wdash-gauge-value-font-fluid, 2.32rem);'), 'temp gauge values should scale from renderer-provided typography');
  assert(source.includes('<h3>Rain</h3>'), 'rain card should render a visible header');
  assert(source.includes('.wdash-rain-unit-indicator { position: absolute; left: 6px; bottom: 6px;'), 'rain unit button should remain bottom-left anchored');
  assert(source.includes('.wdash-rain-col--drop svg { width: auto; height: min(var(--wdash-rain-drop-height, 82%), var(--wdash-rain-drop-max-fluid, 140px)); max-width: 100%; max-height: 100%;'), 'rain drop should be bounded by its column and fluid max size');
  assert(source.includes('.wdash-rain-col--center { display: flex; flex-direction: column; justify-content: center; gap: var(--wdash-rain-center-gap-fluid, 8px);'), 'rain center metrics should remain grouped and vertically centered');
  assert(source.includes('.wdash-rain-rate-wrapper .wdash-metric { justify-content: center; gap: 0.65rem; padding: 0; border-bottom: none; }'), 'rain rate row should read as part of the centered daily group');
  assert(source.includes('.wdash-rain-col--stats { align-self: stretch; display: flex; align-items: stretch; min-height: 0; padding-left: var(--wdash-rain-stats-inset-fluid, 4px); border-left: 1px solid rgba(255,255,255,0.06); }'), 'rain stats column should stretch to the rain content height with a subtle separator');
  assert(source.includes('.wdash-rain-col--stats > .wdash-rain-stats.wdash-metric-row--table { display: grid; grid-template-rows: repeat(5, minmax(0, 1fr));'), 'rain stats rows should distribute across available height');
  assert(source.includes('@media (max-width: 720px)'), 'renderer should define mobile scaling rules');
  assert(source.includes('@media (max-width: 980px) and (max-height: 520px)'), 'renderer should define phone landscape scaling rules');
  assert(source.includes('.wdash-card:not(.wdash-card--ambient) { overflow: hidden; }'), 'compact cards should clip to card bounds');
  assert(source.includes('.wdash-air-metrics .wdash-metric--placeholder { visibility: hidden; pointer-events: none; }'), 'AQ placeholders should preserve stable grid positions');
}

function assertCanvasFluidScaling(payload) {
  const viewport = { label: 'expanded canvas', width: 2400, height: 1600 };
  const env = setupRendererWithFakeTimers(viewport);
  const expandedPayload = JSON.parse(JSON.stringify(payload));
  expandedPayload.metadata = expandedPayload.metadata || {};
  expandedPayload.metadata.layout = {
    ...(expandedPayload.metadata.layout || {}),
    baseWidth: 2000,
    baseHeight: 1200
  };

  try {
    env.hooks.render(expandedPayload, env.grid);
    env.hooks.applyLayoutOverrides(expandedPayload.metadata);

    const fluidScale = Number(env.root.style.getPropertyValue('--wdash-fluid-scale'));
    const gaugeValueFont = readUnitValue(env.root, '--wdash-gauge-value-font-fluid', 'rem');
    const airRowMin = readUnitValue(env.root, '--wdash-air-row-min-fluid', 'px');
    const ambientCircleSize = readUnitValue(env.root, '--wdash-ambient-circle-size-fluid', 'px');

    assert(fluidScale > 1, 'expanded canvas should compute an internal fluid scale above the base rendered size');
    assert(gaugeValueFont > 2.32, 'expanded canvas should increase temp gauge typography');
    assert(airRowMin > 42, 'expanded canvas should increase AQ row sizing');
    assert(ambientCircleSize > 130, 'expanded canvas should increase ambient dial sizing');
  } finally {
    env.restoreTimers();
    env.dom.window.close();
  }
}

(function main() {
  const fixtures = loadFixtures();
  assert(fixtures.length >= 4, 'scaling fixture library should include live and stress fixtures');
  assertCssContracts();
  assertCanvasFluidScaling(fixtures[0].payload);

  fixtures.forEach(({ name, payload }) => {
    VIEWPORTS.forEach(viewport => {
      const env = setupRendererWithFakeTimers(viewport);
      const context = `${name} at ${viewport.label} ${viewport.width}x${viewport.height}`;
      try {
        env.hooks.render(payload, env.grid);
        env.hooks.applyLayoutOverrides(payload.metadata);
        assert.strictEqual(env.grid.dataset.empty, 'false', `${context} should render non-empty dashboard`);
        assertCardPresence(env.grid, payload, context);
        assertLayoutFits(env.root, env.hooks, viewport, context);
        assertMetricTextIntegrity(env.grid, context);
      } finally {
        if (typeof env.hooks.stopAmbientRotationTimer === 'function') env.hooks.stopAmbientRotationTimer();
        if (typeof env.hooks.stopAirQualityRotationTimer === 'function') env.hooks.stopAirQualityRotationTimer();
        env.restoreTimers();
        env.dom.window.close();
      }
    });

    assertAirQualityRotationStability(payload, VIEWPORTS[0]);
    assertAirQualityRotationStability(payload, VIEWPORTS[5]);
  });

  console.log('Scaling invariants harness passed');
  process.exit(0);
})();
