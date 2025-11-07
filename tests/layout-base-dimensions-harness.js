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

function parsePxValue(value) {
  if (typeof value !== 'string') return NaN;
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)px$/);
  return match ? Number(match[1]) : NaN;
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

function setTileSize(skeleton, width, height) {
  skeleton.tile.setBoundingClientRect({ width, height, top: 0, left: 0 });
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

  const designWidth = layoutState.baseDimensions.desktop.width;
  const designHeight = layoutState.baseDimensions.desktop.height;
  const designWidthPx = `${designWidth}px`;
  const designHeightPx = `${designHeight}px`;

  assert.strictEqual(
    rootStyle.getPropertyValue('--wdash-base-width'),
    designWidthPx,
    'base width should default to the design width'
  );
  assert.strictEqual(
    rootStyle.getPropertyValue('--wdash-base-height'),
    designHeightPx,
    'base height should default to the design height'
  );
  assert.strictEqual(layoutState.baseDimensions.desktop.width, designWidth, 'layout state should track design base width');
  assert.strictEqual(layoutState.baseDimensions.desktop.height, designHeight, 'layout state should track design base height');

  const initialScale = parseFloat(rootStyle.getPropertyValue('--wdash-scale'));
  const expectedInitialScale = Math.min(960 / designWidth, 720 / designHeight);
  assert(Math.abs(initialScale - expectedInitialScale) < 0.0001, 'scale should shrink the design to the measured tile');
  assert(Math.abs(parsePxValue(rootStyle.getPropertyValue('--wdash-render-width')) - designWidth * expectedInitialScale) < 0.01, 'render width should follow tile width');
  assert(Math.abs(parsePxValue(rootStyle.getPropertyValue('--wdash-render-height')) - designHeight * expectedInitialScale) < 0.01, 'render height should follow tile height');

  const initialDiagnostics = layoutState.lastDiagnostics;
  assert(initialDiagnostics, 'initial diagnostics should exist');
  assert.strictEqual(initialDiagnostics.base.sources.desktop.width, 'default', 'base width source should remain default');
  assert.strictEqual(initialDiagnostics.base.sources.desktop.height, 'default', 'base height source should remain default');
  assert.strictEqual(initialDiagnostics.measurement.sanitized.width, 960, 'diagnostics should report measured width');
  assert.strictEqual(initialDiagnostics.measurement.sanitized.height, 720, 'diagnostics should report measured height');

  applyLayoutOverrides({ layout: { baseWidth: 1100 } });
  assert.strictEqual(rootStyle.getPropertyValue('--wdash-base-width'), '1100px', 'override should replace base width');
  assert.strictEqual(
    rootStyle.getPropertyValue('--wdash-base-height'),
    designHeightPx,
    'override should leave unspecified base height at the design value'
  );
  const widthOverrideDiagnostics = layoutState.lastDiagnostics;
  assert(widthOverrideDiagnostics, 'override diagnostics should exist');
  assert.strictEqual(widthOverrideDiagnostics.base.sources.desktop.width, 'layout-override', 'base width source should reflect override');
  assert.strictEqual(widthOverrideDiagnostics.base.sources.desktop.height, 'default', 'base height source should remain default');

  applyLayoutOverrides();
  assert.strictEqual(rootStyle.getPropertyValue('--wdash-base-width'), designWidthPx, 'clearing overrides should restore design width');
  assert.strictEqual(rootStyle.getPropertyValue('--wdash-base-height'), designHeightPx, 'clearing overrides should restore design height');

  setHostSize(skeleton, 1024, 768);
  applyLayoutOverrides();
  const expandedRenderWidth = parsePxValue(rootStyle.getPropertyValue('--wdash-render-width'));
  const expandedRenderHeight = parsePxValue(rootStyle.getPropertyValue('--wdash-render-height'));
  const expandedDiagnostics = layoutState.lastDiagnostics;
  assert(expandedDiagnostics, 'expanded diagnostics should exist');
  const currentLimitingWidth = expandedDiagnostics.measurement.sanitized.width;
  const currentLimitingHeight = expandedDiagnostics.measurement.sanitized.height;
  const expandedExpectedScale = Math.min(currentLimitingWidth / designWidth, currentLimitingHeight / designHeight);
  assert(
    Math.abs(expandedRenderWidth - designWidth * expandedExpectedScale) < 0.5,
    'render width should remain clamped to the limiting measurement when the host grows'
  );
  assert(
    Math.abs(expandedRenderHeight - designHeight * expandedExpectedScale) < 0.5,
    'render height should remain clamped to the limiting measurement when the host grows'
  );
  assert.strictEqual(
    currentLimitingWidth,
    initialDiagnostics.measurement.sanitized.width,
    'measurement should continue reporting the limiting width'
  );
  assert.strictEqual(
    currentLimitingHeight,
    initialDiagnostics.measurement.sanitized.height,
    'measurement should continue reporting the limiting height'
  );

  setHostSize(skeleton, 1140.75, 855.44);
  applyLayoutOverrides();
  assert.strictEqual(
    rootStyle.getPropertyValue('--wdash-base-width'),
    designWidthPx,
    'fractional measurement should keep the design width'
  );
  assert.strictEqual(
    rootStyle.getPropertyValue('--wdash-base-height'),
    designHeightPx,
    'fractional measurement should keep the design height'
  );
  assert.strictEqual(layoutState.baseDimensions.desktop.width, designWidth, 'layout state width should remain at the design width');
  assert.strictEqual(layoutState.baseDimensions.desktop.height, designHeight, 'layout state height should remain at the design height');
  const fractionalDiagnostics = layoutState.lastDiagnostics;
  assert(fractionalDiagnostics, 'fractional measurement should populate diagnostics');
  assert.strictEqual(
    fractionalDiagnostics.measurement.sanitized.width,
    960,
    'diagnostics should continue reporting the limiting width'
  );
  assert.strictEqual(
    fractionalDiagnostics.measurement.sanitized.height,
    720,
    'diagnostics should continue reporting the limiting height'
  );

  setHostSize(skeleton, 0, 0);
  applyLayoutOverrides();
  assert.strictEqual(rootStyle.getPropertyValue('--wdash-base-width'), designWidthPx, 'missing measurement should retain design width');
  assert.strictEqual(rootStyle.getPropertyValue('--wdash-base-height'), designHeightPx, 'missing measurement should retain design height');

  setHostSize(skeleton, 1280, 720);
  applyLayoutOverrides({ layout: { baseHeight: 650 } });
  assert.strictEqual(rootStyle.getPropertyValue('--wdash-base-width'), designWidthPx, 'design width should persist when only height overrides');
  assert.strictEqual(rootStyle.getPropertyValue('--wdash-base-height'), '650px', 'override should replace base height');
  assert.strictEqual(layoutState.baseDimensions.desktop.width, designWidth, 'layout state width should remain at design width');
  assert.strictEqual(layoutState.baseDimensions.desktop.height, 650, 'layout state height should follow override');
  const heightOverrideDiagnostics = layoutState.lastDiagnostics;
  assert(heightOverrideDiagnostics, 'height override diagnostics should exist');
  assert.strictEqual(heightOverrideDiagnostics.base.sources.desktop.height, 'layout-override', 'base height source should reflect override');

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
  const percentBaseWidth = layoutState.baseDimensions.desktop.width;
  const percentBaseHeight = layoutState.baseDimensions.desktop.height;
  const percentBaseWidthPx = `${percentBaseWidth}px`;
  const percentBaseHeightPx = `${percentBaseHeight}px`;
  const columnTracks = parseTrackPixels(dashStyle.getPropertyValue('--wdash-grid-columns-desktop'));
  assert.strictEqual(columnTracks.length, 2, 'percent columns should resolve to two tracks');
  const columnTotal = columnTracks.reduce((sum, value) => sum + value, 0);
  assert(Math.abs(columnTracks[0] / columnTotal - 0.6) < 0.001, 'first column should maintain 60% share');
  assert(Math.abs(columnTracks[1] / columnTotal - 0.4) < 0.001, 'second column should maintain 40% share');

  const rowTracks = parseTrackPixels(dashStyle.getPropertyValue('--wdash-grid-rows-desktop'));
  assert.strictEqual(rowTracks.length, 2, 'percent rows should resolve to two tracks');
  const rowTotal = rowTracks.reduce((sum, value) => sum + value, 0);
  assert(Math.abs(rowTracks[0] / rowTotal - 0.4) < 0.001, 'first row should maintain 40% share');
  assert(Math.abs(rowTracks[1] / rowTotal - 0.6) < 0.001, 'second row should maintain 60% share');

  const gridGap = parseGapValue(dashStyle.getPropertyValue('--wdash-grid-gap-desktop'));
  const frameGap = dashStyle.getPropertyValue('--wdash-frame-gap-desktop');
  const frameGapVertical = parseFrameGapVertical(frameGap);
  const frameGapHorizontal = parseFrameGapHorizontal(frameGap);

  const totalColumnSpan = columnTracks.reduce((sum, value) => sum + value, 0)
    + gridGap * (columnTracks.length - 1)
    + frameGapHorizontal;
  assert(Math.abs(totalColumnSpan - percentBaseWidth) < 0.5, 'columns plus gaps should match base width');

  const totalRowSpan = rowTracks.reduce((sum, value) => sum + value, 0)
    + gridGap * (rowTracks.length - 1)
    + frameGapVertical;
  assert(Math.abs(totalRowSpan - percentBaseHeight) < 0.5, 'rows plus gaps should match base height');
  assert.strictEqual(rootStyle.getPropertyValue('--wdash-base-width'), percentBaseWidthPx, 'percent override should keep measured width');
  assert.strictEqual(rootStyle.getPropertyValue('--wdash-base-height'), percentBaseHeightPx, 'percent override should fall back to measured height');

  const diagnostics = layoutState.lastDiagnostics;
  assert(diagnostics, 'layout diagnostics should be captured');
  assert.strictEqual(diagnostics.trackUnit, 'percent', 'diagnostics should reflect percent track unit');
  assert.strictEqual(diagnostics.base.perBreakpoint.desktop.width, percentBaseWidth, 'diagnostics should record desktop width');
  assert.strictEqual(diagnostics.base.sources.desktop.width, 'measured', 'diagnostics should mark measured base width');
  assert(diagnostics.percentTracks, 'percent diagnostics should exist');
  const percentRowDesktop = diagnostics.percentTracks.rows.find(entry => entry.breakpoint === 'desktop');
  assert(percentRowDesktop, 'desktop percent row diagnostics should be present');
  assert.deepStrictEqual(percentRowDesktop.percents, [40, 60], 'row percentages should be recorded');
  assert(Math.abs(percentRowDesktop.pixels[0] / percentRowDesktop.available - 0.4) < 0.001, 'row pixel conversion should reflect 40% share');
  assert(Math.abs(percentRowDesktop.finalPixels - percentRowDesktop.available) < 0.1, 'row pixels should fill available height');
  assert(percentRowDesktop.remainder <= 0.1, 'row remainder should be near zero');
  const percentColumnDesktop = diagnostics.percentTracks.columns.find(entry => entry.breakpoint === 'desktop');
  assert(percentColumnDesktop, 'desktop percent column diagnostics should be present');
  assert.deepStrictEqual(percentColumnDesktop.percents, [60, 40], 'column percentages should be recorded');
  assert(Math.abs(percentColumnDesktop.pixels[1] / percentColumnDesktop.available - 0.4) < 0.001, 'column pixel conversion should reflect 40% share');
  assert(Math.abs(percentColumnDesktop.finalPixels - percentColumnDesktop.available) < 0.1, 'column pixels should fill available width');
  assert(percentColumnDesktop.remainder <= 0.1, 'column remainder should be near zero');

  // When the tile is smaller than the content container ensure the tile bounds win.
  setHostSize(skeleton, 1400, 900);
  setTileSize(skeleton, 1100, 640);
  applyLayoutOverrides();
  assert.strictEqual(rootStyle.getPropertyValue('--wdash-base-width'), '1100px', 'tile width should constrain base width');
  assert.strictEqual(rootStyle.getPropertyValue('--wdash-base-height'), '640px', 'tile height should constrain base height');
  const boundedDiagnostics = layoutState.lastDiagnostics;
  assert(boundedDiagnostics, 'bounded diagnostics should exist');
  assert.strictEqual(
    boundedDiagnostics.measurement.sanitized.width,
    1100,
    'sanitized measurement width should match tile'
  );
  assert.strictEqual(
    boundedDiagnostics.measurement.sanitized.height,
    640,
    'sanitized measurement height should match tile'
  );
  assert.strictEqual(
    boundedDiagnostics.measurement.widthSource && boundedDiagnostics.measurement.widthSource.role,
    'tile',
    'width source should report tile'
  );
  assert.strictEqual(
    boundedDiagnostics.measurement.heightSource && boundedDiagnostics.measurement.heightSource.role,
    'tile',
    'height source should report tile'
  );

  console.log('Layout measurement harness passed');
})();
