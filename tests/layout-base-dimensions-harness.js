'use strict';

const assert = require('assert');
const {
  createTestEnvironment,
  loadWeatherDashboard,
  createElement
} = require('./support/fake-dom');

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

  setHostSize(skeleton, 0, 0);
  applyLayoutOverrides();
  assert.strictEqual(rootStyle.getPropertyValue('--wdash-base-width'), '1024px', 'missing measurement should retain last width');
  assert.strictEqual(rootStyle.getPropertyValue('--wdash-base-height'), '768px', 'missing measurement should retain last height');

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
  assert.strictEqual(dashStyle.getPropertyValue('--wdash-grid-columns-desktop'), '60% 40%', 'columns should normalize to percentages');
  assert.strictEqual(dashStyle.getPropertyValue('--wdash-grid-rows-desktop'), '40% 60%', 'rows should normalize to percentages');
  assert.strictEqual(rootStyle.getPropertyValue('--wdash-base-width'), '1280px', 'percent override should keep measured width');
  assert.strictEqual(rootStyle.getPropertyValue('--wdash-base-height'), '720px', 'percent override should fall back to measured height');

  console.log('Layout measurement harness passed');
})();
