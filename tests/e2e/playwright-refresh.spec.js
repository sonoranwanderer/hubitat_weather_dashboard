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
  await page.goto('http://localhost/?hub=192.168.0.10&appId=123&token=abc123&devices=45,46&interval=100&maxBackoff=500');
  page.queueResponse(successResponse(minimalPayload));
  page.queueResponse(successResponse(minimalPayload));
  await page.loadWeatherDashboardApp();

  await page.waitForFunction(win => {
    const app = win.__WEATHER_DASHBOARD_APP__;
    return app && app.state && app.state.status && app.state.status.level === 'success';
  }, { timeout: 5000, interval: 25 });

  const state = await page.evaluate(win => {
    const app = win.__WEATHER_DASHBOARD_APP__;
    const text = (win.document.querySelector('#tile-1 .tile-primary')?.textContent || '').trim();
    return app && app.state
      ? {
          failureStreak: app.state.failureStreak,
          nextDelay: app.state.nextDelay,
          pollIntervalMs: app.state.pollIntervalMs,
          endpointUrl: app.state.endpointUrl,
          statusLevel: app.state.status.level,
          payloadText: text
        }
      : null;
  });

  expect(Boolean(state)).toBe(true);
  expect(state.statusLevel).toBe('success');
  expect(state.failureStreak).toBe(0);
  expect(state.pollIntervalMs).toBe(5000);
  expect(state.nextDelay).toBe(5000);
  expect(state.endpointUrl).toContain('/apps/api/123/dashboard');
  if (state.payloadText) {
    expect(state.payloadText.startsWith('{')).toBe(true);
    expect(state.payloadText).toContain('"outdoor"');
  }
});

test('backs off after Maker API failures and recovers on success', async ({ page }) => {
  await page.goto('http://localhost/?hub=192.168.0.10&appId=321&token=xyz789&devices=99&interval=80&maxBackoff=320');
  page.queueResponse(errorResponse(503, 'Dashboard payload unavailable.'));
  page.queueResponse(successResponse(minimalPayload));
  page.queueResponse(successResponse(minimalPayload));
  await page.loadWeatherDashboardApp();

  await page.waitForFunction(win => {
    const app = win.__WEATHER_DASHBOARD_APP__;
    return app && app.state && app.state.status && app.state.status.level === 'error';
  }, { timeout: 5000, interval: 25 });

  const errorState = await page.evaluate(win => {
    const app = win.__WEATHER_DASHBOARD_APP__;
    return app && app.state
      ? {
          level: app.state.status.level,
          details: app.state.status.details.slice(),
          nextDelay: app.state.nextDelay
        }
      : null;
  });

  expect(Boolean(errorState)).toBe(true);
  expect(errorState.level).toBe('error');
  expect(errorState.details.join(' ')).toContain('Retrying');
  expect(errorState.nextDelay).toBeGreaterThanOrEqual(5000);
  expect(errorState.nextDelay).toBeLessThanOrEqual(10000);

  await page.waitForFunction(win => {
    const app = win.__WEATHER_DASHBOARD_APP__;
    return app && app.state && app.state.status && app.state.status.level === 'success' && app.state.failureStreak === 0;
  }, { timeout: 12000, interval: 25 });

  const recovered = await page.evaluate(win => {
    const app = win.__WEATHER_DASHBOARD_APP__;
    return app && app.state
      ? {
          failureStreak: app.state.failureStreak,
          nextDelay: app.state.nextDelay,
          pollIntervalMs: app.state.pollIntervalMs,
          lastSuccessAt: app.state.lastSuccessAt
        }
      : null;
  });

  expect(Boolean(recovered)).toBe(true);
  expect(recovered.failureStreak).toBe(0);
  expect(recovered.nextDelay).toBe(5000);
  expect(recovered.pollIntervalMs).toBe(5000);
  expect(Number.isFinite(recovered.lastSuccessAt)).toBe(true);
});

run().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
