/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const { createRenderer } = require('../src/render');


describe('Weather Dashboard Renderer', () => {
  let renderer;
  let testHooks;

  beforeEach(() => {
    document.body.innerHTML = '<div id="tile-0"><div class="tile-primary"></div></div>';
    global.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    global.window.__WDASH_TEST_MODE__ = true; // Indicate test environment

    // The factory attaches test hooks to the window object
    createRenderer({ window, document, globalThis: window });
    testHooks = window.__WDASH_TEST_HOOKS__;
    renderer = testHooks.render;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('should render waiting message when payload is null', () => {
    const grid = document.createElement('div');
    renderer(null, grid);
    expect(grid.innerHTML).toContain('Waiting for weather data…');
    expect(grid.dataset.empty).toBe('true');
  });

  it('should render cards when a valid payload is provided', () => {
    const grid = document.createElement('div');
    const fixturePath = path.resolve(__dirname, 'fixtures/full-capabilities.json');
    const mockPayload = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    renderer(mockPayload, grid);
    expect(grid.querySelector('.wdash-card--temp-wind')).not.toBeNull();
    expect(grid.querySelector('.wdash-card--ambient')).not.toBeNull();
    expect(grid.dataset.empty).toBe('false');
  });
});

describe('Renderer measurement hooks', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="tile-0" class="tile">
        <div class="tile-primary">
          <div class="wdash-root">
            <div class="wdash"></div>
          </div>
        </div>
      </div>
    `;
    window.__WDASH_TEST_MODE__ = true;
    const root = document.querySelector('.wdash-root');
    if (root) {
      root.getBoundingClientRect = () => ({ width: 500, height: 400, top: 0, left: 0, right: 500, bottom: 400 });
    }
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('delegates measurement and observation to injected hooks', () => {
    const measureCalls = [];
    const measureMock = input => {
      measureCalls.push(input);
      return { width: 640, height: 480 };
    };
    const disconnectMock = () => {};
    const observeCalls = [];
    const observeMock = input => {
      observeCalls.push(input);
      return { disconnect: disconnectMock };
    };

    createRenderer({
      window,
      document,
      globalThis: window,
      container: document.getElementById('tile-0'),
      measure: measureMock,
      observe: observeMock
    });

    const hooks = window.__WDASH_TEST_HOOKS__;
    const measurement = hooks.resolveMeasuredBaseDimensions({ commit: false });

    expect(measureCalls.length).toBe(1);
    expect(measureCalls[0].type).toBe('base-dimensions');
    expect(measurement.width).toBe(640);
    expect(measurement.height).toBe(480);

    const displayTile = document.getElementById('tile-0');
    const content = displayTile.querySelector('.tile-primary');
    hooks.setupScaling(displayTile, content);

    expect(observeCalls.length).toBe(1);
    expect(observeCalls[0].type).toBe('base-dimensions');
    expect(typeof observeCalls[0].onMeasure).toBe('function');
  });
});