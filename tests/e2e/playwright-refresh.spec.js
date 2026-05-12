#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { createRunner } = require('./support/playwright-stub');

const { test, expect, run } = createRunner();

const payloadPath = path.resolve(__dirname, '../fixtures/minimal-outdoor.json');
const minimalPayload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));

function successResponse(payload) {
  return { status: 200, json: payload };
}

function errorResponse(status, message) {
  return { status, json: { message } };
}

test('renders Maker API payload and schedules refreshes', async ({ page }) => {
  await page.goto('http://localhost/?hubBaseUrl=192.168.0.10&appId=123&makerToken=abc123&deviceIds=45,46&interval=100&maxBackoff=500');
  page.queueResponse(successResponse(minimalPayload));
  page.queueResponse(successResponse(minimalPayload));
  await page.loadWeatherDashboardApp();

  await page.waitForFunction(win => {
    const app = win.__WEATHER_DASHBOARD_APP__;
    if (!app) return false;
    const state = app.state;
    return Boolean(state && state.status && state.status.level === 'success');
  }, { timeout: 5000, interval: 25 });

  const state = await page.evaluate(win => {
    const app = win.__WEATHER_DASHBOARD_APP__;
    if (!app) return null;
    const snapshot = app.state;
    if (!snapshot) return null;
    const text = (win.document.querySelector('#tile-1 .tile-primary')?.textContent || '').trim();
    return {
      failureStreak: snapshot.failureStreak,
      nextDelay: snapshot.nextDelay,
      pollIntervalMs: snapshot.pollIntervalMs,
      endpointUrl: snapshot.endpointUrl,
      redactedEndpointUrl: snapshot.redactedEndpointUrl,
      statusLevel: snapshot.status.level,
      statusDetails: snapshot.status.details.slice(),
      payloadText: text
    };
  });

  expect(Boolean(state)).toBe(true);
  expect(state.statusLevel).toBe('success');
  expect(state.failureStreak).toBe(0);
  expect(state.pollIntervalMs).toBe(5000);
  expect(state.nextDelay).toBe(5000);
  expect(state.endpointUrl).toContain('/apps/api/123/devices/all');
  expect(state.endpointUrl).toContain('access_token=REDACTED');
  expect(state.redactedEndpointUrl).toContain('access_token=REDACTED');
  expect(state.endpointUrl.includes('abc123')).toBe(false);
  expect(state.statusDetails.join(' ').includes('abc123')).toBe(false);
  expect(state.endpointUrl).toContain('deviceIds=45%2C46');
  if (state.payloadText) {
    expect(state.payloadText.startsWith('{')).toBe(true);
    expect(state.payloadText).toContain('"outdoor"');
  }
});

test('statusBar=yes keeps the success panel visible', async ({ page }) => {
  await page.goto('http://localhost/?hubBaseUrl=192.168.0.10&appId=123&makerToken=abc123&deviceIds=45,46&statusBar=yes');
  page.queueResponse(successResponse(minimalPayload));
  page.queueResponse(successResponse(minimalPayload));
  await page.loadWeatherDashboardApp();

  await page.waitForFunction(win => {
    const app = win.__WEATHER_DASHBOARD_APP__;
    return Boolean(app && app.state && app.state.status && app.state.status.level === 'success');
  }, { timeout: 5000, interval: 25 });

  const snapshot = await page.evaluate(win => {
    const app = win.__WEATHER_DASHBOARD_APP__;
    const status = win.document.body.querySelector('.wdash-app-status');
    return {
      statusBarVisible: app.state.statusBarVisible,
      statusBarLocked: app.state.statusBarLocked,
      bar: Boolean(status && !status.hidden),
      html: status ? status.innerHTML : ''
    };
  });

  expect(snapshot.statusBarVisible).toBe(true);
  expect(snapshot.statusBarLocked).toBe(true);
  expect(snapshot.bar).toBe(true);
  expect(snapshot.html).toContain('Weather data updated');
});

