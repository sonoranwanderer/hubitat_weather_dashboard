'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { bootstrapRenderer } = require('./support/dashboard-test-utils');

const REPO_ROOT = path.resolve(__dirname, '..');
const APP_PATH = path.join(REPO_ROOT, 'hubitat/WeatherDashboardApp.groovy');
const FULL_FIXTURE_PATH = path.join(__dirname, 'fixtures/full-capabilities.json');

function loadDefaultLayout() {
  const source = fs.readFileSync(APP_PATH, 'utf8');
  const match = source.match(/DEFAULT_LAYOUT_OVERRIDE_JSON\s*=\s*'''([\s\S]*?)'''/);
  assert(match, 'Default layout JSON constant should exist in WeatherDashboardApp.groovy');
  return JSON.parse(match[1]);
}

function readPixels(element, propertyName) {
  const value = element.style.getPropertyValue(propertyName);
  const match = value.match(/^(-?\d+(?:\.\d+)?)px$/);
  return match ? Number(match[1]) : NaN;
}

function readScale(root) {
  return Number(root.style.getPropertyValue('--wdash-scale'));
}

function assertApprox(actual, expected, tolerance, message) {
  assert(
    Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected}, received ${actual}`
  );
}

function assertDesktopTabletDefaults(layout) {
  assert.deepStrictEqual(layout.desktop, {
    columns: [50, 36, 14],
    gap: '6px',
    rows: [
      { height: 32, columns: ['temp-wind', 'ambient', 'lightning'] },
      { height: 24, columns: ['temp-wind', 'rain', 'rain'] },
      { height: 2, columns: ['solar', 'rain', 'rain'] },
      { height: 27, columns: ['solar', 'pressure', 'pressure'] },
      { height: 16, columns: ['air', 'air', 'air'] }
    ]
  }, 'desktop default layout should remain unchanged');
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(layout, 'tablet'),
    false,
    'tablet should continue inheriting the desktop default'
  );
}

function assertMobileDefault(layout) {
  assert.strictEqual(layout.trackUnit, 'percent', 'default layout should remain percent-based');
  assert.deepStrictEqual(layout.mobile, {
    baseWidth: 820,
    baseHeight: 1280,
    columns: [68, 22],
    gap: '6px',
    rows: [
      { height: 25, columns: ['temp-wind', 'temp-wind'] },
      { height: 17, columns: ['ambient', 'lightning'] },
      { height: 20, columns: ['rain', 'rain'] },
      { height: 15, columns: ['pressure', 'pressure'] },
      { height: 15, columns: ['solar', 'solar'] },
      { height: 8, columns: ['air', 'air'] }
    ]
  }, 'mobile default layout should use the Pro Max scaled canvas');
}

function assertMobileCssScoped(document) {
  const style = document.getElementById('weather-dashboard-css');
  const css = style
    ? style.textContent || ''
    : fs.readFileSync(path.join(REPO_ROOT, 'src/render/index.js'), 'utf8');
  const mediaStart = css.indexOf('@media (max-width: 720px)');
  assert(mediaStart >= 0, 'mobile compact rules should be scoped to the mobile media query');
  const mobileCss = css.slice(mediaStart);
  assert(mobileCss.includes('.wdash-card { padding: 9px 10px;'), 'mobile card compaction should be present');
  assert(mobileCss.includes('.wdash-lightning-data { grid-template-columns: minmax(0, 1fr);'), 'mobile lightning compaction should be present');
  assert(mobileCss.includes('.wdash-air-metrics { --wdash-columns: 4 !important; grid-auto-rows: minmax(30px, 1fr);'), 'mobile air quality compaction should be present');
  assert(css.includes('@media (max-width: 980px) and (max-height: 520px)'), 'phone landscape compact rules should be scoped by width and height');
  assert(css.includes('.wdash-air-metrics { --wdash-columns: 4 !important; grid-auto-rows: minmax(24px, 1fr);'), 'phone landscape air quality compaction should be present');
}

function assertLandscapeLayoutStyle(document) {
  const style = document.getElementById('weather-dashboard-layout-style');
  const css = style
    ? style.textContent || ''
    : fs.readFileSync(path.join(REPO_ROOT, 'src/render/index.js'), 'utf8');
  assert(css.includes('@media (max-width:980px) and (max-height:520px)'), 'phone landscape grid override should be generated');
  assert(css.includes('grid-template-areas:"temp-wind ambient lightning" "solar rain rain" "air pressure pressure"'), 'phone landscape grid should reduce the default to three rows');
}

(function main() {
  const defaultLayout = loadDefaultLayout();
  assertDesktopTabletDefaults(defaultLayout);
  assertMobileDefault(defaultLayout);

  const { dom, hooks, window, document, root, grid, wrapper } = bootstrapRenderer({
    displayRect: { width: 440, height: 844 }
  });
  window.matchMedia = query => ({
    matches: query === '(max-width: 720px)' || query === '(max-width: 1100px)',
    media: query,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false;
    }
  });

  const payload = JSON.parse(fs.readFileSync(FULL_FIXTURE_PATH, 'utf8'));
  payload.metadata = {
    ...(payload.metadata || {}),
    layout: defaultLayout
  };

  hooks.render(payload, grid);
  hooks.applyLayoutOverrides(payload.metadata);

  [
    'temp-wind',
    'ambient',
    'lightning',
    'rain',
    'pressure',
    'solar',
    'air'
  ].forEach(area => {
    assert(grid.querySelector(`.wdash-card--${area}`), `mobile default should render ${area} card`);
  });

  assert.strictEqual(wrapper.dataset.layoutHasLightning, 'true', 'mobile default should enable lightning layout area');
  assert.strictEqual(hooks.layoutState.lastDiagnostics.base.activeBreakpoint, 'mobile', 'diagnostics should identify mobile breakpoint');
  assert.strictEqual(root.style.getPropertyValue('--wdash-base-width'), '820px', 'mobile base width should use the scaled canvas');
  assert.strictEqual(root.style.getPropertyValue('--wdash-base-height'), '1280px', 'mobile base height should use the scaled canvas');
  assert.strictEqual(hooks.layoutState.lastDiagnostics.base.sources.mobile.width, 'section-override', 'mobile width should come from the mobile section');
  assert.strictEqual(hooks.layoutState.lastDiagnostics.base.sources.mobile.height, 'section-override', 'mobile height should come from the mobile section');

  const scale = readScale(root);
  assertApprox(scale, 440 / 820, 0.0001, 'mobile scale should fit the Pro Max width');
  assert(readPixels(root, '--wdash-render-height') <= 844, 'scaled mobile dashboard should fit the Pro Max portrait height');

  const mobileAreas = wrapper.style.getPropertyValue('--wdash-grid-areas-mobile');
  assert(mobileAreas.includes('"ambient lightning"'), 'mobile areas should place lightning beside ambient');

  const mobileDiagnostics = hooks.layoutState.lastDiagnostics;
  const percentRowMobile = mobileDiagnostics.percentTracks.rows.find(entry => entry.breakpoint === 'mobile');
  assert(percentRowMobile, 'mobile percent row diagnostics should be present');
  assert.deepStrictEqual(percentRowMobile.percents, [25, 17, 20, 15, 15, 8], 'mobile row weights should match the default');
  assertApprox(percentRowMobile.finalPixels, percentRowMobile.available, 0.1, 'mobile row pixels should fill the mobile canvas');

  const percentColumnMobile = mobileDiagnostics.percentTracks.columns.find(entry => entry.breakpoint === 'mobile');
  assert(percentColumnMobile, 'mobile percent column diagnostics should be present');
  assert.deepStrictEqual(percentColumnMobile.percents, [68, 22], 'mobile column weights should match the default');
  assertApprox(percentColumnMobile.finalPixels, percentColumnMobile.available, 0.1, 'mobile column pixels should fill the mobile canvas');

  assertMobileCssScoped(document);

  if (typeof hooks.stopAmbientRotationTimer === 'function') {
    hooks.stopAmbientRotationTimer();
  }
  if (typeof hooks.stopAirQualityRotationTimer === 'function') {
    hooks.stopAirQualityRotationTimer();
  }
  dom.window.close();

  const landscape = bootstrapRenderer({
    displayRect: { width: 932, height: 430 }
  });
  landscape.window.matchMedia = query => ({
    matches: query === '(max-width: 1100px)',
    media: query,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false;
    }
  });
  const landscapePayload = JSON.parse(fs.readFileSync(FULL_FIXTURE_PATH, 'utf8'));
  landscapePayload.metadata = {
    ...(landscapePayload.metadata || {}),
    layout: defaultLayout
  };
  landscape.hooks.render(landscapePayload, landscape.grid);
  landscape.hooks.applyLayoutOverrides(landscapePayload.metadata);
  assertLandscapeLayoutStyle(landscape.document);
  assert(landscape.grid.querySelector('.wdash-card--air'), 'phone landscape should still render air quality');
  assert(landscape.grid.querySelector('.wdash-card--pressure'), 'phone landscape should still render pressure');
  if (typeof landscape.hooks.stopAmbientRotationTimer === 'function') {
    landscape.hooks.stopAmbientRotationTimer();
  }
  if (typeof landscape.hooks.stopAirQualityRotationTimer === 'function') {
    landscape.hooks.stopAirQualityRotationTimer();
  }
  landscape.dom.window.close();

  console.log('Mobile Pro Max layout harness passed');
})();
