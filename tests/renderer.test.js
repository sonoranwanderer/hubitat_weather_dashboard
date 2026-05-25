/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const { createRenderer } = require('../src/render');
const { bootstrapRenderer } = require('./support/dashboard-test-utils');


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

describe('Renderer resize observer lifecycle', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('reuses the ambient ring observer across repeated renders', () => {
    const createdObservers = [];
    global.ResizeObserver = class ResizeObserver {
      constructor(callback) {
        this.callback = callback;
        this.observed = [];
        this.disconnected = false;
        createdObservers.push(this);
      }

      observe(element) {
        this.observed.push(element);
      }

      unobserve() {}

      disconnect() {
        this.disconnected = true;
      }
    };

    const { hooks, document: dashboardDocument, window: dashboardWindow } = bootstrapRenderer();
    dashboardWindow.ResizeObserver = global.ResizeObserver;
    const ambient = dashboardDocument.createElement('div');
    ambient.classList.add('wdash-ambient');
    dashboardDocument.body.appendChild(ambient);

    hooks.setupAmbientRingResizeSync(ambient);
    hooks.setupAmbientRingResizeSync(ambient);
    hooks.setupAmbientRingResizeSync(ambient);

    const firstState = hooks.getAmbientRingResizeState();
    expect(firstState.target).toBe(ambient);
    hooks.setupAmbientRingResizeSync(ambient);
    hooks.setupAmbientRingResizeSync(ambient);
    expect(hooks.getAmbientRingResizeState().observer).toBe(firstState.observer);

    hooks.teardownAmbientRingResizeSync();
    expect(hooks.getAmbientRingResizeState().observer).toBe(null);
    expect(hooks.getAmbientRingResizeState().target).toBe(null);
  });
});

