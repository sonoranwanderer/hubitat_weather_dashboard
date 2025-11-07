/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const { createRenderer } = require('../src/render');
const { applyBoxMetrics } = require('./support/dashboard-test-utils');


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

  function parsePx(value) {
    if (typeof value !== 'string') return NaN;
    const match = value.trim().match(/^(-?\d+(?:\.\d+)?)px$/);
    return match ? Number(match[1]) : NaN;
  }

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="tile-0" class="tile">
        <div class="tile-primary">
          <div class="wdash-root">
            <div class="wdash-frame">
              <div class="wdash">
                <div class="wdash-grid" data-empty="true"></div>
              </div>
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
    const frame = root.querySelector('.wdash-frame');
    const dash = root.querySelector('.wdash');
    return {
      scale: parseFloat(root.style.getPropertyValue('--wdash-scale')),
      renderWidth: parseFloat(root.style.getPropertyValue('--wdash-render-width')),
      renderHeight: parseFloat(root.style.getPropertyValue('--wdash-render-height')),
      rootWidth: parsePx(root?.style?.width || ''),
      rootHeight: parsePx(root?.style?.height || ''),
      rootMaxWidth: parsePx(root?.style?.maxWidth || ''),
      rootMaxHeight: parsePx(root?.style?.maxHeight || ''),
      frameWidth: parsePx(frame?.style?.width || ''),
      frameHeight: parsePx(frame?.style?.height || ''),
      frameMaxWidth: parsePx(frame?.style?.maxWidth || ''),
      frameMaxHeight: parsePx(frame?.style?.maxHeight || ''),
      dashWidth: parsePx(dash?.style?.width || ''),
      dashHeight: parsePx(dash?.style?.height || ''),
      dashTransform: dash?.style?.transform || '',
      dashTransformOrigin: dash?.style?.transformOrigin || '',
      dashZoom: dash && dash.style && dash.style.zoom ? Number(dash.style.zoom) : NaN
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
      const {
        scale,
        renderWidth,
        renderHeight,
        rootWidth,
        rootHeight,
        rootMaxWidth,
        rootMaxHeight,
        frameWidth,
        frameHeight,
        frameMaxWidth,
        frameMaxHeight,
        dashWidth,
        dashHeight,
        dashTransform,
        dashTransformOrigin,
        dashZoom
      } = readScaleState();
      const expectedScale = Math.min(
        scenario.width / baseWidth,
        scenario.height / baseHeight
      );
      const expectedRenderWidth = baseWidth * expectedScale;
      const expectedRenderHeight = baseHeight * expectedScale;
      expect(Math.abs(scale - expectedScale) < 1e-6).toBe(true);
      expect(Math.abs(renderWidth - expectedRenderWidth) < 1e-4).toBe(true);
      expect(Math.abs(renderHeight - expectedRenderHeight) < 1e-4).toBe(true);
      expect(Math.abs(rootWidth - scenario.width) < 1e-4).toBe(true);
      expect(Math.abs(rootHeight - scenario.height) < 1e-4).toBe(true);
      expect(Math.abs(rootMaxWidth - scenario.width) < 1e-4).toBe(true);
      expect(Math.abs(rootMaxHeight - scenario.height) < 1e-4).toBe(true);
      expect(Math.abs(frameWidth - expectedRenderWidth) < 1e-4).toBe(true);
      expect(Math.abs(frameHeight - expectedRenderHeight) < 1e-4).toBe(true);
      expect(Math.abs(frameMaxWidth - expectedRenderWidth) < 1e-4).toBe(true);
      expect(Math.abs(frameMaxHeight - expectedRenderHeight) < 1e-4).toBe(true);
      expect(Math.abs(dashWidth - baseWidth) < 1e-4).toBe(true);
      expect(Math.abs(dashHeight - baseHeight) < 1e-4).toBe(true);
      expect(dashTransform.startsWith('scale(')).toBe(true);
      const transformValue = Number(dashTransform.slice(6, -1));
      expect(Math.abs(transformValue - expectedScale) < 1e-6).toBe(true);
      expect(dashTransformOrigin).toBe('top left');
      expect(Math.abs(dashZoom - expectedScale) < 1e-6).toBe(true);
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

  it('clamps legacy layout base dimensions to the minimum defaults', () => {
    const originalWarn = console.warn;
    const warnCalls = [];
    console.warn = (...args) => warnCalls.push(args);

    const legacyLayout = {
      baseWidth: 960,
      baseHeight: 920,
      desktop: { baseWidth: 960, baseHeight: 920 },
      tablet: { baseWidth: 940, baseHeight: 900 },
      mobile: { baseWidth: 920, baseHeight: 880 }
    };

    hooks.applyLayoutOverrides({ layout: legacyLayout });

    const dims = hooks.layoutState.baseDimensions;
    const minWidth = hooks.layoutState.baseMinimum.width;
    const minHeight = hooks.layoutState.baseMinimum.height;
    expect(dims.desktop.width).toBe(minWidth);
    expect(dims.desktop.height).toBe(minHeight);
    expect(dims.tablet.width).toBe(minWidth);
    expect(dims.tablet.height).toBe(minHeight);
    expect(dims.mobile.width).toBe(minWidth);
    expect(dims.mobile.height).toBe(minHeight);
    expect(Array.isArray(hooks.layoutState.baseClampAdjustments)).toBe(true);
    expect(hooks.layoutState.baseClampAdjustments.length > 0).toBe(true);

    const warningCall = warnCalls.find(call =>
      String(call[0]).includes('Layout base dimensions below the supported minimum')
    );
    expect(Boolean(warningCall)).toBe(true);

    console.warn = originalWarn;
  });

  it('does not clamp percent-based layouts when smaller bases are intentional', () => {
    const originalWarn = console.warn;
    const warnCalls = [];
    console.warn = (...args) => warnCalls.push(args);

    currentMeasurement = { width: 600, height: 600 };
    hooks.resolveMeasuredBaseDimensions({ measurement: currentMeasurement });

    hooks.applyLayoutOverrides({
      layout: {
        trackUnit: 'percent',
        baseWidth: 600,
        baseHeight: 600,
        desktop: { baseWidth: 600, baseHeight: 600, columns: '50% 50%' }
      }
    });

    const dims = hooks.layoutState.baseDimensions.desktop;
    expect(dims.width).toBe(600);
    expect(dims.height).toBe(600);
    expect(Array.isArray(hooks.layoutState.baseClampAdjustments)).toBe(true);
    expect(hooks.layoutState.baseClampAdjustments.length).toBe(0);

    const warningCall = warnCalls.find(call =>
      String(call[0]).includes('Layout base dimensions below the supported minimum')
    );
    expect(Boolean(warningCall)).toBe(false);

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

    const baseWidth = hooks.layoutState.baseDimensions.desktop.width;
    const baseHeight = hooks.layoutState.baseDimensions.desktop.height;

    const initial = capture();
    expect(initial).not.toBeNull();
    expect(initial.container.width).toBe(currentMeasurement.width);
    expect(initial.container.height).toBe(currentMeasurement.height);
    expect(initial.inline?.root?.width).toBe(currentMeasurement.width);
    expect(initial.inline?.root?.height).toBe(currentMeasurement.height);
    const initialScale = initial.scale?.applied || 0;
    const expectedInitialRenderWidth = baseWidth * initialScale;
    const expectedInitialRenderHeight = baseHeight * initialScale;
    expect(Math.abs((initial.inline?.frame?.width || 0) - expectedInitialRenderWidth) < 1e-4).toBe(true);
    expect(Math.abs((initial.inline?.frame?.height || 0) - expectedInitialRenderHeight) < 1e-4).toBe(true);
    if (initial.inline?.dash?.zoom != null) {
      expect(Math.abs(initial.inline.dash.zoom - initialScale) < 1e-6).toBe(true);
    }

    const updates = [];
    const unsubscribe = subscribe(diag => {
      updates.push(diag);
    });
    expect(typeof unsubscribe).toBe('function');

    if (onMeasure) {
      onMeasure({ width: 768, height: 1024 });
      onMeasure({ width: 1920, height: 1080 });
    }

    expect(updates.length > 0).toBe(true);
    const last = updates[updates.length - 1];
    expect(last.container.width).toBe(1920);
    expect(last.container.height).toBe(1080);
    const expectedScale = Math.min(1920 / baseWidth, 1080 / baseHeight);
    expect(Math.abs(last.scale.applied - expectedScale) < 1e-6).toBe(true);
    expect(last.scale.clamped).toBe(false);
    expect(Math.abs((last.inline?.root?.width || 0) - 1920) < 1e-4).toBe(true);
    expect(Math.abs((last.inline?.root?.height || 0) - 1080) < 1e-4).toBe(true);
    expect(Math.abs((last.inline?.frame?.width || 0) - (baseWidth * expectedScale)) < 1e-4).toBe(true);
    expect(Math.abs((last.inline?.frame?.height || 0) - (baseHeight * expectedScale)) < 1e-4).toBe(true);
    if (last.inline?.dash?.zoom != null) {
      expect(Math.abs(last.inline.dash.zoom - expectedScale) < 1e-6).toBe(true);
    }

    unsubscribe();

    const previousCount = updates.length;
    if (onMeasure) {
      onMeasure({ width: 640, height: 640 });
    }
    expect(updates.length).toBe(previousCount);
  });

  it('reports layout collisions and overflow in scale diagnostics', () => {
    expect(typeof onMeasure).toBe('function');

    const baseWidth = hooks.layoutState.baseDimensions.desktop.width;
    const baseHeight = hooks.layoutState.baseDimensions.desktop.height;

    currentMeasurement = { width: baseWidth, height: baseHeight };
    if (onMeasure) {
      onMeasure({ width: baseWidth, height: baseHeight });
    }

    applyBoxMetrics(root, { top: 0, left: 0, width: baseWidth, height: baseHeight });
    const frame = root.querySelector('.wdash-frame');
    const dash = root.querySelector('.wdash');
    applyBoxMetrics(frame, { top: 0, left: 0, width: baseWidth, height: baseHeight });
    applyBoxMetrics(dash, { top: 0, left: 0, width: baseWidth, height: baseHeight });

    const grid = dash.querySelector('.wdash-grid');
    grid.dataset.empty = 'false';
    grid.innerHTML = `
      <section class="wdash-card wdash-card--temp-wind"></section>
      <section class="wdash-card wdash-card--ambient"></section>
      <section class="wdash-card wdash-card--rain"></section>
    `;

    const cards = Array.from(grid.querySelectorAll('.wdash-card'));
    const tempCard = cards[0];
    const ambientCard = cards[1];
    const rainCard = cards[2];

    applyBoxMetrics(tempCard, { top: 0, left: 0, width: baseWidth / 2, height: 520 });
    applyBoxMetrics(ambientCard, { top: 0, left: baseWidth / 2, width: baseWidth / 2, height: 520 });
    applyBoxMetrics(rainCard, { top: 520, left: 0, width: baseWidth / 2, height: 220 });

    if (onMeasure) {
      onMeasure({ width: baseWidth, height: baseHeight });
    }

    const baseline = hooks.captureScaleDiagnostics();
    expect(baseline.layout).not.toBeNull();
    expect(baseline.layout.summary.hasCollisions).toBe(false);
    expect(baseline.layout.summary.hasOverflow).toBe(false);

    const originalWarn = console.warn;
    const warnCalls = [];
    console.warn = (...args) => warnCalls.push(args);

    applyBoxMetrics(rainCard, { top: 480, left: 0, width: baseWidth / 2, height: 260 });
    if (onMeasure) {
      onMeasure({ width: baseWidth, height: baseHeight });
    }

    const collisionDiag = hooks.captureScaleDiagnostics();
    expect(collisionDiag.layout.summary.hasCollisions).toBe(true);
    expect(Array.isArray(collisionDiag.layout.collisions)).toBe(true);
    const collisionParticipants = collisionDiag.layout.collisions
      .reduce((acc, entry) => acc.concat(entry.cards || []), []);
    expect(collisionParticipants.includes('temp-wind')).toBe(true);
    expect(collisionParticipants.includes('rain')).toBe(true);

    applyBoxMetrics(ambientCard, { top: 0, left: baseWidth - 40, width: baseWidth / 2, height: 520 });
    if (onMeasure) {
      onMeasure({ width: baseWidth, height: baseHeight });
    }

    const overflowDiag = hooks.captureScaleDiagnostics();
    expect(overflowDiag.layout.summary.hasOverflow).toBe(true);
    const overflowKeys = overflowDiag.layout.overflow.cards.map(entry => entry.key || entry.area);
    expect(overflowKeys.includes('ambient')).toBe(true);

    expect(warnCalls.some(call => String(call[0]).includes('overlapping dashboard cards'))).toBe(true);
    expect(warnCalls.some(call => String(call[0]).includes('content exceeds the available frame'))).toBe(true);

    console.warn = originalWarn;
  });

  it('reduces scale when collisions persist and reports adjustments', () => {
    expect(typeof onMeasure).toBe('function');

    const baseWidth = hooks.layoutState.baseDimensions.desktop.width;
    const baseHeight = hooks.layoutState.baseDimensions.desktop.height;
    const frame = root.querySelector('.wdash-frame');
    const dash = root.querySelector('.wdash');
    const grid = dash.querySelector('.wdash-grid');

    const readScale = () => {
      const value = root.style.getPropertyValue('--wdash-scale');
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : 1;
    };

    frame.getBoundingClientRect = () => {
      const scaleValue = readScale();
      const width = baseWidth * scaleValue;
      const height = baseHeight * scaleValue;
      return {
        top: 0,
        left: 0,
        x: 0,
        y: 0,
        right: width,
        bottom: height,
        width,
        height
      };
    };
    dash.getBoundingClientRect = frame.getBoundingClientRect;

    grid.dataset.empty = 'false';
    grid.innerHTML = `
      <section class="wdash-card wdash-card--temp-wind"></section>
      <section class="wdash-card wdash-card--ambient"></section>
    `;

    const [tempCard, ambientCard] = grid.querySelectorAll('.wdash-card');
    const columnWidth = baseWidth / 2;
    const rowOneHeight = 520;
    const rowTwoTop = rowOneHeight + 14;
    const rowTwoHeight = 240;

    tempCard.getBoundingClientRect = () => {
      const scaleValue = readScale();
      const width = columnWidth * scaleValue;
      const height = rowOneHeight * scaleValue;
      return {
        top: 0,
        left: 0,
        x: 0,
        y: 0,
        right: width,
        bottom: height,
        width,
        height
      };
    };

    ambientCard.getBoundingClientRect = () => {
      const scaleValue = readScale();
      const overlapOffset = scaleValue > 0.53 ? -50 : 0;
      const top = (rowTwoTop + overlapOffset) * scaleValue;
      const height = rowTwoHeight * scaleValue;
      const left = 0;
      const width = columnWidth * scaleValue;
      return {
        top,
        left,
        x: left,
        y: top,
        right: left + width,
        bottom: top + height,
        width,
        height
      };
    };

    const measurement = { width: 660, height: 680 };
    currentMeasurement = { ...measurement };
    hooks.resolveMeasuredBaseDimensions({ measurement });
    if (onMeasure) {
      onMeasure(measurement);
    }

    const diagnostics = hooks.captureScaleDiagnostics();
    expect(diagnostics).not.toBeNull();
    expect(Math.abs(diagnostics.scale.raw - (measurement.width / baseWidth)) < 1e-3).toBe(true);
    expect(diagnostics.scale.applied < diagnostics.scale.raw).toBe(true);
    expect(diagnostics.warning).toBe('layout-adjusted');
    expect(Array.isArray(diagnostics.scale.adjustments)).toBe(true);
    expect(diagnostics.scale.adjustments.length > 0).toBe(true);
    expect(diagnostics.layout.summary.hasCollisions).toBe(false);
    expect(diagnostics.layout.summary.hasOverflow).toBe(false);
    const lastAdjustment = diagnostics.scale.adjustments[diagnostics.scale.adjustments.length - 1];
    expect(Math.abs(lastAdjustment.to - diagnostics.scale.applied) < 1e-6).toBe(true);
  });
});
