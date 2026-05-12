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
  const DEFAULT_RENDER_BASE_WIDTH = 1200;
  const DEFAULT_RENDER_BASE_HEIGHT = 900;
  const HTML_APP_INNER_OFFSET = 20;
  const HTML_APP_MAX_SCALE = 2;
  const HOST_RESIZE_BUFFER_PX = 2;

  const state = {
    renderer: null,
    config: null,
    configErrors: [],
    validationWarnings: [],
    inlineConfigError: null,
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
    maxBackoffMs: DEFAULT_MAX_BACKOFF_MS,
    nextDelay: DEFAULT_POLL_INTERVAL_MS,
    statusBarVisible: true,
    statusBarLocked: false,
    pollTimer: null,
    fetchInFlight: false,
    failureStreak: 0,
    lastSuccessAt: null,
    endpointUrl: null,
    redactedEndpointUrl: null,
    status: { level: 'info', message: 'Initializing…', details: [] },
    statusMinHeight: 0
  };

  let shellElements = null;
  let dataTileContent = null;
  let pendingHostResizeSync = false;
  let lastReportedHostHeight = 0;
  const previewResizeState = {
    pending: false,
    rootObserver: null,
    observedRoot: null,
    displayObserver: null,
    observedDisplayTile: null,
    lastWidth: null,
    lastHeight: null
  };

  const publicApi = {
    get state() {
      return publicStateSnapshot();
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

  function publicStateSnapshot() {
    const snapshot = {
      ...state,
      endpointUrl: state.redactedEndpointUrl
    };
    if (Array.isArray(snapshot.configErrors)) {
      snapshot.configErrors = snapshot.configErrors.slice();
    }
    if (Array.isArray(snapshot.validationWarnings)) {
      snapshot.validationWarnings = snapshot.validationWarnings.slice();
    }
    if (snapshot.status && typeof snapshot.status === 'object') {
      snapshot.status = { ...snapshot.status };
      if (Array.isArray(snapshot.status.details)) {
        snapshot.status.details = snapshot.status.details.slice();
      }
    }
    if (snapshot.config && typeof snapshot.config === 'object') {
      snapshot.config = { ...snapshot.config };
      if (Array.isArray(snapshot.config.deviceIds)) {
        snapshot.config.deviceIds = snapshot.config.deviceIds.slice();
      }
      if (snapshot.config.makerToken) {
        snapshot.config.makerToken = 'REDACTED';
      }
    }
    return snapshot;
  }

  function whenDomReady(callback) {
    if (!global.document) return;
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', callback, { once: true });
    } else {
      callback();
    }
  }

  function measureDocumentHeight() {
    const doc = global.document;
    if (!doc) return 0;
    const body = doc.body;
    const html = doc.documentElement;
    const values = [
      body ? body.scrollHeight : 0,
      body ? body.offsetHeight : 0,
      body ? body.clientHeight : 0,
      html ? html.scrollHeight : 0,
      html ? html.offsetHeight : 0,
      html ? html.clientHeight : 0,
      typeof global.innerHeight === 'number' ? global.innerHeight : 0
    ].filter(value => typeof value === 'number' && value > 0);
    if (!values.length) return 0;
    return Math.ceil(Math.max(...values));
  }

  function postPreviewHeight(height) {
    if (!global || !global.parent || global.parent === global) return;
    if (!height || !Number.isFinite(height)) return;
    const size = Math.max(0, Math.ceil(height) + HOST_RESIZE_BUFFER_PX);
    try {
      global.parent.postMessage({ type: 'weather-dashboard-app:resize', height: size }, '*');
    } catch (err) {
      /* ignore cross-origin errors */
    }
  }

  function flushHostResizeSync() {
    pendingHostResizeSync = false;
    const height = measureDocumentHeight();
    if (!height || height === lastReportedHostHeight) {
      return;
    }
    lastReportedHostHeight = height;
    postPreviewHeight(height);
  }

  function scheduleHostResizeSync() {
    if (!global || !global.parent || global.parent === global) return;
    if (pendingHostResizeSync) return;
    pendingHostResizeSync = true;
    const trigger = () => {
      if (typeof global.requestAnimationFrame === 'function') {
        global.requestAnimationFrame(flushHostResizeSync);
      } else {
        global.setTimeout(flushHostResizeSync, 32);
      }
    };
    if (typeof global.requestAnimationFrame === 'function') {
      global.requestAnimationFrame(trigger);
    } else {
      global.setTimeout(trigger, 32);
    }
  }

  function parseCssPixels(value) {
    if (value == null) return null;
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }
    const text = String(value || '').trim();
    if (!text) return null;
    const pxMatch = text.match(/^(-?[0-9]+(?:\.[0-9]+)?)px$/i);
    if (pxMatch) {
      const parsed = Number(pxMatch[1]);
      return Number.isFinite(parsed) ? parsed : null;
    }
    const numeric = Number(text);
    return Number.isFinite(numeric) ? numeric : null;
  }

  function readRenderDimensions(root) {
    if (!root) return null;
    let width = null;
    let height = null;

    if (typeof global.getComputedStyle === 'function') {
      try {
        const computed = global.getComputedStyle(root);
        width = parseCssPixels(computed.getPropertyValue('--wdash-render-width'))
          ?? parseCssPixels(computed.getPropertyValue('--wdash-base-width'));
        height = parseCssPixels(computed.getPropertyValue('--wdash-render-height'))
          ?? parseCssPixels(computed.getPropertyValue('--wdash-base-height'));
      } catch (err) {
        /* ignore */
      }
    }

    if ((!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) &&
        typeof root.getBoundingClientRect === 'function') {
      const rect = root.getBoundingClientRect();
      if (!Number.isFinite(width) || width <= 0) {
        const rectWidth = Number(rect?.width);
        if (Number.isFinite(rectWidth) && rectWidth > 0) {
          width = rectWidth;
        }
      }
      if (!Number.isFinite(height) || height <= 0) {
        const rectHeight = Number(rect?.height);
        if (Number.isFinite(rectHeight) && rectHeight > 0) {
          height = rectHeight;
        }
      }
    }

    if ((!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) &&
        typeof root.querySelector === 'function') {
      const dash = root.querySelector('.wdash');
      if (dash && typeof dash.getBoundingClientRect === 'function') {
        const dashRect = dash.getBoundingClientRect();
        if (!Number.isFinite(width) || width <= 0) {
          const dashWidth = Number(dashRect?.width);
          if (Number.isFinite(dashWidth) && dashWidth > 0) {
            width = dashWidth;
          }
        }
        if (!Number.isFinite(height) || height <= 0) {
          const dashHeight = Number(dashRect?.height);
          if (Number.isFinite(dashHeight) && dashHeight > 0) {
            height = dashHeight;
          }
        }
      }
    }

    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
      return null;
    }

    return { width, height };
  }

  function clearPreviewDimensions() {
    if (!shellElements) return;
    const { host, status, displayTile, displayPrimary } = shellElements;
    if (host) {
      host.style.removeProperty('--wdash-preview-width');
      host.style.removeProperty('--wdash-preview-height');
    }
    if (displayTile) {
      displayTile.style.removeProperty('maxWidth');
      displayTile.style.removeProperty('minWidth');
      displayTile.style.removeProperty('width');
      displayTile.style.removeProperty('height');
      displayTile.style.removeProperty('minHeight');
      displayTile.style.removeProperty('flex-basis');
    }
    if (displayPrimary) {
      displayPrimary.style.removeProperty('maxWidth');
      displayPrimary.style.removeProperty('width');
      displayPrimary.style.removeProperty('height');
      displayPrimary.style.removeProperty('minHeight');
      displayPrimary.style.removeProperty('flex-basis');
    }
    if (status) {
      status.style.removeProperty('maxWidth');
    }
  }

  function syncPreviewContainerBounds(shell) {
    if (!shell) return null;
    const { host, status, displayTile, displayPrimary } = shell;
    if (!host || !displayTile) return null;

    const viewportDimensions = standaloneViewportDimensions();
    const width = Math.max(1, Math.round(viewportDimensions.width));
    const height = Math.max(1, Math.round(viewportDimensions.height));
    const widthPx = `${width}px`;
    const heightPx = `${height}px`;

    displayTile.style.width = widthPx;
    displayTile.style.maxWidth = 'none';
    displayTile.style.minWidth = '0';
    displayTile.style.height = heightPx;
    displayTile.style.minHeight = heightPx;
    displayTile.style.setProperty('flex-basis', heightPx);

    if (displayPrimary) {
      displayPrimary.style.width = widthPx;
      displayPrimary.style.maxWidth = 'none';
      displayPrimary.style.height = heightPx;
      displayPrimary.style.minHeight = heightPx;
      displayPrimary.style.setProperty('flex-basis', heightPx);
    }
    if (status) {
      status.style.maxWidth = widthPx;
    }

    return { width, height, scale: 1 };
  }

  function requestPreviewSizeSync() {
    if (previewResizeState.pending) return;
    previewResizeState.pending = true;
    const run = () => {
      previewResizeState.pending = false;
      syncPreviewDimensions();
    };
    if (typeof global.requestAnimationFrame === 'function') {
      global.requestAnimationFrame(() => {
        if (typeof global.requestAnimationFrame === 'function') {
          global.requestAnimationFrame(run);
        } else if (typeof global.setTimeout === 'function') {
          global.setTimeout(run, 16);
        } else {
          run();
        }
      });
    } else if (typeof global.setTimeout === 'function') {
      global.setTimeout(run, 32);
    } else {
      run();
    }
  }

  function ensurePreviewResizeObservers(root, displayTile) {
    if (typeof global.ResizeObserver !== 'function') return;

    if (!previewResizeState.rootObserver) {
      previewResizeState.rootObserver = new global.ResizeObserver(() => {
        requestPreviewSizeSync();
      });
    }
    if (previewResizeState.observedRoot !== root) {
      if (previewResizeState.observedRoot) {
        try {
          previewResizeState.rootObserver.unobserve(previewResizeState.observedRoot);
        } catch (err) {
          /* ignore */
        }
      }
      previewResizeState.observedRoot = root || null;
      if (root) {
        try {
          previewResizeState.rootObserver.observe(root);
        } catch (err) {
          /* ignore */
        }
      }
    }

    if (!previewResizeState.displayObserver) {
      previewResizeState.displayObserver = new global.ResizeObserver(() => {
        requestPreviewSizeSync();
      });
    }
    if (previewResizeState.observedDisplayTile !== displayTile) {
      if (previewResizeState.observedDisplayTile) {
        try {
          previewResizeState.displayObserver.unobserve(previewResizeState.observedDisplayTile);
        } catch (err) {
          /* ignore */
        }
      }
      previewResizeState.observedDisplayTile = displayTile || null;
      if (displayTile) {
        try {
          previewResizeState.displayObserver.observe(displayTile);
        } catch (err) {
          /* ignore */
        }
      }
    }
  }

  function syncPreviewDimensions() {
    const shell = shellElements || ensureAppShell();
    if (!shell) return;

    const { host, status, displayTile, displayPrimary } = shell;
    const root = displayPrimary ? displayPrimary.querySelector('.wdash-root') : null;
    const fittedBox = syncPreviewContainerBounds(shell);

    ensurePreviewResizeObservers(root, displayTile);

    if (!root) {
      if (previewResizeState.lastWidth != null || previewResizeState.lastHeight != null) {
        previewResizeState.lastWidth = null;
        previewResizeState.lastHeight = null;
        clearPreviewDimensions();
        scheduleHostResizeSync();
      }
      return;
    }

    const dimensions = readRenderDimensions(root);
    if (!dimensions) return;

    const width = fittedBox ? fittedBox.width : Math.max(1, Math.round(dimensions.width));
    const height = fittedBox ? fittedBox.height : Math.max(1, Math.round(dimensions.height));

    if (previewResizeState.lastWidth === width && previewResizeState.lastHeight === height) {
      return;
    }

    previewResizeState.lastWidth = width;
    previewResizeState.lastHeight = height;

    const widthPx = `${width}px`;
    const heightPx = `${height}px`;

    syncPreviewContainerBounds(shell);
    if (status) {
      status.style.maxWidth = widthPx;
    }

    scheduleHostResizeSync();
  }

  function injectStyles() {
    const doc = global.document;
    if (!doc || doc.getElementById(STYLE_ID)) return;
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      html, body {
        height: 100%;
      }
      body {
        margin: 0;
        min-height: 100%;
        display: flex;
        justify-content: center;
        align-items: stretch;
        padding: 0;
        box-sizing: border-box;
        overflow: auto;
      }
      #${HOST_ID} {
        --wdash-app-font: 'Segoe UI', Roboto, -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
        width: 100%;
        display: flex;
        flex-direction: column;
        align-items: stretch;
        justify-content: flex-start;
        gap: 20px;
        padding: ${HTML_APP_INNER_OFFSET}px;
        margin: 0 auto;
        box-sizing: border-box;
        min-height: 100%;
        --wdash-grid-areas-desktop: 'temp-wind ambient' 'air rain' 'solar rain' 'solar pressure';
        --wdash-grid-areas-tablet: 'temp-wind ambient' 'air rain' 'solar rain' 'solar pressure';
        --wdash-grid-areas-mobile: 'temp-wind' 'ambient' 'air' 'rain' 'solar' 'pressure';
        --wdash-grid-columns-desktop: repeat(2, minmax(0, 1fr));
        --wdash-grid-columns-tablet: repeat(2, minmax(0, 1fr));
        --wdash-grid-columns-mobile: minmax(0, 1fr);
        --wdash-grid-gap-desktop: 14px;
        --wdash-grid-gap-tablet: 14px;
        background: radial-gradient(circle at top, rgba(20,40,80,0.55), rgba(4,10,22,0.92));
        font-family: var(--wdash-app-font);
      }
      #${HOST_ID}[data-status-bar-visible="false"][data-status-bar-locked="true"] {
        gap: 0;
      }
      #${HOST_ID} .wdash-app-status {
        width: 100%;
        margin: 0 auto;
        flex: 0 0 auto;
      }
      #${HOST_ID} .wdash-app-display-tile {
        width: 100%;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        flex: 0 0 auto;
        aspect-ratio: 4 / 3;
        min-height: 1px;
      }
      #${HOST_ID} .tile {
        position: relative;
        width: 100%;
        margin: 0 auto;
        background: transparent;
        box-shadow: none;
        border: 0;
        overflow: visible;
        display: flex;
        flex-direction: column;
        flex: 0 0 auto;
        min-height: 1px;
      }
      #${HOST_ID} .tile-primary {
        position: relative;
        padding: 0;
        background: transparent;
        overflow: visible;
        display: flex;
        flex-direction: column;
        flex: 0 0 auto;
        min-height: 1px;
      }
      #${HOST_ID} .wdash-app-display-tile {
        width: 100%;
        margin: 0 auto;
      }
      #${HOST_ID} .wdash-app-display {
        position: relative;
        width: 100%;
        margin: 0 auto;
        display: flex;
        align-items: stretch;
        justify-content: center;
        flex: 0 0 auto;
        aspect-ratio: 4 / 3;
        min-height: 1px;
      }
      #${HOST_ID} .wdash-app-display > * {
        position: relative;
        width: 100%;
        height: 100%;
        min-height: 0;
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
        width: 100%;
        box-sizing: border-box;
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
      #${STATUS_ID} .wdash-app-status__bar {
        margin-top: 10px;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        border-radius: 10px;
        background: rgba(9, 18, 36, 0.32);
        border: 1px solid rgba(139, 164, 230, 0.18);
        font-size: 0.84rem;
        line-height: 1.35;
      }
      #${STATUS_ID} .wdash-app-status__bar-item {
        white-space: nowrap;
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
      @media (max-width: 1100px) {
        #${HOST_ID} .wdash-grid { grid-template-areas: var(--wdash-grid-areas-tablet); grid-template-columns: var(--wdash-grid-columns-tablet); gap: var(--wdash-grid-gap-tablet); }
        #${HOST_ID} .wdash { --wdash-frame-gap: var(--wdash-frame-gap-tablet); }
      }
      @media (max-width: 720px) {
        #${HOST_ID} .wdash-grid { grid-template-areas: var(--wdash-grid-areas-mobile); grid-template-columns: var(--wdash-grid-columns-mobile); gap: var(--wdash-grid-gap-mobile); }
        #${HOST_ID} .wdash { --wdash-frame-gap: var(--wdash-frame-gap-mobile); }
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
        onCreate: el => {
          el.dataset.level = 'info';
          el.classList.add('wdash-app-status');
        },
        onEnsure: el => {
          if (!el.dataset.level) {
            el.dataset.level = 'info';
          }
        }
      });

      const displayTile = ensureAndAppend(doc, host, DISPLAY_TILE_ID, {
        className: 'tile tile--weather-display wdash-app-display-tile',
        onEnsure: el => {
          el.classList.add('wdash-host-tile');
        }
      });

      let displayPrimary = displayTile.querySelector('.tile-primary');
      if (!displayPrimary) {
        displayPrimary = doc.createElement('div');
        displayPrimary.className = 'tile-primary wdash-app-display';
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
      requestPreviewSizeSync();
    }

    scheduleHostResizeSync();
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

  function isRefreshBarLine(value) {
    const text = normalizeText(value).toLowerCase();
    return text.startsWith('refresh:')
      || text.startsWith('next refresh')
      || text.startsWith('updated ')
      || text.startsWith('fetched ');
  }

  function splitStatusDetails(details) {
    const refreshDetails = [];
    const regularDetails = [];
    for (const entry of details) {
      if (isRefreshBarLine(entry)) {
        refreshDetails.push(entry);
      } else {
        regularDetails.push(entry);
      }
    }
    return { refreshDetails, regularDetails };
  }

  function updateStatus(level, message, details) {
    const shell = ensureAppShell();
    if (!shell) return;
    const status = shell.status;
    const normalizedDetails = Array.isArray(details)
      ? details.filter(item => item != null && item !== '')
      : (details ? [details] : []);
    state.status = { level, message, details: normalizedDetails.slice() };
    const { refreshDetails, regularDetails } = splitStatusDetails(normalizedDetails);
    const hideStatus = level === 'success' && !state.statusBarVisible;

    shell.host.dataset.statusBarVisible = state.statusBarVisible ? 'true' : 'false';
    shell.host.dataset.statusBarLocked = state.statusBarLocked ? 'true' : 'false';
    status.dataset.level = level || 'info';
    status.dataset.statusBarVisible = state.statusBarVisible ? 'true' : 'false';
    status.dataset.statusBarLocked = state.statusBarLocked ? 'true' : 'false';
    status.hidden = Boolean(hideStatus);
    if (hideStatus) {
      status.innerHTML = '';
      requestPreviewSizeSync();
      scheduleHostResizeSync();
      return;
    }
    let markup = `
      <div class="wdash-app-status__header">
        <div class="wdash-app-status__title">${escapeHtml(message || '')}</div>
      </div>
    `;
    if (state.statusBarVisible && refreshDetails.length > 0) {
      const refreshItems = refreshDetails
        .map(item => `<span class="wdash-app-status__bar-item">${escapeHtml(item)}</span>`)
        .join('');
      markup += `<div class="wdash-app-status__bar" role="status" aria-label="Refresh statistics">${refreshItems}</div>`;
    }
    if (regularDetails.length === 1) {
      markup += `<div class="wdash-app-status__details">${escapeHtml(regularDetails[0])}</div>`;
    } else if (regularDetails.length > 1) {
      const items = regularDetails
        .map(item => `<li>${escapeHtml(item)}</li>`)
        .join('');
      markup += `<div class="wdash-app-status__details"><ul>${items}</ul></div>`;
    }
    status.innerHTML = markup;

    const measured = Math.max(status.scrollHeight || 0, status.offsetHeight || 0);
    if (measured > 0) {
      const nextMin = Math.max(state.statusMinHeight || 0, measured);
      state.statusMinHeight = nextMin;
      status.style.minHeight = `${nextMin}px`;
    }

    requestPreviewSizeSync();
    scheduleHostResizeSync();
  }

  function parseQueryFallback(search) {
    const source = (search || '').replace(/^\?/, '');
    if (!source) {
      return [];
    }
    return source.split('&').reduce((entries, pair) => {
      if (!pair) return entries;
      const index = pair.indexOf('=');
      let key = pair;
      let value = '';
      if (index >= 0) {
        key = pair.slice(0, index);
        value = pair.slice(index + 1);
      }
      try {
        key = decodeURIComponent(key.replace(/\+/g, ' '));
      } catch (err) {
        key = key.replace(/\+/g, ' ');
      }
      try {
        value = decodeURIComponent(value.replace(/\+/g, ' '));
      } catch (err) {
        value = value.replace(/\+/g, ' ');
      }
      if (!key) {
        return entries;
      }
      entries.push([key, value]);
      return entries;
    }, []);
  }

  function createQueryParams(search) {
    const ctor = (global.URLSearchParams || (typeof URLSearchParams === 'function' ? URLSearchParams : null));
    if (ctor) {
      try {
        return new ctor(search);
      } catch (err) {
        // Fall through to manual parsing when the constructor throws.
      }
    }
    const entries = parseQueryFallback(search);
    return {
      entries() {
        return entries.slice();
      }
    };
  }

  function readQueryConfig() {
    const search = global.location ? global.location.search || '' : '';
    const params = createQueryParams(search);
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

    config.hubBaseUrl = normalizeHubBase(pickValue(source, ['hubBaseUrl']));
    config.appId = normalizeId(pickValue(source, ['appId']));
    config.makerToken = normalizeToken(pickValue(source, ['makerToken']));
    config.deviceIds = normalizeDeviceList(pickValue(source, ['deviceIds']));
    config.pollIntervalMs = normalizeDuration(pickValue(source, ['pollIntervalMs', 'pollInterval', 'interval', 'refresh', 'refreshInterval']));
    config.maxBackoffMs = normalizeDuration(pickValue(source, ['maxBackoffMs', 'maxBackoff', 'backoff', 'backoffMs']));
    config.renderWidth = coercePositiveDimension(pickValue(source, ['width']));
    config.renderHeight = coercePositiveDimension(pickValue(source, ['height']));

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
      errors.push('Hub address missing. Provide it via ?hubBaseUrl=HUB_URL or set hubBaseUrl in the inline JSON configuration.');
    } else if (!isHttpUrl(config.hubBaseUrl)) {
      errors.push('Hub address must use http:// or https://.');
    }

    if (!config.appId) {
      errors.push('App ID missing. Append ?appId=### or set appId in the configuration JSON.');
    } else if (!/^[0-9]+$/.test(config.appId)) {
      warnings.push('App ID contains non-numeric characters. Confirm the Maker API app identifier is correct.');
    }

    if (!config.makerToken) {
      errors.push('Maker API token missing. Supply ?makerToken=YOUR_TOKEN.');
    }

    if (!Array.isArray(config.deviceIds) || config.deviceIds.length === 0) {
      warnings.push('No Maker API device IDs provided. Provide ?deviceIds=ID1,ID2 to enable future device-scoped features.');
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
    if (!config || !config.hubBaseUrl || !config.appId) {
      return null;
    }
    try {
      const base = new URL(config.hubBaseUrl);
      const target = new URL(`/apps/api/${encodeURIComponent(config.appId)}/devices/all`, base);
      if (config.makerToken) {
        target.searchParams.set('access_token', config.makerToken);
      }
      if (Array.isArray(config.deviceIds) && config.deviceIds.length) {
        target.searchParams.set('deviceIds', config.deviceIds.join(','));
      }
      return target.toString();
    } catch (err) {
      return null;
    }
  }

  function redactUrlSecrets(value) {
    if (!value) return value;
    const text = String(value);
    const secretParams = new Set([
      'access_token',
      'makerToken',
      'dashboardToken'
    ]);
    try {
      const target = new URL(text);
      for (const key of secretParams) {
        if (target.searchParams.has(key)) {
          target.searchParams.set(key, 'REDACTED');
        }
      }
      return target.toString();
    } catch (err) {
      return text.replace(/([?&](?:access_token|makerToken|dashboardToken)=)[^&#]*/g, '$1REDACTED');
    }
  }

  function normalizePayloadResponse(response, originalText) {
    if (response == null) {
      return { payload: response, text: originalText };
    }

    const makerPayload = convertMakerApiResponse(response, state.config);
    if (makerPayload) {
      applyStandaloneLayoutMetadata(makerPayload);
      return { payload: makerPayload, text: JSON.stringify(makerPayload) };
    }

    applyStandaloneLayoutMetadata(response);
    return {
      payload: response,
      text: response && typeof response === 'object' ? JSON.stringify(response) : originalText
    };
  }

  function convertMakerApiResponse(response, config) {
    const devices = normalizeMakerApiDeviceList(response);
    if (!devices) return null;

    const device = selectDashboardDevice(devices, config);
    if (!device) {
      throw new Error('Maker API response did not include the Weather Dashboard Device. Confirm it is authorized in Maker API.');
    }

    const payload = buildPayloadFromDevice(device);
    if (!payload) {
      throw new Error('Weather Dashboard Device attributes were empty. Trigger a refresh in Hubitat and retry.');
    }

    return payload;
  }

  function normalizeMakerApiDeviceList(response) {
    if (!response) return null;

    if (Array.isArray(response)) {
      return response;
    }

    if (Array.isArray(response.devices)) {
      return response.devices;
    }

    if (response.device && typeof response.device === 'object') {
      return [response.device];
    }

    if (response.name && response.attributes) {
      return [response];
    }

    return null;
  }

  function selectDashboardDevice(devices, config) {
    if (!Array.isArray(devices) || devices.length === 0) {
      return null;
    }

    const normalizedIds = new Set(
      Array.isArray(config?.deviceIds)
        ? config.deviceIds.map(id => String(id))
        : []
    );

    if (normalizedIds.size > 0) {
      for (const device of devices) {
        const id = device && device.id != null ? String(device.id) : '';
        if (normalizedIds.has(id)) {
          return device;
        }
      }
    }

    const byLabel = devices.find(device => {
      const name = (device?.name || '').toLowerCase();
      const label = (device?.label || '').toLowerCase();
      const type = (device?.type || '').toLowerCase();
      return [name, label, type].some(text => text.includes('weather dashboard'));
    });
    if (byLabel) {
      return byLabel;
    }

    return devices.length === 1 ? devices[0] : null;
  }

  function coercePositiveDimension(value) {
    if (typeof value === 'number') {
      return Number.isFinite(value) && value > 0 ? value : null;
    }
    if (typeof value === 'string') {
      const match = value.trim().match(/^(-?\d+(?:\.\d+)?)/);
      if (match) {
        const parsed = Number(match[1]);
        if (Number.isFinite(parsed) && parsed > 0) {
          return parsed;
        }
      }
    }
    return null;
  }

  function isObjectRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
  }

  function ensureDefaultLayoutMetadata(payload) {
    if (!isObjectRecord(payload)) {
      return;
    }
    const meta = isObjectRecord(payload.metadata)
      ? payload.metadata
      : (payload.metadata = {});
    const layout = isObjectRecord(meta.layout)
      ? meta.layout
      : (meta.layout = {});

    if (coercePositiveDimension(layout.baseWidth) == null) {
      layout.baseWidth = DEFAULT_RENDER_BASE_WIDTH;
    }
    if (coercePositiveDimension(layout.baseHeight) == null) {
      layout.baseHeight = DEFAULT_RENDER_BASE_HEIGHT;
    }
  }

  function configuredRenderDimensions() {
    const width = state.config?.renderWidth;
    const height = state.config?.renderHeight;
    if (width == null || height == null) {
      return null;
    }
    return { width, height };
  }

  function browserViewportDimensions() {
    const doc = global.document;
    const docElement = doc?.documentElement || null;
    const width = (Number(global.innerWidth) || Number(docElement?.clientWidth) || 0) - (HTML_APP_INNER_OFFSET * 2);
    const height = (Number(global.innerHeight) || Number(docElement?.clientHeight) || 0) - (HTML_APP_INNER_OFFSET * 2);
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
      return null;
    }
    return { width, height };
  }

  function standaloneViewportDimensions() {
    return configuredRenderDimensions()
      || browserViewportDimensions()
      || { width: DEFAULT_RENDER_BASE_WIDTH, height: DEFAULT_RENDER_BASE_HEIGHT };
  }

  function deriveStandaloneBaseDimensions(dimensions) {
    const width = Number(dimensions?.width);
    const height = Number(dimensions?.height);
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
      return { width: DEFAULT_RENDER_BASE_WIDTH, height: DEFAULT_RENDER_BASE_HEIGHT };
    }
    const requestedRatio = width / height;
    const defaultRatio = DEFAULT_RENDER_BASE_WIDTH / DEFAULT_RENDER_BASE_HEIGHT;
    if (requestedRatio >= defaultRatio) {
      return {
        width: DEFAULT_RENDER_BASE_HEIGHT * requestedRatio,
        height: DEFAULT_RENDER_BASE_HEIGHT
      };
    }
    return {
      width: DEFAULT_RENDER_BASE_WIDTH,
      height: DEFAULT_RENDER_BASE_WIDTH / requestedRatio
    };
  }

  function applyStandaloneLayoutMetadata(payload) {
    if (!isObjectRecord(payload)) {
      return;
    }
    ensureDefaultLayoutMetadata(payload);
    const dimensions = deriveStandaloneBaseDimensions(standaloneViewportDimensions());
    const layout = payload.metadata.layout;
    layout.baseWidth = dimensions.width;
    layout.baseHeight = dimensions.height;
    ['desktop', 'tablet', 'mobile'].forEach(breakpoint => {
      if (!isObjectRecord(layout[breakpoint])) {
        layout[breakpoint] = {};
      }
      layout[breakpoint].baseWidth = dimensions.width;
      layout[breakpoint].baseHeight = dimensions.height;
    });
  }

  function buildPayloadFromDevice(device) {
    const attributes = toAttributeMap(device?.attributes);
    if (!attributes) return null;

    const payload = {};

    const core = parseJsonAttribute(attributes, 'segmentCore');
    if (core && typeof core === 'object') {
      Object.assign(payload, core);
    }

    const precip = parseJsonAttribute(attributes, 'segmentPrecip');
    if (precip && typeof precip === 'object') {
      Object.assign(payload, precip);
    }

    const air = parseJsonAttribute(attributes, 'segmentAirQuality');
    if (air && typeof air === 'object') {
      if (air.outdoorAirQuality && typeof air.outdoorAirQuality === 'object') {
        payload.outdoorAirQuality = air.outdoorAirQuality;
      }
      if (air.indoorAirQuality && typeof air.indoorAirQuality === 'object') {
        payload.indoorAirQuality = air.indoorAirQuality;
      }
    }

    const ambient = collectAmbientSegments(attributes);
    if (ambient) {
      if (ambient.sensors.length) payload.ambientSensors = ambient.sensors;
      if (ambient.rotation != null) payload.ambientRotationSeconds = ambient.rotation;
      if (ambient.humidityUnit != null) payload.ambientHumidityUnit = ambient.humidityUnit;
      if (ambient.total != null) payload.totalAmbientSensors = ambient.total;
    }

    const meta = parseJsonAttribute(attributes, 'segmentMeta');
    if (meta && typeof meta === 'object') {
      if (meta.outlook24h && typeof meta.outlook24h === 'object') {
        payload.outlook24h = meta.outlook24h;
      }
      if (meta.metadata && typeof meta.metadata === 'object') {
        payload.metadata = Object.assign({}, payload.metadata || {}, meta.metadata);
      }
    }

    const layoutSegment = parseJsonAttribute(attributes, 'segmentLayout');
    if (layoutSegment && typeof layoutSegment === 'object' && layoutSegment.layout) {
      payload.metadata = payload.metadata || {};
      payload.metadata.layout = layoutSegment.layout;
    }

    const updated = normalizeText(attributes.dashboardUpdated || attributes.lastUpdated);
    if (updated) {
      payload.metadata = payload.metadata || {};
      if (!payload.metadata.generatedAt) {
        payload.metadata.generatedAt = updated;
      }
      payload.metadata.dashboardUpdatedAt = updated;
    }

    ensureDefaultLayoutMetadata(payload);

    return Object.keys(payload).length ? payload : null;
  }

  function toAttributeMap(source) {
    if (!source) return null;
    if (Array.isArray(source)) {
      const map = {};
      source.forEach(entry => {
        if (!entry || typeof entry !== 'object') return;
        const key = entry.name || entry.attribute || entry.id;
        if (!key) return;
        map[key] = entry.value != null ? entry.value : entry.currentValue;
      });
      return map;
    }
    if (typeof source === 'object') {
      return source;
    }
    return null;
  }

  function parseJsonAttribute(attributes, key) {
    if (!attributes || !key) return null;
    const raw = attributes[key];
    if (raw == null) return null;
    const text = normalizeText(raw);
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new Error(`Maker API attribute ${key} contained invalid JSON (${err.message}).`);
    }
  }

  function collectAmbientSegments(attributes) {
    if (!attributes) return null;
    const segments = [];
    for (const key of Object.keys(attributes)) {
      const match = key.match(/^segmentAmbient(\d+)$/);
      if (!match) continue;
      const segment = parseJsonAttribute(attributes, key);
      if (segment && typeof segment === 'object') {
        segments.push({ index: Number(match[1]) || segment.segmentIndex || 0, data: segment });
      }
    }

    if (!segments.length) return null;
    segments.sort((a, b) => a.index - b.index);

    const sensors = [];
    let rotation = null;
    let humidityUnit = null;
    let total = null;

    segments.forEach(entry => {
      const segment = entry.data;
      if (!segment || typeof segment !== 'object') return;
      const list = Array.isArray(segment.ambientSensors) ? segment.ambientSensors : [];
      list.forEach(sensor => {
        if (sensor && typeof sensor === 'object') {
          sensors.push(sensor);
        }
      });
      if (rotation == null && segment.ambientRotationSeconds != null) {
        rotation = segment.ambientRotationSeconds;
      }
      if (humidityUnit == null && segment.ambientHumidityUnit != null) {
        humidityUnit = segment.ambientHumidityUnit;
      }
      const candidateTotal = Number(segment.totalAmbientSensors);
      if (Number.isFinite(candidateTotal)) {
        total = total == null ? candidateTotal : Math.max(total, candidateTotal);
      }
    });

    return {
      sensors,
      rotation,
      humidityUnit,
      total: total != null ? total : sensors.length
    };
  }

  function normalizeText(value) {
    if (value == null) return '';
    return String(value).trim();
  }

  function evaluateConfiguration() {
    const queryConfig = readQueryConfig();
    const inlineResult = readInlineConfig(global.document);
    const merged = Object.assign({}, inlineResult.config || {}, queryConfig || {});

    const normalized = normalizeConfig(merged);
    const queryStatusBar = normalizeText(queryConfig.statusBar).toLowerCase();
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
    state.redactedEndpointUrl = redactUrlSecrets(endpoint);
    state.statusBarVisible = queryStatusBar === 'no' || queryStatusBar === '0' ? false : true;
    state.statusBarLocked = queryStatusBar === 'yes' || queryStatusBar === '1' || queryStatusBar === 'no' || queryStatusBar === '0';

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
    return parts.join(' • ');
  }

  function buildRefreshSummary() {
    return `Refresh: ${formatDuration(state.pollIntervalMs)} (max backoff ${formatDuration(state.maxBackoffMs)})`;
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
    if (global.weatherDashboard && typeof global.weatherDashboard.__rendererFactory === 'function') {
      return global.weatherDashboard.__rendererFactory;
    }
    if (typeof global.createLegacyWeatherDashboardRenderer === 'function') {
      return global.createLegacyWeatherDashboardRenderer;
    }
    if (typeof require === 'function') {
      try {
        const mod = require('../src/render/index.js');
        if (mod && typeof mod.createRenderer === 'function') {
          return mod.createRenderer;
        }
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
      const renderer = factory({
        window: global,
        document: global.document,
        globalThis: global,
        maxScale: HTML_APP_MAX_SCALE
      });
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
    if (!dataTileContent) {
      scheduleHostResizeSync();
      return { rendered: false, reason: 'no-shell', details: ['Dashboard shell failed to initialize.'] };
    }
    dataTileContent.textContent = text != null ? String(text) : '';
    const renderer = bootstrapRenderer();
    const api = renderer || (global.weatherDashboard && global.weatherDashboard.__renderer__);
    if (api && typeof api.safeRenderFromData === 'function') {
      try {
        api.safeRenderFromData();
        requestPreviewSizeSync();
        scheduleHostResizeSync();
        return { rendered: true };
      } catch (err) {
        requestPreviewSizeSync();
        scheduleHostResizeSync();
        const message = err && err.message ? err.message : String(err);
        return { rendered: false, reason: 'render-error', details: [message] };
      }
    }

    requestPreviewSizeSync();
    scheduleHostResizeSync();
    if (!renderer) {
      return {
        rendered: false,
        reason: 'no-renderer',
        details: [
          'Load dashboard/weather-dashboard.js before weather-dashboard-app.js so the renderer factory is registered.'
        ]
      };
    }

    return {
      rendered: false,
      reason: 'missing-method',
      details: ['Registered renderer is missing a safeRenderFromData() method.']
    };
  }

  function buildLoadingDetails(config) {
    const details = [];
    const summary = buildConfigSummary(config);
    if (summary) details.push(summary);
    const refreshSummary = buildRefreshSummary();
    if (refreshSummary) details.push(refreshSummary);
    if (state.redactedEndpointUrl) {
      details.push(`GET ${state.redactedEndpointUrl}`);
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
    const normalized = normalizePayloadResponse(parsed, text);
    const renderResult = applyPayloadText(normalized.text);

    const timestamp = formatTimestamp(state.lastSuccessAt);
    const refreshDetail = `Next refresh in ${formatDuration(state.pollIntervalMs)}.`;
    const summary = buildConfigSummary(state.config);
    const payloadGenerated = normalized.payload && normalized.payload.metadata && normalized.payload.metadata.generatedAt
      ? `Payload generated at ${normalized.payload.metadata.generatedAt}.`
      : null;

    const details = [];
    const timestampDetail = timestamp
      ? (renderResult.rendered ? `Updated ${timestamp}` : `Fetched ${timestamp}.`)
      : null;

    if (!renderResult.rendered && Array.isArray(renderResult.details)) {
      details.push(...renderResult.details);
    }
    if (timestampDetail) {
      details.push(timestampDetail);
    }
    if (summary) {
      details.push(summary);
    }
    details.push(buildRefreshSummary());
    if (payloadGenerated) {
      details.push(payloadGenerated);
    }
    details.push(refreshDetail);
    if (state.validationWarnings.length) {
      details.push(...state.validationWarnings.map(item => `⚠ ${item}`));
    }

    if (renderResult.rendered) {
      updateStatus('success', 'Weather data updated', details);
    } else {
      const reason = renderResult.reason;
      if (reason === 'no-renderer' || reason === 'missing-method') {
        updateStatus('error', 'Renderer unavailable', details);
      } else if (reason === 'render-error') {
        updateStatus('error', 'Unable to render weather data', details);
      } else if (reason === 'no-shell') {
        updateStatus('error', 'Unable to render weather data', details.length ? details : ['Dashboard shell unavailable.']);
      } else {
        updateStatus('warning', 'Weather data fetched but not rendered', details);
      }
    }

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

  function shouldShowLoadingStatus() {
    if (!state.lastSuccessAt) return true;
    const level = state.status && state.status.level;
    return level === 'error' || level === 'warning';
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
    if (shouldShowLoadingStatus()) {
      updateStatus('loading', 'Refreshing weather data…', buildLoadingDetails(state.config));
    }
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
    requestPreviewSizeSync();
    bootstrapRenderer();
    configureAndStart();
  }

  if (typeof global.addEventListener === 'function') {
    global.addEventListener('resize', scheduleHostResizeSync);
    global.addEventListener('resize', requestPreviewSizeSync);
    global.addEventListener('load', scheduleHostResizeSync);
    global.addEventListener('load', requestPreviewSizeSync, { once: true });
  }

  whenDomReady(initialize);
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