describe('Renderer payload and layout branches', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('merges partial payload segments and ignores empty segment envelopes', () => {
    const { hooks } = bootstrapRenderer();
    const merged = hooks.mergePayloads([
      { segmentIndex: 1, segmentSize: 3 },
      {
        segmentIndex: 2,
        segmentSize: 3,
        ambientSensors: [{ name: 'Second', ordinal: 2 }],
        totalAmbientSensors: 2,
        metadata: { generatedAt: '2026-05-06T12:00:00Z' }
      },
      {
        segmentIndex: 3,
        segmentSize: 3,
        ambientSensors: [{ name: 'First', ordinal: 1 }],
        layout: { desktop: { gap: '8px' } },
        metadata: { weatherStationTimezone: 'America/Phoenix' },
        outdoor: { temperature: 82 }
      }
    ]);

    expect(merged.outdoor.temperature).toBe(82);
    expect(merged.ambientSensors[0].name).toBe('First');
    expect(merged.ambientSensors[1].name).toBe('Second');
    expect(merged.totalAmbientSensors).toBe(2);
    expect(merged.metadata.generatedAt).toBe('2026-05-06T12:00:00Z');
    expect(merged.metadata.weatherStationTimezone).toBe('America/Phoenix');
    expect(merged.metadata.layout.desktop.gap).toBe('8px');

    expect(hooks.mergePayloads([{ segmentIndex: 1, segmentSize: 2 }])).toBe(null);
  });

  it('falls back to default layout when metadata layout is invalid', () => {
    const { hooks } = bootstrapRenderer();
    hooks.applyLayoutOverrides({ layout: 'not-json' });
    expect(hooks.layoutState.baseWidth).toBe(1200);
    expect(hooks.layoutState.baseHeight).toBe(900);
  });

  it('accepts bounded CSS track functions without regex backtracking', () => {
    const { hooks, wrapper } = bootstrapRenderer();
    hooks.applyLayoutOverrides({
      layout: {
        desktop: {
          rows: [
            { height: 'minmax(0, calc(40px + 1fr))', columns: ['temp-wind'] },
            { height: 'clamp(120px, 30%, 320px)', columns: ['ambient'] },
            { height: "calc('".repeat(260), columns: ['rain'] }
          ]
        }
      }
    });

    const rows = wrapper.style.getPropertyValue('--wdash-grid-rows-desktop');
    expect(rows).toContain('minmax(0, calc(40px + 1fr))');
    expect(rows).toContain('clamp(120px, 30%, 320px)');
    expect(rows).toContain('minmax(0, 1fr)');
    expect(rows).not.toContain("calc('");
  });

  it('renders full-capability cards with the mobile percent layout including lightning', () => {
    const { hooks, window: dashboardWindow, grid, wrapper } = bootstrapRenderer({
      displayRect: { width: 390, height: 844 }
    });
    dashboardWindow.matchMedia = query => ({
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

    const fixturePath = path.resolve(__dirname, 'fixtures/full-capabilities.json');
    const payload = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    payload.metadata = {
      ...(payload.metadata || {}),
      layout: {
        trackUnit: 'percent',
        mobile: {
          columns: [76, 14],
          gap: '6px',
          rows: [
            { height: 32, columns: ['temp-wind', 'temp-wind'] },
            { height: 26, columns: ['ambient', 'lightning'] },
            { height: 26, columns: ['rain', 'rain'] },
            { height: 26, columns: ['pressure', 'pressure'] },
            { height: 26, columns: ['solar', 'solar'] },
            { height: 15, columns: ['air', 'air'] }
          ]
        }
      }
    };

    hooks.render(payload, grid);
    hooks.applyLayoutOverrides(payload.metadata);

    expect(grid.querySelector('.wdash-card--temp-wind')).not.toBeNull();
    expect(grid.querySelector('.wdash-card--ambient')).not.toBeNull();
    expect(grid.querySelector('.wdash-card--lightning')).not.toBeNull();
    expect(grid.querySelector('.wdash-card--rain')).not.toBeNull();
    expect(grid.querySelector('.wdash-card--pressure')).not.toBeNull();
    expect(grid.querySelector('.wdash-card--solar')).not.toBeNull();
    expect(grid.querySelector('.wdash-card--air')).not.toBeNull();
    expect(wrapper.dataset.layoutHasLightning).toBe('true');
    expect(wrapper.style.getPropertyValue('--wdash-grid-areas-mobile')).toContain('"ambient lightning"');
    expect(hooks.layoutState.lastDiagnostics.base.activeBreakpoint).toBe('mobile');
  });

  it('renders lightning recency in minutes and flashes the icon for sub-hour strikes', () => {
    const { hooks, grid } = bootstrapRenderer();
    const originalNow = Date.now;
    Date.now = () => Date.parse('2026-05-25T12:00:00Z');

    try {
      hooks.render({
        metadata: { weatherStationTimezone: 'UTC' },
        lightning: {
          time: '2026-05-25T11:42:30Z',
          distanceMi: 4.5,
          count: 3,
          battery: 72
        }
      }, grid);

      const lightningCard = grid.querySelector('.wdash-card--lightning');
      const labels = Array.from(lightningCard.querySelectorAll('.wdash-lightning-label')).map(node => node.textContent);
      const values = Array.from(lightningCard.querySelectorAll('.wdash-lightning-value')).map(node => node.textContent);

      expect(labels[0]).toBe('Minutes Ago');
      expect(values[0]).toBe('17');
      expect(lightningCard.querySelector('.wdash-lightning-header-icon').classList.contains('wdash-lightning-header-icon--active')).toBe(true);
    } finally {
      Date.now = originalNow;
    }
  });

  it('renders lightning recency in hours without flashing after the first hour', () => {
    const { hooks, grid } = bootstrapRenderer();
    const originalNow = Date.now;
    Date.now = () => Date.parse('2026-05-25T12:00:00Z');

    try {
      hooks.render({
        metadata: { weatherStationTimezone: 'UTC' },
        lightning: {
          time: '2026-05-25T09:15:00Z',
          distanceMi: 4.5,
          count: 3,
          battery: 72
        }
      }, grid);

      const lightningCard = grid.querySelector('.wdash-card--lightning');
      const labels = Array.from(lightningCard.querySelectorAll('.wdash-lightning-label')).map(node => node.textContent);
      const values = Array.from(lightningCard.querySelectorAll('.wdash-lightning-value')).map(node => node.textContent);

      expect(labels[0]).toBe('Hours Ago');
      expect(values[0]).toBe('2');
      expect(lightningCard.querySelector('.wdash-lightning-header-icon').classList.contains('wdash-lightning-header-icon--active')).toBe(false);
    } finally {
      Date.now = originalNow;
    }
  });

  it('keeps day-based lightning recency for strikes older than a day', () => {
    const { hooks, grid } = bootstrapRenderer();
    const originalNow = Date.now;
    Date.now = () => Date.parse('2026-05-25T12:00:00Z');

    try {
      hooks.render({
        metadata: { weatherStationTimezone: 'UTC' },
        lightning: {
          time: '2026-05-22T10:00:00Z',
          distanceMi: 4.5,
          count: 3,
          battery: 72
        }
      }, grid);

      const lightningCard = grid.querySelector('.wdash-card--lightning');
      const labels = Array.from(lightningCard.querySelectorAll('.wdash-lightning-label')).map(node => node.textContent);
      const values = Array.from(lightningCard.querySelectorAll('.wdash-lightning-value')).map(node => node.textContent);

      expect(labels[0]).toBe('Days Ago');
      expect(values[0]).toBe('3');
      expect(lightningCard.querySelector('.wdash-lightning-header-icon').classList.contains('wdash-lightning-header-icon--active')).toBe(false);
    } finally {
      Date.now = originalNow;
    }
  });

  it('applies metadata unit defaults and preserves user overrides', () => {
    const { hooks } = bootstrapRenderer();
    hooks.applyTemperatureUnitsFromMetadata({ temperatureDisplayUnit: 'C', temperatureInputUnit: 'F' });
    expect(hooks.getDisplayTemperatureUnit()).toBe('C');
    hooks.setTemperatureDisplayUnit('F');
    expect(hooks.getDisplayTemperatureUnit()).toBe('F');
    hooks.applyTemperatureUnitsFromMetadata({ temperatureDisplayUnit: 'C', temperatureInputUnit: 'F' });
    expect(hooks.getDisplayTemperatureUnit()).toBe('F');
  });
});
