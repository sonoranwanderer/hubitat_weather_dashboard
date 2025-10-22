'use strict';

const assert = require('assert');
const {
  createTestEnvironment,
  loadWeatherDashboard,
  createElement
} = require('./support/fake-dom');

function parseTrackPixels(value) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(token => {
      const match = token.match(/^(-?\d+(?:\.\d+)?)px$/);
      if (!match) return NaN;
      return Number(match[1]);
    });
}

function parseGapValue(value) {
  const tokens = value.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return 0;
  const match = tokens[0].match(/^(-?\d+(?:\.\d+)?)px$/);
  return match ? Number(match[1]) : 0;
}

function parseFrameGapVertical(value) {
  const tokens = value.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return 0;
  if (tokens.length === 1) return parseFloat(tokens[0]) * 2;
  if (tokens.length === 2) return parseFloat(tokens[0]) * 2;
  if (tokens.length === 3) {
    const top = parseFloat(tokens[0]);
    const bottom = parseFloat(tokens[2]);
    return top + bottom;
  }
  const top = parseFloat(tokens[0]);
  const bottom = parseFloat(tokens[2]);
  return top + bottom;
}

function parseFrameGapHorizontal(value) {
  const tokens = value.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return 0;
  if (tokens.length === 1) return parseFloat(tokens[0]) * 2;
  if (tokens.length === 2) return parseFloat(tokens[1]) * 2;
  if (tokens.length === 3) {
    const horizontal = parseFloat(tokens[1]);
    return horizontal * 2;
  }
  const right = parseFloat(tokens[1]);
  const left = parseFloat(tokens[3]);
  return right + left;
}

function buildDashboardSkeleton(document) {
  const tile = createElement(document, 'div');
  tile.setAttribute('id', 'tile-0');
  document.body.appendChild(tile);

  const content = createElement(document, 'div', ['tile-primary']);
  tile.appendChild(content);

  const root = createElement(document, 'div', ['wdash-root']);
  const frame = createElement(document, 'div', ['wdash-frame']);
  const dash = createElement(document, 'div', ['wdash']);
  const grid = createElement(document, 'div', ['wdash-grid']);
  grid.dataset.empty = 'true';
  dash.appendChild(grid);
  frame.appendChild(dash);
  root.appendChild(frame);
  content.appendChild(root);

  return { tile, content, root, frame, dash, grid };
}

function setHostSize(skeleton, width, height) {
  skeleton.content.setBoundingClientRect({ width, height, top: 0, left: 0 });
  skeleton.root.setBoundingClientRect({ width, height, top: 0, left: 0 });
}

