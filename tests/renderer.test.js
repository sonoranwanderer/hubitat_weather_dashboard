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

describe('Renderer scaling with host measurements', () => {
  let hooks;
  let currentMeasurement;
  let measureMock;
  let observeMock;
  let onMeasure;
  let displayTile;
  let content;
  let root;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="tile-0" class="tile">
        <div class="tile-primary">
          <div class="wdash-root">
            <div class="wdash">
              <div class="wdash-grid" data-empty="true"></div>
            </div>
          </div>
        </div>
      </div>
    `;
    window.__WDASH_TEST_MODE__ = true;
    currentMeasurement = { width: 320, height: 480 };
    measureMock = input => {
      measureMock.calls.push(input);
      return { ...currentMeasurement };
    };
    measureMock.calls = [];
    observeMock = input => {
      observeMock.calls.push(input);
      onMeasure = typeof input?.onMeasure === 'function' ? input.onMeasure : null;
      return {
        disconnect() {
          observeMock.disconnects += 1;
        }
      };
    };
    observeMock.calls = [];
    observeMock.disconnects = 0;

    createRenderer({
      window,
      document,
      globalThis: window,
      container: document.getElementById('tile-0'),
      measure: measureMock,
      observe: observeMock
    });

    hooks = window.__WDASH_TEST_HOOKS__;
    displayTile = document.getElementById('tile-0');
    content = displayTile.querySelector('.tile-primary');
    root = content.querySelector('.wdash-root');

    hooks.resetTileMeasurement();
    hooks.resolveMeasuredBaseDimensions({ measurement: currentMeasurement });
    hooks.applyLayoutOverrides();
    hooks.setupScaling(displayTile, content);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    onMeasure = null;
  });

  function readScaleState() {
    return {
      scale: parseFloat(root.style.getPropertyValue('--wdash-scale')),
      renderWidth: parseFloat(root.style.getPropertyValue('--wdash-render-width')),
      renderHeight: parseFloat(root.style.getPropertyValue('--wdash-render-height'))
    };
  }

  it('recomputes scale for observed container sizes', () => {
    expect(typeof onMeasure).toBe('function');

    const baseWidth = hooks.layoutState.baseDimensions.desktop.width;
    const baseHeight = hooks.layoutState.baseDimensions.desktop.height;

    const scenarios = [
      { width: 320, height: 480 },
      { width: 768, height: 1024 },
      { width: 1920, height: 1080 }
    ];

    scenarios.forEach(scenario => {
      currentMeasurement = { width: scenario.width, height: scenario.height };
      if (onMeasure) {
        onMeasure({ width: scenario.width, height: scenario.height });
      }
      const { scale, renderWidth, renderHeight } = readScaleState();
      const expectedScale = Math.min(
        scenario.width / baseWidth,
        scenario.height / baseHeight
      );
      const expectedRenderWidth = baseWidth * expectedScale;
      const expectedRenderHeight = baseHeight * expectedScale;
      expect(Math.abs(scale - expectedScale) < 1e-6).toBe(true);
      expect(Math.abs(renderWidth - expectedRenderWidth) < 1e-4).toBe(true);
      expect(Math.abs(renderHeight - expectedRenderHeight) < 1e-4).toBe(true);
    });
  });

  it('warns when measurement constraints require clamping', () => {
    expect(typeof onMeasure).toBe('function');
    const originalWarn = console.warn;
    const warnCalls = [];
    console.warn = function (...args) {
      warnCalls.push(args);
    };
    const tinyMeasurement = { width: 60, height: 60 };
    currentMeasurement = { ...tinyMeasurement };
    if (onMeasure) {
      onMeasure({ width: tinyMeasurement.width, height: tinyMeasurement.height });
    }
    const { scale } = readScaleState();
    expect(Math.abs(scale - 0.1) < 1e-6).toBe(true);
    const warningCall = warnCalls.find(call => String(call[0]).includes('Container is smaller'));
    expect(Boolean(warningCall)).toBe(true);
    console.warn = originalWarn;
  });

  it('preserves configured gaps for percent-based layout overrides', () => {
    const dash = content.querySelector('.wdash');
    const baseWidth = hooks.layoutState.baseDimensions.desktop.width;
    const baseHeight = hooks.layoutState.baseDimensions.desktop.height;
    const stableMeasurement = { width: baseWidth, height: baseHeight };
    currentMeasurement = { ...stableMeasurement };
    hooks.resolveMeasuredBaseDimensions({ measurement: stableMeasurement });
    hooks.applyLayoutOverrides();
    if (onMeasure) {
      onMeasure(stableMeasurement);
    }

    const originalWarn = console.warn;
    const warnCalls = [];
    console.warn = function (...args) {
      warnCalls.push(args);
    };

    hooks.applyLayoutOverrides({
      layout: {
        trackUnit: 'percent',
        desktop: {
          gap: 'var(--wdash-gap)',
          columns: ['50%', '50%'],
          rows: [
            { columns: ['temp-wind', 'ambient'], height: 60 },
            { columns: ['air', 'rain'], height: 40 }
          ]
        }
      }
    });

    expect(dash.style.getPropertyValue('--wdash-grid-gap-desktop')).toBe('var(--wdash-gap)');
    const diagnostics = hooks.layoutState.lastDiagnostics;
    expect(Boolean(diagnostics)).toBe(true);
    const percentTracks = diagnostics.percentTracks || { columns: [], rows: [] };
    if (Array.isArray(percentTracks.columns) && percentTracks.columns.length) {
      const desktopColumn = percentTracks.columns.find(entry => entry && entry.breakpoint === 'desktop');
      if (desktopColumn) {
        expect(Math.abs(desktopColumn.scale - 1) < 1e-6).toBe(true);
      }
    }
    if (Array.isArray(percentTracks.rows) && percentTracks.rows.length) {
      const desktopRow = percentTracks.rows.find(entry => entry && entry.breakpoint === 'desktop');
      if (desktopRow) {
        expect(Math.abs(desktopRow.scale - 1) < 1e-6).toBe(true);
      }
    }
    expect(warnCalls.length).toBe(0);
    console.warn = originalWarn;
  });

  it('exposes scale diagnostics snapshots and subscriptions', () => {
    const capture = hooks.captureScaleDiagnostics;
    const subscribe = hooks.subscribeScaleDiagnostics;
    expect(typeof capture).toBe('function');
    expect(typeof subscribe).toBe('function');

    const initial = capture();
    expect(initial).not.toBeNull();
    expect(initial.container.width).toBe(currentMeasurement.width);
    expect(initial.container.height).toBe(currentMeasurement.height);

    const updates = [];
    const unsubscribe = subscribe(diag => {
      updates.push(diag);
    });
    expect(typeof unsubscribe).toBe('function');

    if (onMeasure) {
      onMeasure({ width: 768, height: 1024 });
      onMeasure({ width: 1920, height: 1080 });
    }

    const baseWidth = hooks.layoutState.baseDimensions.desktop.width;
    const baseHeight = hooks.layoutState.baseDimensions.desktop.height;

    expect(updates.length > 0).toBe(true);
    const last = updates[updates.length - 1];
    expect(last.container.width).toBe(1920);
    expect(last.container.height).toBe(1080);
    const expectedScale = Math.min(1920 / baseWidth, 1080 / baseHeight);
    expect(Math.abs(last.scale.applied - expectedScale) < 1e-6).toBe(true);
    expect(last.scale.clamped).toBe(false);

    unsubscribe();

    const previousCount = updates.length;
    if (onMeasure) {
      onMeasure({ width: 640, height: 640 });
    }
    expect(updates.length).toBe(previousCount);
  });
});
