'use strict';

const { createHubitatTilesAdapter } = require('../adapters/hubitat-tiles');
const { KNOWN_PAYLOAD_KEYS, mergePayloadSegments } = require('./payload');
const {
  buildRendererData,
  extractLayoutFromPayload,
  resolveRendererDimensions
} = require('./renderer-host');

const BRIDGE_STATE_KEY = '__wdashHubitatBridgeState__';

function selectGlobalCandidate(provided) {
  if (provided) return provided;
  if (typeof window !== 'undefined') return window;
  if (typeof globalThis !== 'undefined') return globalThis;
  if (typeof global !== 'undefined') return global;
  return null;
}

function findDisplayTile(global) {
  const doc = global && global.document;
  if (!doc || typeof doc.getElementById !== 'function') {
    return null;
  }
  return doc.getElementById('tile-0');
}

function markDisplayTile(global) {
  const tile = findDisplayTile(global);
  if (!tile || !tile.classList || typeof tile.classList.add !== 'function') {
    return;
  }
  tile.classList.add('wdash-host-tile');
}

function findTileContentElement(tile) {
  if (!tile || typeof tile.querySelector !== 'function') {
    return null;
  }
  const selectors = [
    '.tile-primary',
    '.tile-contents',
    '.tile-content',
    '.tile'
  ];
  for (const selector of selectors) {
    try {
      const candidate = tile.querySelector(selector);
      if (candidate) {
        return candidate;
      }
    } catch (err) {
      /* ignore selector errors */
    }
  }
  return null;
}

function findDisplayTileHost(global, adapter) {
  const tile = findDisplayTile(global);
  if (!tile) return null;

  if (adapter && typeof adapter.getDisplayTileHostElement === 'function') {
    try {
      const adapterHost = adapter.getDisplayTileHostElement();
      if (adapterHost && adapterHost !== tile) {
        return adapterHost;
      }
      if (adapterHost && adapterHost === tile) {
        const nested = findTileContentElement(tile);
        if (nested) return nested;
      }
    } catch (err) {
      /* ignore adapter host failures */
    }
  }

  const fallback = findTileContentElement(tile);
  if (fallback) {
    return fallback;
  }

  return tile;
}

function measureHostSize(global, element, fallbacks) {
  const fallbackWidth = Number(fallbacks && fallbacks.width) || 0;
  const fallbackHeight = Number(fallbacks && fallbacks.height) || 0;

  if (!element || typeof element.getBoundingClientRect !== 'function') {
    return {
      width: fallbackWidth || 0,
      height: fallbackHeight || 0
    };
  }

  try {
    const rect = element.getBoundingClientRect();
    const width = Number(rect && rect.width);
    const height = Number(rect && rect.height);
    return {
      width: Number.isFinite(width) && width > 0 ? width : fallbackWidth,
      height: Number.isFinite(height) && height > 0 ? height : fallbackHeight
    };
  } catch (err) {
    return {
      width: fallbackWidth,
      height: fallbackHeight
    };
  }
}

function ensureRendererStyles(global, styles) {
  if (!styles) return;
  const doc = global && global.document;
  if (!doc) return;
  const styleId = 'weather-dashboard-renderer-style';
  let node = doc.getElementById(styleId);
  if (!node) {
    node = doc.createElement('style');
    node.id = styleId;
    const parent = doc.head || doc.body || doc.documentElement;
    if (!parent) return;
    parent.appendChild(node);
  }
  node.textContent = String(styles);
}

function applyRendererOutput(host, output) {
  if (!host) return null;
  const markup = output && typeof output.markup === 'string' ? output.markup : '';
  host.innerHTML = markup;
  const root = host.querySelector('.wdash-root');
  return root || null;
}

function applyCssVariables(root, variables) {
  if (!root || !variables || typeof variables !== 'object') return;
  Object.entries(variables).forEach(([name, value]) => {
    try {
      root.style.setProperty(name, value);
    } catch (err) {
      /* ignore invalid property assignments */
    }
  });
}

function shouldActivateBridge(global) {
  if (!global) return false;
  if (global.__WDASH_TEST_MODE__ === true) return false;
  if (global.__WEATHER_DASHBOARD_APP__) return false;
  if (global[BRIDGE_STATE_KEY]?.active) return false;
  const tile = findDisplayTile(global);
  return Boolean(tile);
}

