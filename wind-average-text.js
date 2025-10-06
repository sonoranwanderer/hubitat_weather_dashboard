// Wind Average Text Tile — 10 minute averaged direction (bearing/cardinal) + speed
(() => {
  /* ====== CONFIG ====== */
  const MAIN_TILE_ID = 'tile-23';               // Replace with the tile hosting this script
  const WIND_TILE_ID = 'tile-17';               // Tile that exposes the raw wind data
  const AVERAGE_WINDOW_MS = 10 * 60 * 1000;     // 10 minute rolling window
  const SPEED_UNIT = 'mph';                     // Display unit for averaged speed
  const SHOW_PARTS = {
    bearing: false,
    cardinal: true,
    speed: true,
    unit: false,
  };

  /* ====== CSS ====== */
  const CSS = `
  .wind-average-text-tile{position:relative;overflow:hidden;line-height:1.2}
  .wind-source-hidden{opacity:0!important;position:absolute!important;pointer-events:none!important;width:1px!important;height:1px!important;overflow:hidden!important}
  .wind-average-shell{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:0;text-align:center}
  .wind-average-line{display:inline-flex;align-items:baseline;justify-content:center;gap:0.55rem;font-size:12pt;font-weight:400;white-space:nowrap}
  .wind-average-line .value{font-variant-numeric:tabular-nums}
  .wind-average-line .unit{margin-left:0.25rem;font-size:0.65em;letter-spacing:0.08em;text-transform:uppercase;opacity:0.7}
  .wind-average-line .is-hidden{display:none!important}
  `;

  /* ====== Utilities ====== */
  const injectCSSOnce = (id, css) => {
    if (!document.getElementById(id)) {
      const style = document.createElement('style');
      style.id = id;
      style.textContent = css;
      document.head.appendChild(style);
    }
  };
  const byId = id => (id ? document.getElementById(id) : null);

  function findValueNode(tile) {
    if (!tile) return null;
    const attr = tile.querySelector('.tile-contents, .tile-primary, .tile .primary, .tile .value, .tile-content, .tile .content, .tile .attribute, .tile .attributename, .tile .html, .tile .template');
    if (attr && attr.textContent.trim()) return attr;
    const hubVar = tile.querySelector('div.flex.flex-grow.w-full.justify-center.items-center');
    if (hubVar && hubVar.textContent.trim()) return hubVar;
    let best = null, len = 0;
    (function walk(node) {
      if (!node) return;
      if (node.nodeType === 1) {
        if (node.children.length === 0) {
          const text = (node.textContent || '').trim();
          if (text && text.length > len) {
            best = node;
            len = text.length;
          }
        }
        for (const child of node.children) walk(child);
      }
    })(tile);
    return best || tile;
  }

  const nodeText = el => (el?.innerText || el?.textContent || '').trim();

  const rafDebounce = fn => {
    let scheduled = false;
    return (...args) => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        fn(...args);
      });
    };
  };

  const card16 = deg => {
    if (!Number.isFinite(deg)) return '--';
    const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
    const d = ((deg % 360) + 360) % 360;
    return dirs[Math.floor((d + 11.25) / 22.5) % 16];
  };

  function parseWind(tile, fallbackText) {
    let deg = NaN, speed = NaN;

    if (tile) {
      const root = tile.querySelector('.tile-contents, .tile-primary, .tile-content, .tile .content');
      const bearingEl = root ? Array.from(root.querySelectorAll('[class]')).find(el => el.className.split(/\s+/).some(cls => cls.startsWith('ewl-wind'))) : null;
      const speedEl = root?.querySelector('.ewi-windspeed');

      if (bearingEl) {
        const match = bearingEl.textContent?.match(/(-?\d+(?:\.\d+)?)\s*°?/);
        if (match) deg = parseFloat(match[1]);
      }
      if (speedEl) {
        const parts = speedEl.innerText.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        if (parts[0]) {
          const match = parts[0].match(/(-?\d+(?:\.\d+)?)/);
          if (match) speed = parseFloat(match[1]);
        }
      }
    }

    if (!Number.isFinite(deg) || !Number.isFinite(speed)) {
      const lines = (fallbackText || '').split('\n').map(s => s.trim()).filter(Boolean);
      if (!Number.isFinite(deg) && lines[0]) {
        const match = lines[0].match(/(-?\d+(?:\.\d+)?)\s*°/);
        if (match) deg = parseFloat(match[1]);
      }
      if (!Number.isFinite(speed) && lines[1]) {
        const match = lines[1].match(/(-?\d+(?:\.\d+)?)/);
        if (match) speed = parseFloat(match[1]);
      }
    }

    return { deg, speed };
  }

  /* ====== Averaging helpers ====== */
  const dirSamples = [];
  const dirSums = { sin: 0, cos: 0 };
  const speedSamples = [];
  let speedSum = 0;

  function pruneOld(now) {
    const ts = Number.isFinite(now) ? now : Date.now();
    const cutoff = ts - AVERAGE_WINDOW_MS;

    while (dirSamples.length && dirSamples[0].ts < cutoff) {
      const old = dirSamples.shift();
      dirSums.sin -= old.sin;
      dirSums.cos -= old.cos;
    }
    while (speedSamples.length && speedSamples[0].ts < cutoff) {
      const old = speedSamples.shift();
      speedSum -= old.speed;
    }
  }

  function addDirectionSample(deg, ts) {
    const time = Number.isFinite(ts) ? ts : Date.now();
    const rad = deg * Math.PI / 180;
    const sin = Math.sin(rad);
    const cos = Math.cos(rad);
    dirSamples.push({ ts: time, sin, cos });
    dirSums.sin += sin;
    dirSums.cos += cos;
    pruneOld(time);
  }

  function addSpeedSample(speed, ts) {
    const time = Number.isFinite(ts) ? ts : Date.now();
    speedSamples.push({ ts: time, speed });
    speedSum += speed;
    pruneOld(time);
  }

  function averageDirection() {
    pruneOld();
    if (!dirSamples.length) return NaN;
    const { sin, cos } = dirSums;
    if (Math.abs(sin) < 1e-6 && Math.abs(cos) < 1e-6) return NaN;
    const rad = Math.atan2(sin, cos);
    return ((rad * 180 / Math.PI) % 360 + 360) % 360;
  }

  function averageSpeed() {
    pruneOld();
    if (!speedSamples.length) return NaN;
    return speedSum / speedSamples.length;
  }

  function applyVisibility(el, show) {
    if (!el) return;
    if (show) el.classList.remove('is-hidden');
    else el.classList.add('is-hidden');
  }

  /* ====== Init ====== */
  function initOnce(mainTile, windTile) {
    if (!mainTile || !windTile || mainTile.dataset.windAverageTextInstalled === '1') return;
    mainTile.dataset.windAverageTextInstalled = '1';

    injectCSSOnce('wind-average-text-style', CSS);

    let windNode = findValueNode(windTile);
    if (!windNode) return;
    windNode.classList.add('wind-source-hidden');

    const shell = document.createElement('div');
    shell.className = 'wind-average-shell';
    shell.innerHTML = `
      <div class="wind-average-line">
        <span class="wind-average-bearing"><span class="value">--°</span></span>
        <span class="wind-average-cardinal"><span class="value">--</span></span>
        <span class="wind-average-speed"><span class="value">--</span><span class="unit">${SPEED_UNIT}</span></span>
      </div>`;

    mainTile.classList.add('wind-average-text-tile');
    mainTile.appendChild(shell);

    const bearingEl = shell.querySelector('.wind-average-bearing');
    const bearingValEl = shell.querySelector('.wind-average-bearing .value');
    const cardinalEl = shell.querySelector('.wind-average-cardinal');
    const cardinalValEl = shell.querySelector('.wind-average-cardinal .value');
    const speedEl = shell.querySelector('.wind-average-speed');
    const speedValEl = shell.querySelector('.wind-average-speed .value');
    const speedUnitEl = shell.querySelector('.wind-average-speed .unit');

    applyVisibility(bearingEl, !!SHOW_PARTS.bearing);
    applyVisibility(cardinalEl, !!SHOW_PARTS.cardinal);
    applyVisibility(speedEl, !!SHOW_PARTS.speed);
    applyVisibility(speedUnitEl, !!SHOW_PARTS.unit);

    const refresh = rafDebounce(() => {
      const { deg, speed } = parseWind(windTile, nodeText(windNode));
      const ts = Date.now();

      if (Number.isFinite(deg)) {
        const normalized = ((deg % 360) + 360) % 360;
        addDirectionSample(normalized, ts);
      }
      if (Number.isFinite(speed)) {
        addSpeedSample(speed, ts);
      }

      const avgDeg = averageDirection();
      const avgSpeed = averageSpeed();

      bearingValEl.textContent = Number.isFinite(avgDeg) ? `${Math.round(avgDeg)}°` : '--°';
      cardinalValEl.textContent = Number.isFinite(avgDeg) ? card16(avgDeg) : '--';
      speedValEl.textContent = Number.isFinite(avgSpeed) ? avgSpeed.toFixed(1) : '--';
    });

    const observer = new MutationObserver(refresh);
    observer.observe(windNode, { subtree: true, childList: true, characterData: true });
    refresh();

    setInterval(() => {
      const next = findValueNode(windTile);
      if (next && next !== windNode) {
        windNode.classList.remove('wind-source-hidden');
        windNode = next;
        windNode.classList.add('wind-source-hidden');
        observer.disconnect();
        observer.observe(windNode, { subtree: true, childList: true, characterData: true });
        refresh();
      }
    }, 2000);
  }

  function boot() {
    injectCSSOnce('wind-average-text-style', CSS);
    const mainTile = byId(MAIN_TILE_ID);
    const windTile = byId(WIND_TILE_ID);
    if (mainTile && windTile) initOnce(mainTile, windTile);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
    setTimeout(boot, 600);
  }
})();
