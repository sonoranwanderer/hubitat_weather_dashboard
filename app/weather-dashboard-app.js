'use strict';

(function bootstrapWeatherDashboardApp(global) {
  if (!global) return;

  const APP_NAMESPACE = '__WEATHER_DASHBOARD_APP__';
  const STYLE_ID = 'weather-dashboard-app-style';
  const HOST_ID = 'weather-dashboard-app-root';
  const STATUS_ID = 'weather-dashboard-app-status';
  const DISPLAY_TILE_ID = 'tile-0';
  const DATA_TILE_ID = 'tile-1';
  const DEFAULT_POLL_INTERVAL_MS = 15000;
  const MIN_POLL_INTERVAL_MS = 5000;
  const DEFAULT_MAX_BACKOFF_MS = 60000;

  const state = {
    renderer: null,
    config: null,
    configErrors: [],
    validationWarnings: [],
    inlineConfigError: null,
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
    maxBackoffMs: DEFAULT_MAX_BACKOFF_MS,
    nextDelay: DEFAULT_POLL_INTERVAL_MS,
    pollTimer: null,
    fetchInFlight: false,
    failureStreak: 0,
    lastSuccessAt: null,
    endpointUrl: null,
    status: { level: 'info', message: 'Initializing…', details: [] }
  };

  let shellElements = null;
  let dataTileContent = null;

  const publicApi = {
    get state() {
      return { ...state };
    },
    refreshNow,
    stop: stopPolling,
    reconfigure: configureAndStart
  };

  try {
    if (!global[APP_NAMESPACE]) {
      Object.defineProperty(global, APP_NAMESPACE, {
        configurable: true,
        enumerable: false,
        value: publicApi
      });
    }
  } catch (err) {
    // ignore globals that cannot be defined
  }

  function whenDomReady(callback) {
    if (!global.document) return;
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', callback, { once: true });
    } else {
      callback();
    }
  }

  function injectStyles() {
    const doc = global.document;
    if (!doc || doc.getElementById(STYLE_ID)) return;
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${HOST_ID} {
        --wdash-app-font: 'Segoe UI', Roboto, -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
        display: flex;
        flex-direction: column;
        gap: 18px;
        padding: 18px;
        box-sizing: border-box;
        min-height: 100vh;
        background: radial-gradient(circle at top, rgba(20,40,80,0.55), rgba(4,10,22,0.92));
        font-family: var(--wdash-app-font);
      }
      #${HOST_ID} .tile {
        position: relative;
      }
      #${STATUS_ID} {
        font-family: var(--wdash-app-font);
        border-radius: 14px;
        padding: 14px 18px;
        color: #e7efff;
        background: linear-gradient(120deg, rgba(26,42,78,0.9), rgba(9,18,38,0.92));
        border: 1px solid rgba(90,138,255,0.45);
        box-shadow: 0 18px 36px rgba(0,0,0,0.45);
        line-height: 1.55;
        font-size: 0.95rem;
      }
      #${STATUS_ID}[data-level="error"] {
        background: linear-gradient(125deg, rgba(72,14,30,0.92), rgba(36,6,14,0.95));
        border-color: rgba(255,110,122,0.62);
        color: #ffe8ec;
      }
      #${STATUS_ID}[data-level="success"] {
        background: linear-gradient(120deg, rgba(14,65,48,0.92), rgba(6,32,25,0.94));
        border-color: rgba(76,214,155,0.55);
        color: #d9fff0;
      }
      #${STATUS_ID}[data-level="loading"] {
        border-style: dashed;
        opacity: 0.88;
      }
      #${STATUS_ID} .wdash-app-status__title {
        font-weight: 700;
        font-size: 1.05rem;
        letter-spacing: 0.015em;
      }
      #${STATUS_ID} .wdash-app-status__details {
        margin-top: 8px;
        font-size: 0.9rem;
        opacity: 0.88;
      }
      #${STATUS_ID} .wdash-app-status__details ul {
        margin: 6px 0 0;
        padding-left: 20px;
      }
      #${STATUS_ID} .wdash-app-status__details li {
        margin: 2px 0;
      }
      .wdash-hidden-tile {
        display: none !important;
      }
    `;
    doc.head.appendChild(style);
  }

  function ensureAndAppend(doc, parent, id, options = {}) {
    if (!doc || !parent) return null;
    const {
      tag = 'div',
      className,
      attributes,
      prepend = false,
      onCreate,
      onEnsure
    } = options;

    let element = id ? doc.getElementById(id) : null;
    if (!element) {
      element = doc.createElement(tag);
      if (id) {
        element.id = id;
      }
      if (className) {
        element.className = className;
      }
      if (attributes) {
        for (const [key, value] of Object.entries(attributes)) {
          if (value != null) {
            element.setAttribute(key, value);
          }
        }
      }
      if (typeof onCreate === 'function') {
        onCreate(element);
      }
      if (prepend && parent.firstChild) {
        parent.insertBefore(element, parent.firstChild);
      } else {
        parent.appendChild(element);
      }
    } else {
      if (prepend && element !== parent.firstChild) {
        parent.insertBefore(element, parent.firstChild || null);
      } else if (element.parentNode !== parent) {
        parent.appendChild(element);
      }
    }

    if (typeof onEnsure === 'function') {
      onEnsure(element);
    }

    return element;
  }

  function ensureAppShell() {
    const doc = global.document;
    if (!doc || !doc.body) return null;

    if (!shellElements) {
      const host = ensureAndAppend(doc, doc.body, HOST_ID);

      const status = ensureAndAppend(doc, host, STATUS_ID, {
        prepend: true,
        onCreate: el => {
          el.dataset.level = 'info';
        },
        onEnsure: el => {
          if (!el.dataset.level) {
            el.dataset.level = 'info';
          }
        }
      });

      const displayTile = ensureAndAppend(doc, host, DISPLAY_TILE_ID, {
        className: 'tile tile--weather-display',
        onEnsure: el => {
          el.classList.add('wdash-host-tile');
        }
      });

      let displayPrimary = displayTile.querySelector('.tile-primary');
      if (!displayPrimary) {
        displayPrimary = doc.createElement('div');
        displayPrimary.className = 'tile-primary';
        displayTile.appendChild(displayPrimary);
      }

      const dataTile = ensureAndAppend(doc, host, DATA_TILE_ID, {
        className: 'tile wdash-hidden-tile',
        attributes: { 'aria-hidden': 'true' },
        onEnsure: el => {
          el.classList.add('wdash-hidden-tile');
          el.setAttribute('aria-hidden', 'true');
        }
      });

      let dataPrimary = dataTile.querySelector('.tile-primary');
      if (!dataPrimary) {
        dataPrimary = doc.createElement('div');
        dataPrimary.className = 'tile-primary';
        dataTile.appendChild(dataPrimary);
      }

      dataTileContent = dataPrimary;
      shellElements = {
        host,
        status,
        displayTile,
        displayPrimary,
        dataTile,
        dataPrimary
      };
    }

    return shellElements;
  }

  function escapeHtml(value) {
    if (value == null) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function updateStatus(level, message, details) {
    const shell = ensureAppShell();
    if (!shell) return;
    const status = shell.status;
    const normalizedDetails = Array.isArray(details)
      ? details.filter(item => item != null && item !== '')
      : (details ? [details] : []);
    state.status = { level, message, details: normalizedDetails.slice() };

    status.dataset.level = level || 'info';
    let markup = `<div class="wdash-app-status__title">${escapeHtml(message || '')}</div>`;
    if (normalizedDetails.length === 1) {
      markup += `<div class="wdash-app-status__details">${escapeHtml(normalizedDetails[0])}</div>`;
    } else if (normalizedDetails.length > 1) {
      const items = normalizedDetails
        .map(item => `<li>${escapeHtml(item)}</li>`)
        .join('');
      markup += `<div class="wdash-app-status__details"><ul>${items}</ul></div>`;
    }
    status.innerHTML = markup;
  }

  function readQueryConfig() {
    const search = global.location ? global.location.search || '' : '';
    const params = new URLSearchParams(search);
    const config = {};
    for (const [key, value] of params.entries()) {
      if (Object.prototype.hasOwnProperty.call(config, key)) {
        const existing = config[key];
        if (Array.isArray(existing)) {
          existing.push(value);
        } else {
          config[key] = [existing, value];
        }
      } else {
        config[key] = value;
      }
    }
    return config;
  }

  function readInlineConfig(doc) {
    const script = doc
      ? doc.querySelector('script[data-weather-dashboard-config], script#weather-dashboard-config')
      : null;
    if (!script) {
      return { config: {}, error: null };
    }
    const text = script.textContent || '';
    if (!text.trim()) {
      return { config: {}, error: 'Inline configuration script is empty.' };
    }
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object') {
        return { config: parsed, error: null };
      }
      return { config: {}, error: 'Inline configuration must be a JSON object.' };
    } catch (err) {
      return { config: {}, error: `Inline configuration JSON invalid: ${err.message}` };
    }
  }

  function pickValue(source, keys) {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        const value = source[key];
        if (Array.isArray(value)) {
          if (value.length === 0) continue;
          const last = value[value.length - 1];
          if (last != null && String(last).trim() !== '') {
            return last;
          }
        } else if (value != null && String(value).trim() !== '') {
          return value;
        }
      }
    }
    return undefined;
  }

  function normalizeHubBase(value) {
    if (Array.isArray(value)) {
      return normalizeHubBase(value[value.length - 1]);
    }
    if (value == null) return '';
    let text = String(value).trim();
    if (!text) return '';
    if (!/^https?:\/\//i.test(text)) {
      text = `http://${text}`;
    }
    try {
      const url = new URL(text);
      url.search = '';
      url.hash = '';
      if (!url.pathname.endsWith('/')) {
        url.pathname = `${url.pathname}/`;
      }
      return url.toString();
    } catch (err) {
      return '';
    }
  }

  function normalizeToken(value) {
    if (Array.isArray(value)) {
      return normalizeToken(value[value.length - 1]);
    }
    if (value == null) return '';
    return String(value).trim();
  }

  function normalizeId(value) {
    if (Array.isArray(value)) {
      return normalizeId(value[value.length - 1]);
    }
    if (value == null) return '';
    return String(value).trim();
  }

  function normalizeDeviceList(value) {
    const values = [];
    const pushValue = entry => {
      if (entry == null) return;
      const text = String(entry).trim();
      if (!text) return;
      text.split(/[,\s]+/).forEach(part => {
        const trimmed = part.trim();
        if (trimmed) values.push(trimmed);
      });
    };

    if (Array.isArray(value)) {
      value.forEach(pushValue);
    } else if (value != null) {
      pushValue(value);
    }
    return values;
  }

  function normalizeDuration(value) {
    if (Array.isArray(value)) {
      return normalizeDuration(value[value.length - 1]);
    }
    if (value == null) return NaN;
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return NaN;
      const match = trimmed.match(/^(-?\d+(?:\.\d+)?)(ms|s|sec|secs|second|seconds|m|min|mins|minute|minutes)?$/i);
      if (!match) return NaN;
      const numeric = Number(match[1]);
      if (!Number.isFinite(numeric)) return NaN;
      const unit = (match[2] || '').toLowerCase();
      if (!unit || unit === 'ms') return numeric;
      if (unit === 's' || unit === 'sec' || unit === 'secs' || unit === 'second' || unit === 'seconds') {
        return numeric * 1000;
      }
      if (unit === 'm' || unit === 'min' || unit === 'mins' || unit === 'minute' || unit === 'minutes') {
        return numeric * 60000;
      }
      return NaN;
    }
    return NaN;
  }

  function normalizeConfig(rawSource) {
    const source = rawSource || {};
    const config = {};

    config.hubBaseUrl = normalizeHubBase(pickValue(source, ['hubBaseUrl', 'hubUrl', 'hub', 'hubIp']));
    config.appId = normalizeId(pickValue(source, ['appId', 'applicationId', 'app', 'dashboardAppId']));
    config.dashboardToken = normalizeToken(
      pickValue(source, ['appToken', 'previewToken', 'dashboardToken', 'access_token', 'appAccessToken', 'dashboardAccessToken'])
    );
    config.makerToken = normalizeToken(pickValue(source, ['makerToken', 'makerApiToken', 'maker_token', 'token', 'maker']));
    config.deviceIds = normalizeDeviceList(pickValue(source, ['deviceIds', 'devices', 'deviceId', 'device']));
    config.pollIntervalMs = normalizeDuration(pickValue(source, ['pollIntervalMs', 'pollInterval', 'interval', 'refresh', 'refreshInterval']));
    config.maxBackoffMs = normalizeDuration(pickValue(source, ['maxBackoffMs', 'maxBackoff', 'backoff', 'backoffMs']));

    if (!config.dashboardToken && config.makerToken) {
      config.dashboardToken = config.makerToken;
    }
    if (!config.makerToken && config.dashboardToken) {
      config.makerToken = config.dashboardToken;
    }

    return config;
  }

  function sanitizeIntervals(config, warnings) {
    let poll = Number(config.pollIntervalMs);
    if (!Number.isFinite(poll)) {
      poll = DEFAULT_POLL_INTERVAL_MS;
    }
    if (poll < MIN_POLL_INTERVAL_MS) {
      warnings.push(`Poll interval ${poll}ms is shorter than supported minimum (${MIN_POLL_INTERVAL_MS}ms). Using ${MIN_POLL_INTERVAL_MS}ms.`);
      poll = MIN_POLL_INTERVAL_MS;
    }
    poll = Math.round(poll);

    let backoff = Number(config.maxBackoffMs);
    if (!Number.isFinite(backoff)) {
      backoff = Math.max(DEFAULT_MAX_BACKOFF_MS, poll * 2);
    }
    if (backoff < poll) {
      warnings.push('Maximum backoff was lower than the poll interval. Using double the poll interval.');
      backoff = Math.max(poll * 2, MIN_POLL_INTERVAL_MS * 2);
    }
    backoff = Math.round(backoff);

    config.pollIntervalMs = poll;
    config.maxBackoffMs = backoff;
  }

  function validateConfig(config) {
    const errors = [];
    const warnings = [];

    if (!config.hubBaseUrl) {
      errors.push('Hub address missing. Provide it via ?hub=HUB_IP or set hubBaseUrl in the inline JSON configuration.');
    } else if (!isHttpUrl(config.hubBaseUrl)) {
      errors.push('Hub address must use http:// or https://.');
    }

    if (!config.appId) {
      errors.push('App ID missing. Append ?appId=### or set appId in the configuration JSON.');
    } else if (!/^[0-9]+$/.test(config.appId)) {
      warnings.push('App ID contains non-numeric characters. Confirm the Maker API app identifier is correct.');
    }

    if (!config.dashboardToken) {
      errors.push('Dashboard access token missing. Supply ?appToken= (alias ?access_token=).');
    }

    if (!config.makerToken) {
      errors.push('Maker API token missing. Supply ?makerToken=YOUR_TOKEN.');
    }

    if (!Array.isArray(config.deviceIds) || config.deviceIds.length === 0) {
      warnings.push('No Maker API device IDs provided. Provide ?devices=ID1,ID2 to enable future device-scoped features.');
    } else {
      const invalid = config.deviceIds.filter(id => !/^\d+$/.test(id));
      if (invalid.length) {
        errors.push(`Invalid device ID(s): ${invalid.join(', ')}.`);
      }
    }

    return { errors, warnings };
  }

  function isHttpUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (err) {
      return false;
    }
  }

  function buildEndpointUrl(config) {
    if (!config || !config.hubBaseUrl || !config.appId || !config.dashboardToken) {
      return null;
    }
    try {
      const base = new URL(config.hubBaseUrl);
      const target = new URL(`/apps/api/${encodeURIComponent(config.appId)}/dashboard`, base);
      target.searchParams.set('access_token', config.dashboardToken);
      if (config.dashboardToken) {
        target.searchParams.set('appToken', config.dashboardToken);
        target.searchParams.set('previewToken', config.dashboardToken);
      }
      if (config.makerToken) {
        target.searchParams.set('makerToken', config.makerToken);
        target.searchParams.set('makerApiToken', config.makerToken);
      }
      if (Array.isArray(config.deviceIds) && config.deviceIds.length) {
        target.searchParams.set('deviceIds', config.deviceIds.join(','));
      }
      return target.toString();
    } catch (err) {
      return null;
    }
  }

  function evaluateConfiguration() {
    const queryConfig = readQueryConfig();
    const inlineResult = readInlineConfig(global.document);
    const merged = Object.assign({}, inlineResult.config || {}, queryConfig || {});

    const normalized = normalizeConfig(merged);
    const intervalWarnings = [];
    sanitizeIntervals(normalized, intervalWarnings);

    const validation = validateConfig(normalized);
    const errors = validation.errors.slice();
    const warnings = validation.warnings.concat(intervalWarnings);

    if (inlineResult.error) {
      errors.push(inlineResult.error);
    }

    const endpoint = buildEndpointUrl(normalized);
    if (!endpoint && !errors.length) {
      errors.push('Unable to construct Maker API endpoint URL from the provided configuration.');
    }

    state.config = normalized;
    state.configErrors = errors;
    state.validationWarnings = warnings;
    state.inlineConfigError = inlineResult.error;
    state.pollIntervalMs = normalized.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS;
    state.maxBackoffMs = normalized.maxBackoffMs || DEFAULT_MAX_BACKOFF_MS;
    state.endpointUrl = endpoint;

    return { normalized, errors, warnings, endpoint };
  }

  function buildConfigSummary(config) {
    if (!config) return '';
    const parts = [];
    if (config.hubBaseUrl) {
      parts.push(`Hub: ${config.hubBaseUrl.replace(/\/?$/, '')}`);
    }
    if (config.appId) {
      parts.push(`App ID: ${config.appId}`);
    }
    if (Array.isArray(config.deviceIds) && config.deviceIds.length) {
      parts.push(`Devices: ${config.deviceIds.join(', ')}`);
    } else {
      parts.push('Devices: none provided');
    }
    parts.push(`Refresh: ${formatDuration(state.pollIntervalMs)} (max backoff ${formatDuration(state.maxBackoffMs)})`);
    return parts.join(' • ');
  }

  function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '';
    if (ms < 1000) return `${ms}ms`;
    if (ms % 1000 === 0) {
      const seconds = ms / 1000;
      if (seconds % 60 === 0) {
        return `${seconds / 60}m`;
      }
      return `${seconds}s`;
    }
    if (ms < 60000) {
      return `${(ms / 1000).toFixed(1)}s`;
    }
    const minutes = ms / 60000;
    if (minutes < 10) {
      return `${minutes.toFixed(1)}m`;
    }
    return `${Math.round(minutes)}m`;
  }

  function formatTimestamp(epochMs) {
    if (!Number.isFinite(epochMs)) return '';
    const date = new Date(epochMs);
    if (Number.isNaN(date.getTime())) return '';
    try {
      return date.toLocaleString();
    } catch (err) {
      return date.toISOString();
    }
  }

  function resolveRendererFactory() {
    if (typeof global.createLegacyWeatherDashboardRenderer === 'function') {
      return global.createLegacyWeatherDashboardRenderer;
    }
    if (global.weatherDashboard && typeof global.weatherDashboard.__rendererFactory === 'function') {
      return global.weatherDashboard.__rendererFactory;
    }
    if (typeof require === 'function') {
      try {
        const mod = require('../src/render/index.js');
        if (mod && typeof mod.createLegacyWeatherDashboardRenderer === 'function') {
          return mod.createLegacyWeatherDashboardRenderer;
        }
      } catch (err) {
        // ignore require failures in browser builds
      }
    }
    return null;
  }

  function bootstrapRenderer() {
    if (state.renderer) return state.renderer;
    const factory = resolveRendererFactory();
    if (typeof factory !== 'function') {
      updateStatus('error', 'Renderer unavailable', [
        'Load dashboard/weather-dashboard.js before weather-dashboard-app.js so the renderer factory is registered.'
      ]);
      return null;
    }
    try {
      const renderer = factory({ window: global, document: global.document, globalThis: global });
      state.renderer = renderer || (global.weatherDashboard && global.weatherDashboard.__renderer__) || null;
      return state.renderer;
    } catch (err) {
      updateStatus('error', 'Failed to initialize renderer', [err.message || String(err)]);
      return null;
    }
  }

  function stopPolling() {
    if (state.pollTimer && typeof global.clearTimeout === 'function') {
      global.clearTimeout(state.pollTimer);
    }
    state.pollTimer = null;
    state.nextDelay = null;
  }

  function scheduleNext(delayMs) {
    stopPolling();
    if (typeof global.setTimeout !== 'function') {
      return;
    }
    const delay = Math.max(0, Math.round(Number.isFinite(delayMs) ? delayMs : state.pollIntervalMs));
    state.nextDelay = delay;
    state.pollTimer = global.setTimeout(() => {
      state.pollTimer = null;
      runFetchCycle();
    }, delay);
  }

  function computeBackoffDelay(failureCount) {
    const base = Math.max(MIN_POLL_INTERVAL_MS, state.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS);
    const exponent = Math.max(0, failureCount);
    const proposed = base * Math.pow(2, exponent);
    return Math.min(Math.max(base, Math.round(proposed)), Math.max(base, state.maxBackoffMs || DEFAULT_MAX_BACKOFF_MS));
  }

  function applyPayloadText(text) {
    if (!dataTileContent) ensureAppShell();
    if (!dataTileContent) return;
    dataTileContent.textContent = text != null ? String(text) : '';
    const renderer = bootstrapRenderer();
    const api = renderer || (global.weatherDashboard && global.weatherDashboard.__renderer__);
    if (api && typeof api.safeRenderFromData === 'function') {
      api.safeRenderFromData();
    }
  }

  function buildLoadingDetails(config) {
    const details = [];
    const summary = buildConfigSummary(config);
    if (summary) details.push(summary);
    if (state.endpointUrl) {
      details.push(`GET ${state.endpointUrl}`);
    }
    if (state.validationWarnings.length) {
      details.push(...state.validationWarnings.map(item => `⚠ ${item}`));
    }
    return details;
  }

  function handleSuccess(text) {
    state.failureStreak = 0;
    state.lastSuccessAt = Date.now();
    const parsed = parseJson(text);
    applyPayloadText(text);

    const details = [];
    const timestamp = formatTimestamp(state.lastSuccessAt);
    if (timestamp) {
      details.push(`Updated ${timestamp}`);
    }
    const summary = buildConfigSummary(state.config);
    if (summary) details.push(summary);
    details.push(`Next refresh in ${formatDuration(state.pollIntervalMs)}.`);
    if (parsed && parsed.metadata && parsed.metadata.generatedAt) {
      details.push(`Payload generated at ${parsed.metadata.generatedAt}.`);
    }
    if (state.validationWarnings.length) {
      details.push(...state.validationWarnings.map(item => `⚠ ${item}`));
    }

    updateStatus('success', 'Weather data updated', details);
    scheduleNext(state.pollIntervalMs);
  }

  function handleFailure(error) {
    state.failureStreak += 1;
    const message = error && error.message ? error.message : 'Unknown error occurred while requesting the Maker API endpoint.';
    const delay = computeBackoffDelay(state.failureStreak);
    const details = [message, `Retrying in ${formatDuration(delay)}.`];
    if (state.validationWarnings.length) {
      details.push(...state.validationWarnings.map(item => `⚠ ${item}`));
    }
    updateStatus('error', 'Unable to refresh weather data', details);
    scheduleNext(delay);
  }

  function parseJson(text) {
    if (!text || typeof text !== 'string') return null;
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new Error(`Hub returned invalid JSON: ${err.message}`);
    }
  }

  function performFetch(url) {
    if (typeof global.fetch !== 'function') {
      return Promise.reject(new Error('Fetch API is unavailable in this browser.'));
    }
    return global.fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      cache: 'no-store'
    }).then(response => {
      if (!response) {
        throw new Error('Maker API response was empty.');
      }
      return response.text().then(text => {
        if (!response.ok) {
          const prefix = `HTTP ${response.status}`;
          let suffix = response.statusText ? ` ${response.statusText}` : '';
          if (text) {
            try {
              const body = JSON.parse(text);
              if (body && body.message) {
                suffix += ` — ${body.message}`;
              }
            } catch (err) {
              suffix += ` — ${text}`;
            }
          }
          throw new Error(`${prefix}${suffix}`.trim());
        }
        return text;
      });
    });
  }

  function runFetchCycle() {
    if (state.fetchInFlight) {
      return;
    }
    if (!state.endpointUrl) {
      updateStatus('error', 'Weather dashboard not configured', state.configErrors);
      return;
    }
    state.fetchInFlight = true;
    updateStatus('loading', 'Refreshing weather data…', buildLoadingDetails(state.config));
    performFetch(state.endpointUrl)
      .then(handleSuccess)
      .catch(handleFailure)
      .finally(() => {
        state.fetchInFlight = false;
      });
  }

  function refreshNow() {
    stopPolling();
    runFetchCycle();
  }

  function configureAndStart() {
    const { normalized, errors, warnings } = evaluateConfiguration();
    if (errors.length > 0) {
      stopPolling();
      const details = errors.concat(warnings);
      updateStatus('error', 'Weather dashboard not configured', details);
      return;
    }

    updateStatus('info', 'Connecting to Maker API…', buildLoadingDetails(normalized));
    state.failureStreak = 0;
    scheduleNext(0);
  }

  function initialize() {
    injectStyles();
    ensureAppShell();
    bootstrapRenderer();
    configureAndStart();
  }

  whenDomReady(initialize);
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
