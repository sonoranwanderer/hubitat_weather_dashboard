'use strict';

const assert = require('assert');
const path = require('path');
const { JSDOM } = require('../vendor/jsdom-stub');

function makePayload(temp = 76.2) {
  return {
    metadata: { generatedAt: '2026-05-06T12:00:00Z' },
    outdoor: { temperature: temp, humidity: 33 },
    wind: { speedMph: 4.4, directionDegrees: 180 }
  };
}

function setupAppEnvironment(options = {}) {
  const search = options.search || '?hubBaseUrl=http%3A%2F%2Fhubitat.local&appId=123&makerToken=token&deviceIds=10,11&statusBar=no&pollIntervalMs=5000&maxBackoffMs=20000';
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: `http://localhost/local/weather-dashboard-app.html${search}`,
    pretendToBeVisual: true
  });
  const { window } = dom;
  window.location = {
    href: `http://localhost/local/weather-dashboard-app.html${search}`,
    search
  };
  const timers = [];
  const clearedTimers = [];
  const renderCalls = [];
  const postedMessages = [];
  const fetchCalls = [];
  const responses = Array.isArray(options.responses) ? options.responses.slice() : [
    { ok: true, status: 200, statusText: 'OK', text: JSON.stringify(makePayload()) }
  ];

  window.parent = {
    postMessage(message) {
      postedMessages.push(message);
    }
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
      renderCalls.push(window.document.querySelector('#tile-1 .tile-primary')?.textContent || '');
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
  delete require.cache[appPath];
  require(appPath);

  return { window, timers, clearedTimers, renderCalls, postedMessages, fetchCalls };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));
}

(async () => {
  const env = setupAppEnvironment({
    responses: [
      { ok: true, text: JSON.stringify({ devices: [{ id: '10', attributes: [{ name: 'segmentCore', currentValue: JSON.stringify(makePayload(80.1)) }] }] }) },
      { ok: false, status: 503, statusText: 'Service Unavailable', text: JSON.stringify({ message: 'Hub busy' }) },
      { ok: true, text: JSON.stringify(makePayload(81.5)) }
    ]
  });
  const api = env.window.__WEATHER_DASHBOARD_APP__;
  assert(api, 'app public API should be installed');

  api.refreshNow();
  await flushMicrotasks();
  assert(env.fetchCalls[0].includes('/apps/api/123/devices/all'));
  assert(env.fetchCalls[0].includes('deviceIds=10%2C11'));
  assert(env.fetchCalls[0].includes('access_token=token'));
  assert(env.renderCalls.length === 1, 'successful fetch should render payload text');
  assert(api.state.statusBarVisible === false, 'statusBar=no should hide success status after successful renders');
  assert(api.state.failureStreak === 0);

  api.refreshNow();
  await flushMicrotasks();
  assert(api.state.failureStreak === 1, 'failed fetch increments failure streak');
  assert(api.state.status.level === 'error');
  assert(api.state.status.details.some(detail => detail.includes('HTTP 503')));

  api.reconfigure();
  assert(api.state.endpointUrl.includes('/apps/api/123/devices/all'));

  const badEnv = setupAppEnvironment({ search: '?hubBaseUrl=&appId=&makerToken=' });
  badEnv.window.__WEATHER_DASHBOARD_APP__.reconfigure();
  assert(badEnv.window.__WEATHER_DASHBOARD_APP__.state.status.level === 'error');
  assert(badEnv.window.__WEATHER_DASHBOARD_APP__.state.configErrors.length > 0);

  delete global.window;
  delete global.document;
  delete global.location;

  console.log('weather-dashboard-app-harness.js passed');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
