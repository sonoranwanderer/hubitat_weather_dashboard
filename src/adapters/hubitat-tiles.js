const DEFAULT_TILE_PREFIX = 'tile-';

function createHubitatTilesAdapter(options = {}) {
  const {
    displayTileId = 'tile-0',
    knownPayloadKeys = new Set(),
    safeRenderFromData = () => {},
    window: providedWindow,
    document: providedDocument,
    globalThis: providedGlobal
  } = options;

  const hostWindow = providedWindow ?? (typeof window !== 'undefined' ? window : undefined);
  const hostDocument = providedDocument ?? (typeof document !== 'undefined' ? document : hostWindow?.document ?? undefined);
  const hostGlobal = providedGlobal ?? (typeof globalThis !== 'undefined' ? globalThis : hostWindow ?? {});

  const invalidJsonTiles = new Set();
  let lastSourceTileIds = [];
  const maskedTileIds = new Set();
  const dataTileObservers = new Map();
  let domObserver = null;

  function byId(id) {
    if (!id || !hostDocument || typeof hostDocument.getElementById !== 'function') {
      return null;
    }
    try {
      return hostDocument.getElementById(id);
    } catch (err) {
      return null;
    }
  }

  function findContentElement(tile) {
    if (!tile || typeof tile.querySelector !== 'function') return tile ?? null;
    const selectors = ['.tile-primary', '.tile-contents', '.tile-content', '.tile'];
    for (const sel of selectors) {
      try {
        const el = tile.querySelector(sel);
        if (el) return el;
      } catch (err) {
        // ignore selector errors
      }
    }
    return tile;
  }

  function extractJson(text) {
    if (!text || typeof text !== 'string') return null;
    const trimmed = text.trim();
    if (!trimmed) return null;
    const jsonMatch = trimmed.match(/\{.*\}|\[.*\]/s);
    return jsonMatch ? jsonMatch[0] : null;
  }

  function noteInvalidJson(tileId, reason) {
    if (!tileId || tileId === displayTileId) return;
    if (invalidJsonTiles.has(tileId)) return;
    const suffix = reason ? `: ${reason}` : '';
    if (hostWindow?.console?.info) {
      hostWindow.console.info(`[WeatherDashboard] Ignoring non-JSON content from ${tileId}${suffix}`);
    }
    invalidJsonTiles.add(tileId);
  }

  function getTileText(tile) {
    if (!tile) return '';
    const node = findContentElement(tile);
    if (!node) return '';
    try {
      return node.textContent || '';
    } catch (err) {
      return '';
    }
  }

  function readPayloads() {
    if (!hostDocument || typeof hostDocument.querySelectorAll !== 'function') {
      return [];
    }
    const tiles = Array.from(hostDocument.querySelectorAll(`[id^="${DEFAULT_TILE_PREFIX}"]`));
    const segments = [];
    const sourceIds = [];

    for (const tile of tiles) {
      const id = tile?.id;
      if (!tile || id === displayTileId || !id) continue;
      const text = getTileText(tile);
      if (!text) continue;
      const jsonText = extractJson(text);
      if (!jsonText) {
        noteInvalidJson(id, 'no JSON object found');
        continue;
      }
      try {
        const parsed = JSON.parse(jsonText);
        if (parsed && typeof parsed === 'object') {
          const keys = Object.keys(parsed);
          const recognized = keys.some(key => knownPayloadKeys.has(key) || key === 'segmentIndex' || key === 'segmentSize');
          if (!recognized) {
            noteInvalidJson(id, 'unrecognized JSON payload');
            continue;
          }
          segments.push(parsed);
          sourceIds.push(id);
        } else {
          noteInvalidJson(id, 'parsed payload is not an object');
        }
      } catch (err) {
        const message = err && err.message ? err.message : 'parse error';
        noteInvalidJson(id, message);
      }
    }

    lastSourceTileIds = sourceIds;
    return segments;
  }

  function toggleSourceTileMask(hide) {
    if (hide) {
      const currentIds = new Set(Array.isArray(lastSourceTileIds) ? lastSourceTileIds : []);
      const staleIds = Array.from(maskedTileIds).filter(id => !currentIds.has(id));
      for (const id of staleIds) {
        const tile = byId(id);
        if (tile?.classList?.remove) tile.classList.remove('wdash-source-tile');
        maskedTileIds.delete(id);
      }
      for (const id of currentIds) {
        const tile = byId(id);
        if (!tile?.classList?.add) continue;
        tile.classList.add('wdash-source-tile');
        maskedTileIds.add(id);
      }
    } else {
      for (const id of Array.from(maskedTileIds)) {
        const tile = byId(id);
        if (tile?.classList?.remove) tile.classList.remove('wdash-source-tile');
      }
      maskedTileIds.clear();
    }
  }

  function getDisplayTileHostElement() {
    if (!hostDocument) return null;
    const root = hostDocument.querySelector(`#${displayTileId} .wdash-root`);
    const displayTile = byId(displayTileId);
    const content = displayTile ? findContentElement(displayTile) : null;
    return content || root?.parentElement || root || displayTile || null;
  }

  function debounce(fn, delay) {
    let frame;
    return (...args) => {
      if (frame) hostGlobal.clearTimeout?.(frame);
      frame = hostGlobal.setTimeout?.(() => fn(...args), delay);
    };
  }

  function ensureDataTileObservers() {
    if (!hostDocument || typeof hostDocument.querySelectorAll !== 'function') return;
    const tiles = Array.from(hostDocument.querySelectorAll(`[id^="${DEFAULT_TILE_PREFIX}"]`));
    const seen = new Set();
    let needsRender = false;

    for (const tile of tiles) {
      const id = tile?.id;
      if (!id || id === displayTileId) continue;
      seen.add(id);
      const existing = dataTileObservers.get(id);
      if (existing && existing.tile === tile) continue;
      if (existing) existing.observer.disconnect();
      const observer = typeof hostGlobal.MutationObserver === 'function'
        ? new hostGlobal.MutationObserver(debounce(safeRenderFromData, 150))
        : null;
      if (!observer) continue;
      observer.observe(tile, { childList: true, subtree: true, characterData: true });
      dataTileObservers.set(id, { observer, tile });
      needsRender = true;
    }

    for (const [id, entry] of dataTileObservers.entries()) {
      if (!seen.has(id)) {
        entry.observer.disconnect();
        dataTileObservers.delete(id);
        needsRender = true;
      }
    }

    if (needsRender) {
      safeRenderFromData();
    }
  }

  function watchForTileInsertions() {
    if (domObserver || !hostDocument) return;
    const root = hostDocument.body || hostDocument.documentElement;
    if (!root || typeof hostGlobal.MutationObserver !== 'function') return;
    domObserver = new hostGlobal.MutationObserver(debounce(() => {
      ensureDataTileObservers();
    }, 200));
    domObserver.observe(root, { childList: true, subtree: true });
  }

  return {
    readPayloads,
    toggleSourceTileMask,
    ensureDataTileObservers,
    watchForTileInsertions,
    getDisplayTileHostElement,
    findContentElement,
    byId
  };
}

module.exports = {
  createHubitatTilesAdapter
};
