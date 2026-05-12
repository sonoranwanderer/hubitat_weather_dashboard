'use strict';

const assert = require('assert');
const path = require('path');
const { URLSearchParams } = require('url');
const { JSDOM } = require('../vendor/jsdom-stub');

function makePayload(temp = 76.2) {
  return {
    metadata: { generatedAt: '2026-05-06T12:00:00Z' },
    outdoor: { temperature: temp, humidity: 33 },
    wind: { speedMph: 4.4, directionDegrees: 180 }
  };
}

function assertApprox(actual, expected, tolerance, message) {
  assert(
    Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected}, received ${actual}`
  );
}

function setupAppEnvironment(options = {}) {
  const search = options.search || '?hubBaseUrl=http%3A%2F%2Fhubitat.local&appId=123&makerToken=token&deviceIds=10,11&statusBar=no&pollIntervalMs=5000&maxBackoffMs=20000';
  const inlineConfig = options.inlineConfig
    ? `<script id="weather-dashboard-config" type="application/json">${options.inlineConfig}</script>`
    : '';
  const dom = new JSDOM(`<!doctype html><html><head>${inlineConfig}</head><body></body></html>`, {
    url: `http://localhost/local/weather-dashboard-app.html${search}`,
    pretendToBeVisual: true
  });
  const { window } = dom;
  delete global.window;
  delete global.document;
  delete global.location;
  delete global.URLSearchParams;
  window.location = {
    href: `http://localhost/local/weather-dashboard-app.html${search}`,
    search
  };
  window.innerWidth = options.innerWidth || 1024;
  window.innerHeight = options.innerHeight || 768;
  const timers = [];
  const clearedTimers = [];
  const renderCalls = [];
  const postedMessages = [];
  const fetchCalls = [];
  const listeners = {};
  const responses = Array.isArray(options.responses) ? options.responses.slice() : [
    { ok: true, status: 200, statusText: 'OK', text: JSON.stringify(makePayload()) }
  ];
  if (options.inlineConfig) {
    const script = window.document.createElement('script');
    script.setAttribute('id', 'weather-dashboard-config');
    script.setAttribute('type', 'application/json');
    script.textContent = options.inlineConfig;
    window.document.head.appendChild(script);
    const originalQuerySelector = window.document.querySelector.bind(window.document);
    window.document.querySelector = selector => {
      if (selector === 'script[data-weather-dashboard-config], script#weather-dashboard-config') {
        return script;
      }
      return originalQuerySelector(selector);
    };
  }

  window.parent = {
    postMessage(message) {
      postedMessages.push(message);
    }
  };
  window.addEventListener = (type, callback) => {
    listeners[type] = listeners[type] || [];
    listeners[type].push(callback);
  };
  window.requestAnimationFrame = callback => {
    timers.push({ callback, delay: 16, type: 'raf' });
    return timers.length;
  };
  window.setTimeout = (callback, delay) => {
    timers.push({ callback, delay, type: 'timeout' });
    return timers.length;
  };
  window.clearTimeout = id => clearedTimers.push(id);
  window.fetch = url => {
    fetchCalls.push(url);
    const next = responses.length ? responses.shift() : responses[responses.length - 1];
    if (next instanceof Error) {
      return Promise.reject(next);
    }
    return Promise.resolve({
      ok: next.ok,
      status: next.status || (next.ok ? 200 : 500),
      statusText: next.statusText || '',
      text: () => Promise.resolve(next.text || '')
    });
  };
  window.createLegacyWeatherDashboardRenderer = () => ({
    safeRenderFromData() {
      const findById = (node, id) => {
        if (!node) return null;
        if (node.id === id) return node;
        for (const child of Array.from(node.children || [])) {
          const found = findById(child, id);
          if (found) return found;
        }
        return null;
      };
      const dataTile = window.document.getElementById('tile-1') || findById(window.document.body, 'tile-1');
      const primary = dataTile && Array.from(dataTile.children || []).find(child => (
        child.classList?.contains('tile-primary')
        || String(child.className || '').split(/\s+/).includes('tile-primary')
      ));
      renderCalls.push(primary?.textContent || dataTile?.textContent || '');
    }
  });

  global.window = window;
  global.document = window.document;
  global.location = window.location;
  global.URLSearchParams = URLSearchParams;
  global.requestAnimationFrame = window.requestAnimationFrame;
  global.setTimeout = window.setTimeout;
  global.clearTimeout = window.clearTimeout;
  global.fetch = window.fetch;

  const appPath = path.resolve(__dirname, '../app/weather-dashboard-app.js');
  delete require.cache[require.resolve(appPath)];
  require(appPath);

  return { window, timers, clearedTimers, renderCalls, postedMessages, fetchCalls, listeners };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));
}