function schedule(callback, global) {
  if (typeof global.requestAnimationFrame === 'function') {
    return global.requestAnimationFrame(callback);
  }
  if (typeof global.setTimeout === 'function') {
    return global.setTimeout(callback, 0);
  }
  callback();
  return null;
}

function bootstrapHubitatRendererBridge(options = {}) {
  const global = selectGlobalCandidate(options.global);
  const factory = options.factory;
  const baseStyles = options.baseStyles;

  if (!global || typeof factory !== 'function') {
    return null;
  }

  if (!shouldActivateBridge(global)) {
    return null;
  }

  const existingState = global[BRIDGE_STATE_KEY];
  if (existingState && existingState.active) {
    return existingState;
  }

  const state = {
    active: true,
    pending: false,
    lastPayloadSignature: null,
    host: null,
    resizeObserver: null,
    rafId: null,
    adapter: null
  };

  const adapter = createHubitatTilesAdapter({
    window: global,
    document: global.document,
    globalThis: global,
    knownPayloadKeys: KNOWN_PAYLOAD_KEYS,
    safeRenderFromData: () => requestRender()
  });
  state.adapter = adapter;

  function logDebug(message, details) {
    if (!global.console || typeof global.console.debug !== 'function') {
      return;
    }
    try {
      global.console.debug('[WeatherDashboard]', message, details || '');
    } catch (err) {
      /* ignore logging failures */
    }
  }

  function ensureHost() {
    const host = findDisplayTileHost(global, adapter);
    if (!host) return null;
    markDisplayTile(global);
    if (state.host === host) return host;
    state.host = host;
    attachResizeObserver(host);
    return host;
  }

  function attachResizeObserver(host) {
    if (!global || !host) return;
    if (state.resizeObserver && typeof state.resizeObserver.disconnect === 'function') {
      state.resizeObserver.disconnect();
    }

    if (typeof global.ResizeObserver === 'function') {
      const observer = new global.ResizeObserver(() => requestRender());
      observer.observe(host);
      state.resizeObserver = observer;
    } else if (typeof global.addEventListener === 'function') {
      const handler = () => requestRender();
      global.addEventListener('resize', handler);
      state.resizeObserver = {
        disconnect() {
          if (typeof global.removeEventListener === 'function') {
            global.removeEventListener('resize', handler);
          }
        }
      };
    }
  }

  function computePayloadSignature(payload) {
    if (!payload || typeof payload !== 'object') return null;
    try {
      return JSON.stringify(payload);
    } catch (err) {
      return null;
    }
  }

  function performRender() {
    state.pending = false;
    state.rafId = null;

    const host = ensureHost();
    if (!host) {
      logDebug('Hubitat bridge waiting for display host');
      return;
    }

    const segments = adapter.readPayloads();
    const payload = mergePayloadSegments(segments) || {};
    const signature = computePayloadSignature(payload);

    if (signature && signature === state.lastPayloadSignature) {
      return;
    }
    state.lastPayloadSignature = signature;

    const layout = extractLayoutFromPayload(payload);
    const fallbackDimensions = resolveRendererDimensions(payload, layout);
    const size = measureHostSize(global, host, fallbackDimensions);
    const data = buildRendererData(payload);

    let output;
    try {
      output = factory({
        width: size.width || fallbackDimensions.width,
        height: size.height || fallbackDimensions.height,
        layout,
        data
      });
    } catch (err) {
      if (global.console && typeof global.console.error === 'function') {
        global.console.error('[WeatherDashboard] Hubitat bridge render failed', err);
      }
      return;
    }

    if (!output) {
      return;
    }

    ensureRendererStyles(global, output.styles || baseStyles);
    const root = applyRendererOutput(host, output);
    applyCssVariables(root, output.variables);
    if (typeof adapter.toggleSourceTileMask === 'function') {
      adapter.toggleSourceTileMask(true);
    }
  }

  function requestRender() {
    if (state.pending) {
      return;
    }
    state.pending = true;
    state.rafId = schedule(() => performRender(), global);
  }

  global[BRIDGE_STATE_KEY] = state;

  if (typeof global.document?.addEventListener === 'function') {
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', () => {
        adapter.ensureDataTileObservers();
        adapter.watchForTileInsertions();
        requestRender();
      }, { once: true });
    } else {
      adapter.ensureDataTileObservers();
      adapter.watchForTileInsertions();
      requestRender();
    }
  } else {
    requestRender();
  }

  logDebug('Hubitat renderer bridge initialized');

  return state;
}

module.exports = {
  bootstrapHubitatRendererBridge
};