test('statusBar=no hides the success panel', async ({ page }) => {
  await page.goto('http://localhost/?hubBaseUrl=192.168.0.10&appId=123&makerToken=abc123&deviceIds=45,46&statusBar=no');
  page.queueResponse(successResponse(minimalPayload));
  page.queueResponse(successResponse(minimalPayload));
  await page.loadWeatherDashboardApp();

  await page.waitForFunction(win => {
    const app = win.__WEATHER_DASHBOARD_APP__;
    return Boolean(app && app.state && app.state.status && app.state.status.level === 'success');
  }, { timeout: 5000, interval: 25 });

  const snapshot = await page.evaluate(win => {
    const app = win.__WEATHER_DASHBOARD_APP__;
    const status = win.document.body.querySelector('.wdash-app-status');
    return {
      statusBarVisible: app.state.statusBarVisible,
      statusBarLocked: app.state.statusBarLocked,
      bar: Boolean(status && !status.hidden),
      hidden: Boolean(status && status.hidden),
      html: status ? status.innerHTML : ''
    };
  });

  expect(snapshot.statusBarVisible).toBe(false);
  expect(snapshot.statusBarLocked).toBe(true);
  expect(snapshot.bar).toBe(false);
  expect(snapshot.hidden).toBe(true);
  expect(snapshot.html).toBe('');
});

test('statusBar absent hides the success panel', async ({ page }) => {
  await page.goto('http://localhost/?hubBaseUrl=192.168.0.10&appId=123&makerToken=abc123&deviceIds=45,46');
  page.queueResponse(successResponse(minimalPayload));
  page.queueResponse(successResponse(minimalPayload));
  await page.loadWeatherDashboardApp();

  await page.waitForFunction(win => {
    const app = win.__WEATHER_DASHBOARD_APP__;
    return Boolean(app && app.state && app.state.status && app.state.status.level === 'success');
  }, { timeout: 5000, interval: 25 });

  const snapshot = await page.evaluate(win => {
    const app = win.__WEATHER_DASHBOARD_APP__;
    const status = win.document.body.querySelector('.wdash-app-status');
    return {
      statusBarVisible: app.state.statusBarVisible,
      statusBarLocked: app.state.statusBarLocked,
      bar: Boolean(status && !status.hidden)
    };
  });

  expect(snapshot.statusBarVisible).toBe(false);
  expect(snapshot.statusBarLocked).toBe(false);
  expect(snapshot.bar).toBe(false);
});

test('backs off after Maker API failures and recovers on success', async ({ page }) => {
  await page.goto('http://localhost/?hubBaseUrl=192.168.0.10&appId=321&makerToken=xyz789&deviceIds=99&interval=80&maxBackoff=320');
  page.queueResponse(errorResponse(503, 'Dashboard payload unavailable.'));
  page.queueResponse(successResponse(minimalPayload));
  page.queueResponse(successResponse(minimalPayload));
  await page.loadWeatherDashboardApp();

  await page.waitForFunction(win => {
    const app = win.__WEATHER_DASHBOARD_APP__;
    if (!app) return false;
    const state = app.state;
    return Boolean(state && state.status && state.status.level === 'error');
  }, { timeout: 5000, interval: 25 });

  const errorState = await page.evaluate(win => {
    const app = win.__WEATHER_DASHBOARD_APP__;
    if (!app) return null;
    const snapshot = app.state;
    if (!snapshot) return null;
    return {
      level: snapshot.status.level,
      details: snapshot.status.details.slice(),
      nextDelay: snapshot.nextDelay
    };
  });

  expect(Boolean(errorState)).toBe(true);
  expect(errorState.level).toBe('error');
  expect(errorState.details.join(' ')).toContain('Retrying');
  expect(errorState.nextDelay).toBeGreaterThanOrEqual(5000);
  expect(errorState.nextDelay).toBeLessThanOrEqual(10000);

  await page.waitForFunction(win => {
    const app = win.__WEATHER_DASHBOARD_APP__;
    if (!app) return false;
    const state = app.state;
    return Boolean(state && state.status && state.status.level === 'success' && state.failureStreak === 0);
  }, { timeout: 12000, interval: 25 });

  const recovered = await page.evaluate(win => {
    const app = win.__WEATHER_DASHBOARD_APP__;
    if (!app) return null;
    const snapshot = app.state;
    if (!snapshot) return null;
    return {
      failureStreak: snapshot.failureStreak,
      nextDelay: snapshot.nextDelay,
      pollIntervalMs: snapshot.pollIntervalMs,
      lastSuccessAt: snapshot.lastSuccessAt
    };
  });

  expect(Boolean(recovered)).toBe(true);
  expect(recovered.failureStreak).toBe(0);
  expect(recovered.nextDelay).toBe(5000);
  expect(recovered.pollIntervalMs).toBe(5000);
  expect(Number.isFinite(recovered.lastSuccessAt)).toBe(true);
});

run()
  .then(() => {
    process.exit(0);
  })
  .catch(error => {
    console.error(error.stack || error.message || error);
    process.exit(1);
  });