function lastRenderedPayload(renderCalls) {
  const rendered = renderCalls.filter(text => text && String(text).trim());
  assert(rendered.length > 0, 'expected a rendered payload');
  return JSON.parse(rendered[rendered.length - 1]);
}

function findElementById(node, id) {
  if (!node) return null;
  if (node.id === id) return node;
  for (const child of Array.from(node.children || [])) {
    const found = findElementById(child, id);
    if (found) return found;
  }
  return null;
}

function runScheduledCallbacks(env, limit = 20) {
  for (let index = 0; index < env.timers.length && index < limit; index += 1) {
    const timer = env.timers[index];
    if (timer.type === 'raf' && typeof timer.callback === 'function') {
      timer.callback();
    }
  }
}

(async () => {
  const env = setupAppEnvironment({
    search: '?statusBar=no',
    inlineConfig: JSON.stringify({
      hubBaseUrl: 'http://inline-hub.local',
      appId: '777',
      makerToken: 'inline-token',
      deviceIds: ['21'],
      pollIntervalMs: 5000,
      maxBackoffMs: 20000
    }),
    responses: [
      { ok: true, text: JSON.stringify({ devices: [{ id: '10', attributes: [{ name: 'segmentCore', currentValue: JSON.stringify(makePayload(80.1)) }] }] }) },
      { ok: false, status: 503, statusText: 'Service Unavailable', text: JSON.stringify({ message: 'Hub busy' }) },
      { ok: true, text: JSON.stringify(makePayload(81.5)) },
      { ok: true, text: JSON.stringify({ devices: [{ id: '21', attributes: [{ name: 'segmentCore', currentValue: '{bad json' }] }] }) }
    ]
  });
  const api = env.window.__WEATHER_DASHBOARD_APP__;
  assert(api, 'app public API should be installed');

  api.refreshNow();
  await flushMicrotasks();
  assert(env.fetchCalls[0].includes('/apps/api/777/devices/all'));
  assert(env.fetchCalls[0].includes('deviceIds=21'));
  assert(env.fetchCalls[0].includes('access_token=inline-token'));
  assert(env.renderCalls.length === 1, 'successful fetch should render payload text');
  assert(api.state.statusBarVisible === false, 'statusBar=no should hide success status after successful renders');
  assert(api.state.failureStreak === 0);
  assert(api.state.endpointUrl.includes('access_token=REDACTED'), 'public endpoint URL should redact token');
  assert(api.state.redactedEndpointUrl.includes('access_token=REDACTED'), 'redacted endpoint should mask token');
  assert(!api.state.endpointUrl.includes('inline-token'), 'public state should not expose raw token');
  assert(api.state.config.makerToken === 'REDACTED', 'public config should redact maker token');
  const mutableSnapshot = api.state;
  mutableSnapshot.config.deviceIds.push('999');
  mutableSnapshot.status.details.push('mutated detail');
  mutableSnapshot.configErrors.push('mutated config error');
  mutableSnapshot.validationWarnings.push('mutated warning');
  assert(!api.state.config.deviceIds.includes('999'), 'public config device IDs should not mutate internal state');
  assert(!api.state.status.details.includes('mutated detail'), 'public status details should not mutate internal state');
  assert(!api.state.configErrors.includes('mutated config error'), 'public config errors should not mutate internal state');
  assert(!api.state.validationWarnings.includes('mutated warning'), 'public validation warnings should not mutate internal state');

  const statusPanel = env.window.document.querySelector('.wdash-app-status');
  assert(statusPanel, 'status panel should exist after initial render');
  assert(statusPanel.hidden === true, 'statusBar=no should hide success status panel');
  const firstStatusHiddenPayload = JSON.parse(env.renderCalls[0]);
  assert(Math.abs(firstStatusHiddenPayload.metadata.layout.baseWidth - 1216.484) < 0.01, 'statusBar=no should not reserve status height during initial render');
  assert.strictEqual(firstStatusHiddenPayload.metadata.layout.baseHeight, 900, 'statusBar=no should keep the full dashboard height during initial render');
  api.refreshNow();
  assert(statusPanel.hidden === true, 'background refresh should not unhide hidden status panel');
  assert(api.state.status.level === 'success', 'background refresh should keep previous status until the fetch resolves');
  await flushMicrotasks();
  assert(api.state.failureStreak === 1, 'failed fetch increments failure streak');
  assert(api.state.status.level === 'error');
  assert(api.state.status.details.some(detail => detail.includes('HTTP 503')));

  api.refreshNow();
  await flushMicrotasks();
  assert(api.state.failureStreak === 0, 'successful recovery resets failure streak');
  assert(env.renderCalls.length === 2, 'recovery fetch should render the direct payload');

  api.reconfigure();
  assert(api.state.endpointUrl.includes('/apps/api/777/devices/all'));
  assert(!api.state.endpointUrl.includes('inline-token'), 'reconfigured public state should not expose raw token');

  api.refreshNow();
  await flushMicrotasks();
  assert(api.state.status.level === 'error', 'malformed device payload should surface a render error');
  assert(api.state.status.details.some(detail => detail.includes('invalid JSON')));

  env.window.innerHeight = 430;
  Object.defineProperty(env.window.document.body, 'scrollHeight', { configurable: true, value: 432 });
  Object.defineProperty(env.window.document.documentElement, 'scrollHeight', { configurable: true, value: 432 });
  (env.listeners.resize || []).forEach(callback => callback());
  const initialTimerCount = env.timers.length;
  assert(env.timers.some(timer => timer.type === 'raf'), 'resize should schedule host size sync');
  for (let index = 0; index < env.timers.length; index += 1) {
    const timer = env.timers[index];
    if (timer.type === 'raf' && typeof timer.callback === 'function') {
      timer.callback();
    }
  }
  assert(env.timers.length >= initialTimerCount, 'resize processing should keep timer queue stable or grow');
  assert(env.postedMessages.some(message => message && message.type === 'weather-dashboard-app:resize'), 'resize should post preview height');
  assert(env.postedMessages.some(message => message && message.height === 434), 'resize should include a small height buffer to avoid iframe clipping');

  delete global.window;
  delete global.document;
  delete global.location;

  const dimensionEnv = setupAppEnvironment({
    search: '?hubBaseUrl=http%3A%2F%2Fhubitat.local&appId=123&makerToken=token&deviceIds=10&width=1000&height=700',
    responses: [
      {
        ok: true,
        text: JSON.stringify({
          ...makePayload(77.7),
          metadata: {
            layout: {
              baseWidth: 1200,
              baseHeight: 900,
              desktop: { baseWidth: 1300, baseHeight: 950 },
              tablet: { baseWidth: 900, baseHeight: 800 },
              mobile: { baseWidth: 480, baseHeight: 900 }
            }
          }
        })
      }
    ]
  });
  dimensionEnv.window.__WEATHER_DASHBOARD_APP__.refreshNow();
  await flushMicrotasks();
  assert(dimensionEnv.fetchCalls.length > 0, 'dimension scenario should fetch Maker API payload');
  assert.strictEqual(dimensionEnv.window.__WEATHER_DASHBOARD_APP__.state.status.level, 'success', JSON.stringify(dimensionEnv.window.__WEATHER_DASHBOARD_APP__.state.status));
  assert.strictEqual(dimensionEnv.window.__WEATHER_DASHBOARD_APP__.state.config.renderWidth, 1000, 'width query parameter should be normalized');
  assert.strictEqual(dimensionEnv.window.__WEATHER_DASHBOARD_APP__.state.config.renderHeight, 700, 'height query parameter should be normalized');
  const dimensionPayload = lastRenderedPayload(dimensionEnv.renderCalls);
  assert(Math.abs(dimensionPayload.metadata.layout.baseWidth - 1285.714) < 0.01, 'width query parameter should set a same-ratio renderer baseWidth');
  assert.strictEqual(dimensionPayload.metadata.layout.baseHeight, 900, 'height query parameter should set a same-ratio renderer baseHeight');
  assert(Math.abs(dimensionPayload.metadata.layout.desktop.baseWidth - 1285.714) < 0.01, 'width query parameter should set desktop baseWidth ratio');
  assert.strictEqual(dimensionPayload.metadata.layout.desktop.baseHeight, 900, 'height query parameter should set desktop baseHeight ratio');
  assert(Math.abs(dimensionPayload.metadata.layout.tablet.baseWidth - 1285.714) < 0.01, 'width query parameter should set tablet baseWidth ratio');
  assert.strictEqual(dimensionPayload.metadata.layout.tablet.baseHeight, 900, 'height query parameter should set tablet baseHeight ratio');
  assert(Math.abs(dimensionPayload.metadata.layout.mobile.baseWidth - 1285.714) < 0.01, 'width query parameter should set mobile baseWidth ratio');
  assert.strictEqual(dimensionPayload.metadata.layout.mobile.baseHeight, 900, 'height query parameter should set mobile baseHeight ratio');

  delete global.window;
  delete global.document;
  delete global.location;

  const portraitPhoneEnv = setupAppEnvironment({
    search: '?hubBaseUrl=http%3A%2F%2Fhubitat.local&appId=123&makerToken=token&deviceIds=10&width=430&height=932',
    responses: [
      { ok: true, text: JSON.stringify(makePayload(77.8)) }
    ]
  });
  portraitPhoneEnv.window.__WEATHER_DASHBOARD_APP__.refreshNow();
  await flushMicrotasks();
  const portraitPhonePayload = lastRenderedPayload(portraitPhoneEnv.renderCalls);
  assertApprox(portraitPhonePayload.metadata.layout.baseWidth, 1200, 0.01, 'portrait phone top-level baseWidth should keep same-ratio base');
  assertApprox(portraitPhonePayload.metadata.layout.baseHeight, 2600.93, 0.01, 'portrait phone top-level baseHeight should keep same-ratio base');
  assertApprox(portraitPhonePayload.metadata.layout.desktop.baseWidth, 1200, 0.01, 'portrait phone desktop baseWidth should keep same-ratio base');
  assertApprox(portraitPhonePayload.metadata.layout.desktop.baseHeight, 2600.93, 0.01, 'portrait phone desktop baseHeight should keep same-ratio base');
  assertApprox(portraitPhonePayload.metadata.layout.tablet.baseWidth, 1200, 0.01, 'portrait phone tablet baseWidth should keep same-ratio base');
  assertApprox(portraitPhonePayload.metadata.layout.tablet.baseHeight, 2600.93, 0.01, 'portrait phone tablet baseHeight should keep same-ratio base');
  assert.strictEqual(portraitPhonePayload.metadata.layout.mobile.baseWidth, 430, 'portrait phone mobile baseWidth should match standalone width');
  assert.strictEqual(portraitPhonePayload.metadata.layout.mobile.baseHeight, 932, 'portrait phone mobile baseHeight should match standalone height');

  delete global.window;
  delete global.document;
  delete global.location;

  const landscapePhoneEnv = setupAppEnvironment({
    search: '?hubBaseUrl=http%3A%2F%2Fhubitat.local&appId=123&makerToken=token&deviceIds=10&width=932&height=430',
    responses: [
      { ok: true, text: JSON.stringify(makePayload(77.9)) }
    ]
  });
  landscapePhoneEnv.window.__WEATHER_DASHBOARD_APP__.refreshNow();
  await flushMicrotasks();
  const landscapePhonePayload = lastRenderedPayload(landscapePhoneEnv.renderCalls);
  assertApprox(landscapePhonePayload.metadata.layout.baseWidth, 1950.698, 0.01, 'landscape phone top-level baseWidth should keep same-ratio base');
  assert.strictEqual(landscapePhonePayload.metadata.layout.baseHeight, 900, 'landscape phone top-level baseHeight should keep same-ratio base');
  assertApprox(landscapePhonePayload.metadata.layout.desktop.baseWidth, 1950.698, 0.01, 'landscape phone desktop baseWidth should keep same-ratio base');
  assert.strictEqual(landscapePhonePayload.metadata.layout.desktop.baseHeight, 900, 'landscape phone desktop baseHeight should keep same-ratio base');
  assert.strictEqual(landscapePhonePayload.metadata.layout.tablet.baseWidth, 932, 'landscape phone tablet baseWidth should match standalone width');
  assert.strictEqual(landscapePhonePayload.metadata.layout.tablet.baseHeight, 430, 'landscape phone tablet baseHeight should match standalone height');
  assertApprox(landscapePhonePayload.metadata.layout.mobile.baseWidth, 1950.698, 0.01, 'landscape phone mobile baseWidth should keep same-ratio base');
  assert.strictEqual(landscapePhonePayload.metadata.layout.mobile.baseHeight, 900, 'landscape phone mobile baseHeight should keep same-ratio base');

  delete global.window;
  delete global.document;
  delete global.location;

  const browserDimensionEnv = setupAppEnvironment({
    search: '?hubBaseUrl=http%3A%2F%2Fhubitat.local&appId=123&makerToken=token&deviceIds=10&statusBar=no',
    innerWidth: 600,
    innerHeight: 350,
    responses: [
      { ok: true, text: JSON.stringify(makePayload(78.1)) }
    ]
  });
  browserDimensionEnv.window.__WEATHER_DASHBOARD_APP__.refreshNow();
  await flushMicrotasks();
  runScheduledCallbacks(browserDimensionEnv);
  const browserDimensionPayload = lastRenderedPayload(browserDimensionEnv.renderCalls);
  assert(Math.abs(browserDimensionPayload.metadata.layout.baseWidth - 1625.806) < 0.01, 'browser viewport should set a same-ratio renderer baseWidth when width is omitted');
  assert.strictEqual(browserDimensionPayload.metadata.layout.baseHeight, 900, 'browser viewport should set a same-ratio renderer baseHeight when height is omitted');
  const browserDisplayTile = findElementById(browserDimensionEnv.window.document.body, 'tile-0');
  assert.strictEqual(browserDisplayTile.style.width, '560px', 'browser viewport should subtract the horizontal inner offset from default width');
  assert.strictEqual(browserDisplayTile.style.height, '310px', 'browser viewport should subtract the vertical inner offset from default height');

  delete global.window;
  delete global.document;
  delete global.location;

  const browserPortraitPhoneEnv = setupAppEnvironment({
    search: '?hubBaseUrl=http%3A%2F%2Fhubitat.local&appId=123&makerToken=token&deviceIds=10&statusBar=no',
    innerWidth: 430,
    innerHeight: 932,
    responses: [
      { ok: true, text: JSON.stringify(makePayload(78.15)) }
    ]
  });
  browserPortraitPhoneEnv.window.__WEATHER_DASHBOARD_APP__.refreshNow();
  await flushMicrotasks();
  runScheduledCallbacks(browserPortraitPhoneEnv);
  const browserPortraitPhonePayload = lastRenderedPayload(browserPortraitPhoneEnv.renderCalls);
  assert.strictEqual(browserPortraitPhonePayload.metadata.layout.mobile.baseWidth, 406, 'browser portrait phone mobile baseWidth should subtract compact horizontal inner offset');
  assert.strictEqual(browserPortraitPhonePayload.metadata.layout.mobile.baseHeight, 908, 'browser portrait phone mobile baseHeight should subtract compact vertical inner offset');
  assertApprox(browserPortraitPhonePayload.metadata.layout.tablet.baseWidth, 1200, 0.01, 'browser portrait phone tablet baseWidth should keep same-ratio base');
  assertApprox(browserPortraitPhonePayload.metadata.layout.tablet.baseHeight, 2683.744, 0.01, 'browser portrait phone tablet baseHeight should keep same-ratio base');
  const browserPortraitDisplayTile = findElementById(browserPortraitPhoneEnv.window.document.body, 'tile-0');
  assert.strictEqual(browserPortraitDisplayTile.style.width, '406px', 'browser portrait phone display should subtract compact horizontal inner offset');
  assert.strictEqual(browserPortraitDisplayTile.style.height, '908px', 'browser portrait phone display should subtract compact vertical inner offset');

  delete global.window;
  delete global.document;
  delete global.location;

  const browserLandscapePhoneEnv = setupAppEnvironment({
    search: '?hubBaseUrl=http%3A%2F%2Fhubitat.local&appId=123&makerToken=token&deviceIds=10&statusBar=no',
    innerWidth: 932,
    innerHeight: 430,
    responses: [
      { ok: true, text: JSON.stringify(makePayload(78.16)) }
    ]
  });
  browserLandscapePhoneEnv.window.__WEATHER_DASHBOARD_APP__.refreshNow();
  await flushMicrotasks();
  runScheduledCallbacks(browserLandscapePhoneEnv);
  const browserLandscapePhonePayload = lastRenderedPayload(browserLandscapePhoneEnv.renderCalls);
  assert.strictEqual(browserLandscapePhonePayload.metadata.layout.tablet.baseWidth, 892, 'browser landscape phone tablet baseWidth should subtract horizontal inner offset');
  assert.strictEqual(browserLandscapePhonePayload.metadata.layout.tablet.baseHeight, 390, 'browser landscape phone tablet baseHeight should subtract vertical inner offset');
  assertApprox(browserLandscapePhonePayload.metadata.layout.desktop.baseWidth, 2058.462, 0.01, 'browser landscape phone desktop baseWidth should keep same-ratio base');
  assert.strictEqual(browserLandscapePhonePayload.metadata.layout.desktop.baseHeight, 900, 'browser landscape phone desktop baseHeight should keep same-ratio base');
  const browserLandscapeDisplayTile = findElementById(browserLandscapePhoneEnv.window.document.body, 'tile-0');
  assert.strictEqual(browserLandscapeDisplayTile.style.width, '892px', 'browser landscape phone display should subtract horizontal inner offset');
  assert.strictEqual(browserLandscapeDisplayTile.style.height, '390px', 'browser landscape phone display should subtract vertical inner offset');

  delete global.window;
  delete global.document;
  delete global.location;

  const statusDimensionEnv = setupAppEnvironment({
    search: '?hubBaseUrl=http%3A%2F%2Fhubitat.local&appId=123&makerToken=token&deviceIds=10&statusBar=yes&width=600&height=350',
    responses: [
      { ok: true, text: JSON.stringify(makePayload(78.2)) }
    ]
  });
  const visibleStatusPanel = findElementById(statusDimensionEnv.window.document.body, 'weather-dashboard-app-status');
  Object.defineProperty(visibleStatusPanel, 'scrollHeight', { configurable: true, value: 50 });
  Object.defineProperty(visibleStatusPanel, 'offsetHeight', { configurable: true, value: 50 });
  statusDimensionEnv.window.__WEATHER_DASHBOARD_APP__.refreshNow();
  await flushMicrotasks();
  runScheduledCallbacks(statusDimensionEnv);
  const statusDimensionPayload = lastRenderedPayload(statusDimensionEnv.renderCalls);
  assert(Math.abs(statusDimensionPayload.metadata.layout.baseWidth - 1928.571) < 0.01, 'visible status bar should reduce the dashboard renderer height');
  assert.strictEqual(statusDimensionPayload.metadata.layout.baseHeight, 900, 'visible status bar should preserve renderer base height');
  const statusDisplayTile = findElementById(statusDimensionEnv.window.document.body, 'tile-0');
  assert.strictEqual(statusDisplayTile.style.width, '600px', 'explicit width should still size the standalone viewport');
  assert.strictEqual(statusDisplayTile.style.height, '280px', 'visible status bar height and gap should be removed from dashboard height');

  delete global.window;
  delete global.document;
  delete global.location;

  const defaultStatusDimensionEnv = setupAppEnvironment({
    search: '?hubBaseUrl=http%3A%2F%2Fhubitat.local&appId=123&makerToken=token&deviceIds=10&width=600&height=350',
    responses: [
      { ok: true, text: JSON.stringify(makePayload(78.3)) }
    ]
  });
  const defaultVisibleStatusPanel = findElementById(defaultStatusDimensionEnv.window.document.body, 'weather-dashboard-app-status');
  Object.defineProperty(defaultVisibleStatusPanel, 'scrollHeight', { configurable: true, value: 50 });
  Object.defineProperty(defaultVisibleStatusPanel, 'offsetHeight', { configurable: true, value: 50 });
  defaultStatusDimensionEnv.window.__WEATHER_DASHBOARD_APP__.refreshNow();
  await flushMicrotasks();
  runScheduledCallbacks(defaultStatusDimensionEnv);
  assert.strictEqual(defaultStatusDimensionEnv.window.__WEATHER_DASHBOARD_APP__.state.statusBarVisible, false, 'omitted statusBar should default to hidden');
  assert.strictEqual(defaultStatusDimensionEnv.window.__WEATHER_DASHBOARD_APP__.state.statusBarLocked, false, 'omitted statusBar should not lock the hidden default');
  const defaultStatusPayload = lastRenderedPayload(defaultStatusDimensionEnv.renderCalls);
  assert(Math.abs(defaultStatusPayload.metadata.layout.baseWidth - 1542.857) < 0.01, 'omitted statusBar should not reserve status height');
  assert.strictEqual(defaultStatusPayload.metadata.layout.baseHeight, 900, 'omitted statusBar should keep full dashboard height');
  const defaultStatusDisplayTile = findElementById(defaultStatusDimensionEnv.window.document.body, 'tile-0');
  assert.strictEqual(defaultStatusDisplayTile.style.width, '600px', 'omitted statusBar should keep explicit width');
  assert.strictEqual(defaultStatusDisplayTile.style.height, '350px', 'omitted statusBar should keep explicit height');

  delete global.window;
  delete global.document;
  delete global.location;

  const invalidDimensionEnv = setupAppEnvironment({
    search: '?hubBaseUrl=http%3A%2F%2Fhubitat.local&appId=123&makerToken=token&deviceIds=10&width=0&height=wide',
    responses: [
      { ok: true, text: JSON.stringify(makePayload(78.4)) }
    ]
  });
  invalidDimensionEnv.window.__WEATHER_DASHBOARD_APP__.refreshNow();
  await flushMicrotasks();
  assert.strictEqual(invalidDimensionEnv.window.__WEATHER_DASHBOARD_APP__.state.config.renderWidth, null, 'invalid width should be ignored');
  assert.strictEqual(invalidDimensionEnv.window.__WEATHER_DASHBOARD_APP__.state.config.renderHeight, null, 'invalid height should be ignored');

  delete global.window;
  delete global.document;
  delete global.location;

  console.log('weather-dashboard-app-harness.js passed');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
