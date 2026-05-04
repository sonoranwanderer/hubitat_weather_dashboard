'use strict';

const assert = require('assert');
const {
  createTestEnvironment,
  createElement
} = require('./support/fake-dom');
const { createRenderer } = require('../src/render');

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
  dash.appendChild(grid);
  frame.appendChild(dash);
  root.appendChild(frame);
  content.appendChild(root);

  return { tile, content, root };
}

function readScale(root) {
  return Number(root.style.getPropertyValue('--wdash-scale'));
}

function readPixels(root, propertyName) {
  const value = root.style.getPropertyValue(propertyName);
  const match = value.match(/^(-?\d+(?:\.\d+)?)px$/);
  return match ? Number(match[1]) : NaN;
}

function assertScale({ rendererOptions = {}, expectedScale, message }) {
  const { window, document } = createTestEnvironment();
  createRenderer({
    window,
    document,
    globalThis: window,
    ...rendererOptions
  });
  const hooks = window.__WDASH_TEST_HOOKS__;
  const skeleton = buildDashboardSkeleton(document);

  skeleton.root.setBoundingClientRect({
    width: 1600,
    height: 1200,
    top: 0,
    left: 0
  });

  hooks.resetTileMeasurement();
  hooks.setupScaling(skeleton.tile, skeleton.content);

  const rawScale = Math.min(1600 / 1200, 1200 / 900);
  assert(Math.abs(rawScale - 1.3333333333333333) < 0.0001, 'raw scale fixture should exceed 1');
  assert(Math.abs(readScale(skeleton.root) - expectedScale) < 0.0001, message);
  assert(Math.abs(readPixels(skeleton.root, '--wdash-render-width') - (1200 * expectedScale)) < 0.01);
  assert(Math.abs(readPixels(skeleton.root, '--wdash-render-height') - (900 * expectedScale)) < 0.01);
}

(function main() {
  assertScale({
    expectedScale: 1,
    message: 'default renderer scale should remain capped at 1'
  });

  assertScale({
    rendererOptions: { maxScale: 2 },
    expectedScale: 1.3333333333333333,
    message: 'opt-in renderer maxScale should allow raw HTML scale above 1'
  });

  console.log('Scaling max harness passed');
})();
