const { JSDOM } = require('jsdom');
const { createLegacyWeatherDashboardRenderer } = require('../src/render');

describe('Weather Dashboard Renderer', () => {
  let dom;
  let window;
  let document;
  let renderer;
  let testHooks;

  beforeEach(() => {
    dom = new JSDOM('<!DOCTYPE html><html><body><div id="tile-0"><div class="tile-primary"></div></div></body></html>', {
      url: 'http://localhost'
    });
    window = dom.window;
    document = window.document;
    global.window = window;
    global.document = document;
    global.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };

    // The factory attaches test hooks to the window object
    createLegacyWeatherDashboardRenderer({ window, document, globalThis: window });
    testHooks = window.__WDASH_TEST_HOOKS__;
    renderer = testHooks.render;
  });

  afterEach(() => {
    // Clean up JSDOM
  });

  it('should render waiting message when payload is null', () => {
    const grid = document.createElement('div');
    renderer(null, grid);
    expect(grid.innerHTML).toContain('Waiting for weather data…');
    expect(grid.dataset.empty).toBe('true');
  });

  it('should render cards when a valid payload is provided', () => {
    const grid = document.createElement('div');
    const mockPayload = require('./fixtures/payload-01.json');
    renderer(mockPayload, grid);
    expect(grid.querySelector('.wdash-card--temp-wind')).not.toBeNull();
    expect(grid.querySelector('.wdash-card--ambient')).not.toBeNull();
    expect(grid.dataset.empty).toBe('false');
  });
});