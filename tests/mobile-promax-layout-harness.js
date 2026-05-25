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
  const match = source.match(/@Field final String DEFAULT_LAYOUT_OVERRIDE_JSON\s*=\s*'''([\s\S]*?)'''/);
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
    columns: [70, 30],
    gap: '6px',
    rows: [
      { height: 25, columns: ['temp-wind', 'temp-wind'] },
      { height: 18, columns: ['ambient', 'lightning'] },
      { height: 13, columns: ['rain', 'rain'] },
      { height: 15, columns: ['pressure', 'pressure'] },
      { height: 16, columns: ['solar', 'solar'] },
      { height: 13, columns: ['air', 'air'] }
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
  assert(mobileCss.includes('.wdash-card:not(.wdash-card--ambient) { overflow: hidden; }'), 'mobile overflow clipping should exclude ambient controls');
  assert(mobileCss.includes('.wdash-card--temp-wind { display: grid;'), 'mobile temp/wind should use a card-local grid');
  assert(mobileCss.includes('.wdash-temp-wind-main { grid-column: 1; grid-row: 2; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px; align-items: stretch; min-height: 0; height: 100%; }'), 'mobile temp/wind gauge grid should keep stretched measurable cells');
  assert(mobileCss.includes('.wdash-wind { align-items: center; justify-content: center; min-height: 0; height: 100%; padding: 2px; box-sizing: border-box; }'), 'mobile temp/wind dial hosts should keep a small buffer from unit buttons');
  assert(mobileCss.includes('--temp-wind-gauge-center-inset: 23%; --temp-wind-compass-block-inset: 23%; --temp-wind-compass-inline-inset: 17%;'), 'mobile temp/wind overlay insets should fit compact gauges');
  assert(mobileCss.includes('.wdash-gauge-center { padding: 6px 5px; gap: 5px; }'), 'mobile temp gauge center should keep readable vertical spacing');
  assert(mobileCss.includes('.wdash-gauge-value { font-size: 1.5rem; line-height: 0.94;'), 'mobile temp gauge value should be compact');
  assert(mobileCss.includes('.wdash-wind-speed-value { font-size: 1.42rem; line-height: 0.95;'), 'mobile wind speed overlay should be compact');
  assert(mobileCss.includes('.wdash-wind-gust-unit { display: none; }'), 'mobile gust overlay should hide the wind unit label');
  assert(mobileCss.includes('.wdash-card--temp-wind .wdash-wind-unit-indicator { top: 0; right: 0; }'), 'mobile wind unit button should remove the compass corner inset');
  assert(mobileCss.includes('.wdash-temp-wind-details { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));'), 'mobile temp/wind metrics should use a 2 by 3 grid');
  assert(mobileCss.includes('.wdash-rain-main { grid-template-columns: minmax(0, 0.65fr) minmax(0, 0.95fr) minmax(0, 1.25fr); gap: 9px; min-height: 0; position: relative; }'), 'mobile rain card should anchor floating elements inside the rain grid');
  assert(mobileCss.includes('.wdash-rain-daily-metric .wdash-battery-slot { position: absolute; left: calc((100% - 18px) * 0.205 + 3px); bottom: 11%; margin-top: 0; transform: scale(0.86); transform-origin: left bottom; }'), 'mobile rain battery should float between the drop and daily label');
  assert(css.includes('.wdash-rain-col--drop svg { width: auto; height: var(--wdash-rain-drop-height, 95%); max-width: 100%; max-height: var(--wdash-rain-drop-height, 95%);'), 'rain drop should use the universal 95 percent height default');
  assert(!css.includes('--wdash-rain-drop-height: 72%;'), 'mobile rain drop should not override the universal height');
  assert(!css.includes('--wdash-rain-drop-height: 66%;'), 'phone landscape rain drop should not override the universal height');
  assert(mobileCss.includes('.wdash-card--solar .wdash-sun-graphic { flex: 1 1 auto; height: auto; min-height: 74px;'), 'mobile solar graphic should use a compact fixed composition');
  assert(mobileCss.includes('.wdash-card--solar .wdash-sun-svg { transform: translateY(18%) scaleY(0.82);'), 'mobile solar arc should be moved closer to the time labels');
  assert(mobileCss.includes('.wdash-card--solar .wdash-sun-html-metric--solar { left: 50% !important; top: 15% !important; }'), 'mobile solar metric should sit above the sun arc');
  assert(mobileCss.includes('.wdash-card--solar .wdash-sun-time { top: auto !important; bottom: 3px; transform: translateX(-50%); }'), 'mobile solar times should be bottom anchored');
  assert(mobileCss.includes('.wdash-lightning-data { gap: 2px; width: 100%; }'), 'mobile lightning rows should compact without returning to centered label/value columns');
  assert(mobileCss.includes('.wdash-lightning-row { font-size: 0.52rem; line-height: 1.05; }'), 'mobile lightning row text should stay compact and left aligned');
  assert(mobileCss.includes('.wdash-air-metrics { --wdash-columns: 4 !important; grid-auto-rows: minmax(28px, 1fr);'), 'mobile air quality compaction should be present');
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
  assert.strictEqual(root.style.getPropertyValue('--wdash-base-width'), '440px', 'mobile base width should use the measured tile width');
  assert.strictEqual(root.style.getPropertyValue('--wdash-base-height'), '844px', 'mobile base height should use the measured tile height');
  assert.strictEqual(hooks.layoutState.lastDiagnostics.base.sources.mobile.width, 'inherit-inherit-measured', 'mobile width should inherit the measured base');
  assert.strictEqual(hooks.layoutState.lastDiagnostics.base.sources.mobile.height, 'inherit-inherit-measured', 'mobile height should inherit the measured base');

  const scale = readScale(root);
  assertApprox(scale, 1, 0.0001, 'mobile scale should use the measured Pro Max canvas');
  assert(readPixels(root, '--wdash-render-height') <= 844, 'scaled mobile dashboard should fit the Pro Max portrait height');

  const mobileAreas = wrapper.style.getPropertyValue('--wdash-grid-areas-mobile');
  assert(mobileAreas.includes('"ambient lightning"'), 'mobile areas should place lightning beside ambient');

  const mobileDiagnostics = hooks.layoutState.lastDiagnostics;
  const percentRowMobile = mobileDiagnostics.percentTracks.rows.find(entry => entry.breakpoint === 'mobile');
  assert(percentRowMobile, 'mobile percent row diagnostics should be present');
  assert.deepStrictEqual(percentRowMobile.percents, [25, 18, 13, 15, 16, 13], 'mobile row weights should match the default');
  assertApprox(percentRowMobile.finalPixels, percentRowMobile.available, 0.1, 'mobile row pixels should fill the mobile canvas');

  const percentColumnMobile = mobileDiagnostics.percentTracks.columns.find(entry => entry.breakpoint === 'mobile');
  assert(percentColumnMobile, 'mobile percent column diagnostics should be present');
  assert.deepStrictEqual(percentColumnMobile.percents, [70, 30], 'mobile column weights should match the default');
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