(function main() {
  const { window, document } = createTestEnvironment();
  const hooks = loadWeatherDashboard(window);
  const {
    applyLayoutOverrides,
    layoutState,
    resetTileMeasurement
  } = hooks;

  if (typeof applyLayoutOverrides !== 'function') {
    throw new Error('applyLayoutOverrides hook missing');
  }

  const skeleton = buildDashboardSkeleton(document);
  const rootStyle = skeleton.root.style;
  const dashStyle = skeleton.dash.style;

  resetTileMeasurement();

  setHostSize(skeleton, 960, 720);
  applyLayoutOverrides();

  assert.strictEqual(rootStyle.getPropertyValue('--wdash-base-width'), '960px', 'base width should derive from measured tile');
  assert.strictEqual(rootStyle.getPropertyValue('--wdash-base-height'), '720px', 'base height should derive from measured tile');
  assert.strictEqual(layoutState.baseDimensions.desktop.width, 960, 'desktop base width should match measurement');
  assert.strictEqual(layoutState.baseDimensions.desktop.height, 720, 'desktop base height should match measurement');

  applyLayoutOverrides({ layout: { baseWidth: 1100 } });
  assert.strictEqual(rootStyle.getPropertyValue('--wdash-base-width'), '1100px', 'override should replace base width');
  assert.strictEqual(rootStyle.getPropertyValue('--wdash-base-height'), '720px', 'override should not affect unspecified base height');

  applyLayoutOverrides();
  assert.strictEqual(rootStyle.getPropertyValue('--wdash-base-width'), '960px', 'clearing overrides should restore measured width');
  assert.strictEqual(rootStyle.getPropertyValue('--wdash-base-height'), '720px', 'clearing overrides should restore measured height');

  setHostSize(skeleton, 1024, 768);
  applyLayoutOverrides();
  assert.strictEqual(rootStyle.getPropertyValue('--wdash-base-width'), '1024px', 'measurement change should update base width');
  assert.strictEqual(rootStyle.getPropertyValue('--wdash-base-height'), '768px', 'measurement change should update base height');

  setHostSize(skeleton, 1140.75, 855.44);
  applyLayoutOverrides();
  assert.strictEqual(
    rootStyle.getPropertyValue('--wdash-base-width'),
    '1140px',
    'fractional measurement should floor the base width'
  );
  assert.strictEqual(
    rootStyle.getPropertyValue('--wdash-base-height'),
    '855px',
    'fractional measurement should floor the base height'
  );
  assert.strictEqual(layoutState.baseDimensions.desktop.width, 1140, 'layout state width should reflect floored measurement');
  assert.strictEqual(layoutState.baseDimensions.desktop.height, 855, 'layout state height should reflect floored measurement');
  const fractionalDiagnostics = layoutState.lastDiagnostics;
  assert(fractionalDiagnostics, 'fractional measurement should populate diagnostics');
  assert.strictEqual(
    fractionalDiagnostics.measurement.sanitized.width,
    1140,
    'diagnostics should report floored measurement width'
  );
  assert.strictEqual(
    fractionalDiagnostics.measurement.sanitized.height,
    855,
    'diagnostics should report floored measurement height'
  );

  setHostSize(skeleton, 0, 0);
  applyLayoutOverrides();
  assert.strictEqual(rootStyle.getPropertyValue('--wdash-base-width'), '1140px', 'missing measurement should retain last width');
  assert.strictEqual(rootStyle.getPropertyValue('--wdash-base-height'), '855px', 'missing measurement should retain last height');

  setHostSize(skeleton, 1280, 720);
  applyLayoutOverrides({ layout: { baseHeight: 650 } });
  assert.strictEqual(rootStyle.getPropertyValue('--wdash-base-width'), '1280px', 'measured width should persist when only height overrides');
  assert.strictEqual(rootStyle.getPropertyValue('--wdash-base-height'), '650px', 'override should replace base height');

  applyLayoutOverrides({
    layout: {
      trackUnit: 'percent',
      desktop: {
        columns: [60, 40],
        rows: [
          { height: 40, columns: ['temp-wind', 'ambient'] },
          { height: 60, columns: ['air', 'rain'] }
        ]
      }
    }
  });

  assert.strictEqual(layoutState.trackUnit, 'percent', 'track unit should update to percent');
  const columnTracks = parseTrackPixels(dashStyle.getPropertyValue('--wdash-grid-columns-desktop'));
  assert.strictEqual(columnTracks.length, 2, 'percent columns should resolve to two tracks');
  assert(Math.abs(columnTracks[0] - 742.8) < 0.1, 'first column should scale to available width');
  assert(Math.abs(columnTracks[1] - 495.2) < 0.1, 'second column should scale to available width');

  const rowTracks = parseTrackPixels(dashStyle.getPropertyValue('--wdash-grid-rows-desktop'));
  assert.strictEqual(rowTracks.length, 2, 'percent rows should resolve to two tracks');
  assert(Math.abs(rowTracks[0] - 271.2) < 0.1, 'first row should scale to available height');
  assert(Math.abs(rowTracks[1] - 406.8) < 0.1, 'second row should scale to available height');

  const gridGap = parseGapValue(dashStyle.getPropertyValue('--wdash-grid-gap-desktop'));
  const frameGap = dashStyle.getPropertyValue('--wdash-frame-gap-desktop');
  const frameGapVertical = parseFrameGapVertical(frameGap);
  const frameGapHorizontal = parseFrameGapHorizontal(frameGap);

  const totalColumnSpan = columnTracks.reduce((sum, value) => sum + value, 0)
    + gridGap * (columnTracks.length - 1)
    + frameGapHorizontal;
  assert(Math.abs(totalColumnSpan - 1280) < 0.5, 'columns plus gaps should match base width');

  const totalRowSpan = rowTracks.reduce((sum, value) => sum + value, 0)
    + gridGap * (rowTracks.length - 1)
    + frameGapVertical;
  assert(Math.abs(totalRowSpan - 720) < 0.5, 'rows plus gaps should match base height');
  assert.strictEqual(rootStyle.getPropertyValue('--wdash-base-width'), '1280px', 'percent override should keep measured width');
  assert.strictEqual(rootStyle.getPropertyValue('--wdash-base-height'), '720px', 'percent override should fall back to measured height');

  const diagnostics = layoutState.lastDiagnostics;
  assert(diagnostics, 'layout diagnostics should be captured');
  assert.strictEqual(diagnostics.trackUnit, 'percent', 'diagnostics should reflect percent track unit');
  assert.strictEqual(diagnostics.base.perBreakpoint.desktop.width, 1280, 'diagnostics should record desktop width');
  assert.strictEqual(diagnostics.base.sources.desktop.width, 'measured', 'diagnostics should mark measured base width');
  assert(diagnostics.percentTracks, 'percent diagnostics should exist');
  const percentRowDesktop = diagnostics.percentTracks.rows.find(entry => entry.breakpoint === 'desktop');
  assert(percentRowDesktop, 'desktop percent row diagnostics should be present');
  assert.deepStrictEqual(percentRowDesktop.percents, [40, 60], 'row percentages should be recorded');
  assert(Math.abs(percentRowDesktop.pixels[0] - 271.2) < 0.1, 'row pixel conversion should be recorded');
  const percentColumnDesktop = diagnostics.percentTracks.columns.find(entry => entry.breakpoint === 'desktop');
  assert(percentColumnDesktop, 'desktop percent column diagnostics should be present');
  assert.deepStrictEqual(percentColumnDesktop.percents, [60, 40], 'column percentages should be recorded');
  assert(Math.abs(percentColumnDesktop.pixels[1] - 495.2) < 0.1, 'column pixel conversion should be recorded');

  console.log('Layout measurement harness passed');
})();
