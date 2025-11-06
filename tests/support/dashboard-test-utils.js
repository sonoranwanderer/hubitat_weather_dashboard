'use strict';

const fs = require('fs');
const path = require('path');

const jsdomModulePath = path.resolve(__dirname, '../../node_modules/jsdom');
const jsdomStubPath = path.resolve(__dirname, '../../vendor/jsdom-stub');
const { JSDOM } = require(fs.existsSync(jsdomModulePath) ? jsdomModulePath : jsdomStubPath);
const { createRenderer } = require('../../src/render');

function createDomRect(rect = {}) {
  const width = Number(rect.width) || 0;
  const height = Number(rect.height) || 0;
  const top = Number(rect.top) || 0;
  const left = Number(rect.left) || 0;
  const right = rect.right != null ? Number(rect.right) : left + width;
  const bottom = rect.bottom != null ? Number(rect.bottom) : top + height;

  return {
    x: left,
    y: top,
    width,
    height,
    top,
    left,
    right,
    bottom
  };
}

function applyBoxMetrics(element, rect = {}) {
  if (!element) return;
  const box = createDomRect(rect);

  const getter = () => ({
    ...box,
    toJSON() {
      return { ...box };
    }
  });

  element.getBoundingClientRect = getter;
  element.getClientRects = () => ({
    length: 1,
    item: () => getter(),
    [0]: getter()
  });

  const widthGetter = () => box.width;
  const heightGetter = () => box.height;

  Object.defineProperty(element, 'offsetWidth', {
    configurable: true,
    get: widthGetter
  });
  Object.defineProperty(element, 'offsetHeight', {
    configurable: true,
    get: heightGetter
  });
  Object.defineProperty(element, 'clientWidth', {
    configurable: true,
    get: widthGetter
  });
  Object.defineProperty(element, 'clientHeight', {
    configurable: true,
    get: heightGetter
  });
}

function createDashboardDom(options = {}) {
  const {
    displayTileId = 'tile-0',
    displayRect = { width: 1200, height: 900 },
    dataTiles = []
  } = options;

  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    pretendToBeVisual: true,
    url: 'http://localhost/'
  });

  const { window } = dom;
  const { document } = window;

  const displayTile = document.createElement('div');
  displayTile.setAttribute('id', displayTileId);
  displayTile.classList.add('tile');

  const displayPrimary = document.createElement('div');
  displayPrimary.classList.add('tile-primary');
  displayTile.appendChild(displayPrimary);
  document.body.appendChild(displayTile);

  const root = document.createElement('div');
  root.classList.add('wdash-root');
  const frame = document.createElement('div');
  frame.classList.add('wdash-frame');
  const wrapper = document.createElement('div');
  wrapper.classList.add('wdash');
  const grid = document.createElement('div');
  grid.classList.add('wdash-grid');
  grid.dataset.empty = 'true';

  wrapper.appendChild(grid);
  frame.appendChild(wrapper);
  root.appendChild(frame);
  displayPrimary.appendChild(root);

  const rects = [displayTile, displayPrimary, root, frame, wrapper, grid];
  rects.forEach(element => applyBoxMetrics(element, displayRect));

  const normalizedTiles = Array.isArray(dataTiles) ? dataTiles : [];

  normalizedTiles.forEach((tile, index) => {
    const id = tile && tile.id ? String(tile.id) : `tile-${index + 1}`;
    const host = document.createElement('div');
    host.setAttribute('id', id);
    const hostClass = tile && tile.className ? tile.className : 'tile';
    host.classList.add(...String(hostClass).split(/\s+/).filter(Boolean));

    const primary = document.createElement('div');
    const primaryClass = tile && tile.primaryClass ? tile.primaryClass : 'tile-primary';
    primary.classList.add(...String(primaryClass).split(/\s+/).filter(Boolean));

    if (tile && Object.prototype.hasOwnProperty.call(tile, 'textContent')) {
      primary.textContent = tile.textContent;
    } else if (tile && Object.prototype.hasOwnProperty.call(tile, 'html')) {
      primary.innerHTML = tile.html;
    }

    host.appendChild(primary);
    document.body.appendChild(host);

    const rect = tile && tile.rect ? tile.rect : { width: 400, height: 200 };
    applyBoxMetrics(host, rect);
    applyBoxMetrics(primary, rect);

    if (tile && typeof tile.mutate === 'function') {
      tile.mutate({ host, primary, document });
    }
  });

  return {
    dom,
    window,
    document,
    displayTile,
    displayPrimary,
    root,
    frame,
    wrapper,
    grid
  };
}

function applyTestGlobals(window) {
  window.__WDASH_TEST_MODE__ = true;
  window.__WDASH_TEST_HOOKS__ = window.__WDASH_TEST_HOOKS__ || {};

  if (!window.MutationObserver) {
    window.MutationObserver = class {
      constructor() {}
      observe() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    };
  }

  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      constructor() {}
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }

  if (!window.matchMedia) {
    window.matchMedia = () => ({
      matches: false,
      media: '',
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      }
    });
  }

  return window.__WDASH_TEST_HOOKS__;
}

function bootstrapRenderer(options = {}) {
  const env = createDashboardDom(options);
  const hooks = applyTestGlobals(env.window);
  createRenderer({
    window: env.window,
    document: env.document,
    globalThis: env.window
  });
  return {
    ...env,
    hooks
  };
}

function normalizeMarkup(markup) {
  if (!markup) return '';
  return markup
    .replace(/\r?\n/g, '')
    .replace(/>\s+</g, '><')
    .trim();
}

module.exports = {
  applyBoxMetrics,
  applyTestGlobals,
  bootstrapRenderer,
  createDashboardDom,
  normalizeMarkup
};
