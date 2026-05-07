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

  api.refreshNow();
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

  api.refreshNow();
  await flushMicrotasks();
  assert(api.state.status.level === 'error', 'malformed device payload should surface a render error');
  assert(api.state.status.details.some(detail => detail.includes('invalid JSON')));

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

  delete global.window;
  delete global.document;
  delete global.location;

  console.log('weather-dashboard-app-harness.js passed');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
