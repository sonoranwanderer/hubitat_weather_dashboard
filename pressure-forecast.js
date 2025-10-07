// Pressure Forecast Tile — toggles absolute/relative pressure, shows tendency & forecast icon
(() => {
  /* ===== CONFIG ===== */
  const DISPLAY_TILE_ID = 'tile-99';              // Tile where the custom UI should render
  const DISPLAY_TILE_TITLE = 'Pressure Summary';  // Or provide the display tile title
  const SOURCE_TILE_ID = '';                      // Optional: separate tile that exposes pressureSummary JSON
  const SOURCE_TILE_TITLE = '';                   // Optional title for the source tile
  const STORAGE_KEY = 'ecowitt-pressure-mode';

  /* ===== CSS ===== */
  const CSS = `
  .pressure-forecast-host{position:relative;overflow:hidden;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}
  .pressure-forecast-host .tile-title,.pressure-forecast-host .title{display:none!important}
  .pressure-hidden-source{display:none!important}
  .pressure-forecast{position:absolute;inset:6px;display:flex;flex-direction:column;justify-content:space-between;gap:10px;color:#f8fbff;text-shadow:0 1px 2px rgba(0,0,0,.35)}
  .pressure-main{display:flex;align-items:center;gap:10px}
  .pressure-value{display:flex;flex-direction:column;line-height:1}
  .pressure-value .number{font-weight:800;font-size:clamp(28px,9vw,40px);letter-spacing:-0.02em}
  .pressure-value .unit{font-size:clamp(12px,3vw,16px);opacity:.8;font-weight:600}
  .pressure-mode-btn{border:none;background:rgba(255,255,255,.12);color:inherit;border-radius:12px;padding:10px;display:grid;place-items:center;cursor:pointer;transition:background .2s ease,transform .2s ease}
  .pressure-mode-btn[disabled]{cursor:default;opacity:.6}
  .pressure-mode-btn:not([disabled]):hover{background:rgba(255,255,255,.2);transform:translateY(-1px)}
  .pressure-mode-btn:not([disabled]):active{transform:scale(.98)}
  .pressure-mode-btn svg{width:36px;height:36px;display:block}
  .pressure-mode-btn .label{display:block;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;opacity:.9;margin-top:4px}
  .pressure-mode-btn .icon{width:38px;height:38px;border-radius:50%;display:grid;place-items:center;background:rgba(0,0,0,.25)}
  .pressure-meta{display:flex;flex-direction:column;gap:6px;font-size:clamp(12px,3.1vw,14px)}
  .tendency{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
  .tendency .value{font-weight:700;font-size:clamp(16px,4.5vw,20px)}
  .tendency .value.positive{color:#5cff9a}
  .tendency .value.negative{color:#ff6b6b}
  .tendency .trend{font-weight:600;opacity:.85}
  .forecast{display:flex;align-items:center;gap:10px}
  .forecast-icon{width:44px;height:44px;flex:none;border-radius:50%;background:rgba(0,0,0,.25);display:grid;place-items:center}
  .forecast-icon svg{width:32px;height:32px;display:block}
  .forecast-text{flex:1;font-weight:600;line-height:1.2;opacity:.9}
  .pressure-stats{font-size:11px;opacity:.7;font-weight:600;display:flex;gap:10px;flex-wrap:wrap}
  .pressure-missing{opacity:.8;font-style:italic}
  `;

  /* ===== ICONS ===== */
  const MODE_ICONS = {
    relative: `<svg viewBox="0 0 48 48" role="img" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="M10 18h18c5 0 8 3 8 7s-3 7-8 7h-8m8-7H10v15"/></svg>`,
    absolute: `<svg viewBox="0 0 48 48" role="img" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="M24 7v34m-14-7c0 7 5 12 14 12s14-5 14-12V14c0-7-5-12-14-12S10 7 10 14v20"/></svg>`
  };

  const FORECAST_ICONS = {
    sunny: `<svg viewBox="0 0 48 48" role="img" aria-hidden="true"><circle cx="24" cy="24" r="10" fill="#ffd761"/><g stroke="#ffd761" stroke-width="3" stroke-linecap="round"><path d="M24 4v6"/><path d="M24 38v6"/><path d="M44 24h-6"/><path d="M10 24H4"/><path d="M36.97 11.03l-4.24 4.24"/><path d="M11.27 36.73l4.24-4.24"/><path d="M36.97 36.97l-4.24-4.24"/><path d="M11.27 11.27l4.24 4.24"/></g></svg>`,
    partly: `<svg viewBox="0 0 48 48" role="img" aria-hidden="true"><circle cx="18" cy="18" r="9" fill="#ffd761"/><path d="M18 9V5m0 26v4m13-13h4M0 22h4m22.49-7.51l2.83-2.83M9.68 32.32l2.83-2.83M27 34H16a8 8 0 1 1 2.46-15.65A9 9 0 0 1 27 34Z" fill="#e0f0ff" stroke="#c0d9ff" stroke-width="2" stroke-linejoin="round"/></svg>`,
    cloudy: `<svg viewBox="0 0 48 48" role="img" aria-hidden="true"><path d="M18 36h14a8 8 0 0 0 0-16 12 12 0 0 0-23.4 2.6A7.5 7.5 0 0 0 18 36Z" fill="#d0def5" stroke="#b2c8e8" stroke-width="2" stroke-linejoin="round"/></svg>`,
    rainy: `<svg viewBox="0 0 48 48" role="img" aria-hidden="true"><path d="M18 32h14a8 8 0 0 0 0-16 12 12 0 0 0-23.4 2.6A7.5 7.5 0 0 0 18 32Z" fill="#d0def5" stroke="#b2c8e8" stroke-width="2" stroke-linejoin="round"/><g stroke="#5dade2" stroke-width="2.6" stroke-linecap="round"><path d="M18 36l-2 6"/><path d="M26 36l-2 6"/><path d="M34 36l-2 6"/></g></svg>`,
    stormy: `<svg viewBox="0 0 48 48" role="img" aria-hidden="true"><path d="M18 30h14a8 8 0 0 0 0-16 12 12 0 0 0-23.4 2.6A7.5 7.5 0 0 0 18 30Z" fill="#c5d3ea" stroke="#a6bbd6" stroke-width="2" stroke-linejoin="round"/><path d="M21 28l-5 10h6l-3 8 9-12h-6l3-6z" fill="#ffd05c" stroke="#f4b03e" stroke-width="2" stroke-linejoin="round"/><g stroke="#5dade2" stroke-width="2.6" stroke-linecap="round"><path d="M30 34l-2 6"/><path d="M38 34l-2 6"/></g></svg>`
  };

  /* ===== Helpers ===== */
  const injectCSSOnce = (id, css) => {
    if (!document.getElementById(id)) {
      const style = document.createElement('style');
      style.id = id;
      style.textContent = css;
      document.head.appendChild(style);
    }
  };

  function findTileByTitle(title) {
    if (!title) return null;
    const tiles = document.querySelectorAll('.tile');
    for (const tile of tiles) {
      const t = tile.querySelector('.tile-title, .tile .title');
      if (t && t.textContent.trim() === title) return tile;
    }
    return null;
  }

  const byIdOrTitle = (id, title) => (id && document.getElementById(id)) || findTileByTitle(title);

  function findValueNode(tile) {
    if (!tile) return null;
    const selectors = ['.tile-primary', '.tile-contents', '.tile .primary', '.tile .value', '.tile-content', '.tile .content', '.tile .attribute'];
    for (const sel of selectors) {
      const el = tile.querySelector(sel);
      if (el && el.textContent.trim()) return el;
    }
    return tile;
  }

  const parseSummary = text => {
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (err) {
      try {
        const unescaped = text.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
        const cleaned = unescaped.replace(/^"|"$/g, '');
        return JSON.parse(cleaned);
      } catch (e) {
        return null;
      }
    }
  };

  const formatPressure = (value, unit) => {
    if (value == null || Number.isNaN(value)) return '--';
    const decimals = /inhg/i.test(unit) ? 2 : /kpa|mbar|hpa|mb/i.test(unit) ? 1 : 2;
    return Number(value).toFixed(decimals);
  };

  const formatTendency = (value, unit) => {
    if (value == null || Number.isNaN(value)) return '--';
    const decimals = /inhg/i.test(unit) ? 2 : 1;
    const num = Number(value).toFixed(decimals);
    return (Number(value) > 0 ? '+' : Number(value) < 0 ? '' : '') + num;
  };

  const getMode = () => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'absolute' || saved === 'relative') return saved;
    } catch (e) {
      /* ignore */
    }
    return 'relative';
  };

  const setMode = mode => {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch (e) {
      /* ignore */
    }
  };

  const modeLabel = mode => mode === 'absolute' ? 'ABS' : 'REL';

  const forecastIcon = key => FORECAST_ICONS[key] || FORECAST_ICONS.cloudy;

  /* ===== Render ===== */
  function render(tile, node, ui, summary) {
    if (!summary) {
      ui.classList.add('pressure-missing');
      ui.innerHTML = '<div class="pressure-missing">Waiting for pressure data…</div>';
      return;
    }

    const unit = summary.unit || 'inHg';
    let mode = getMode();
    const hasRelative = summary.relative != null;
    const hasAbsolute = summary.absolute != null;
    if (mode === 'relative' && !hasRelative && hasAbsolute) mode = 'absolute';
    if (mode === 'absolute' && !hasAbsolute && hasRelative) mode = 'relative';
    setMode(mode);

    const pressureValue = mode === 'absolute' ? summary.absolute : summary.relative;
    const pressureModeTitle = mode === 'absolute' ? 'Showing absolute pressure' : 'Showing relative pressure';
    const alternateMode = mode === 'absolute' ? 'relative' : 'absolute';
    const altAvailable = alternateMode === 'absolute' ? hasAbsolute : hasRelative;

    const tendencyValue = summary.tendency?.value;
    const tendencyText = summary.tendency?.text || 'Steady';
    const forecastKey = summary.forecast?.key || 'cloudy';
    const forecastText = summary.forecast?.text || 'Forecast pending';
    const dailyAvg = summary.dailyAverage;
    const avg30 = summary.thirtyDayAverage;

    const tendencyClass = Number(tendencyValue) > 0 ? 'positive' : Number(tendencyValue) < 0 ? 'negative' : 'neutral';

    ui.classList.remove('pressure-missing');
    ui.innerHTML = `
      <div class="pressure-main">
        <button class="pressure-mode-btn" type="button" aria-label="${altAvailable ? `Switch to ${alternateMode} pressure` : pressureModeTitle}" title="${altAvailable ? `Switch to ${alternateMode} pressure` : pressureModeTitle}" data-mode="${mode}" ${altAvailable ? '' : 'disabled'}>
          <div class="icon" aria-hidden="true">${MODE_ICONS[mode] || modeLabel(mode)}</div>
          <span class="label">${mode === 'absolute' ? 'ABS' : 'REL'}</span>
        </button>
        <div class="pressure-value" aria-live="polite">
          <span class="number">${formatPressure(pressureValue, unit)}</span>
          <span class="unit">${unit}</span>
        </div>
      </div>
      <div class="pressure-meta">
        <div class="tendency">
          <span class="label">Tendency:</span>
          <span class="value ${tendencyClass}">${formatTendency(tendencyValue, unit)}</span>
          <span class="unit">${unit}</span>
          <span class="trend">${tendencyText}</span>
        </div>
        <div class="pressure-stats">
          <span>Daily avg: ${dailyAvg != null ? formatPressure(dailyAvg, unit) : '--'} ${unit}</span>
          <span>30-day avg: ${avg30 != null ? formatPressure(avg30, unit) : '--'} ${unit}</span>
        </div>
        <div class="forecast">
          <div class="forecast-icon" aria-hidden="true">${forecastIcon(forecastKey)}</div>
          <div class="forecast-text">${forecastText}</div>
        </div>
      </div>`;

    const btn = ui.querySelector('.pressure-mode-btn');
    if (btn && altAvailable) {
      btn.addEventListener('click', () => {
        const nextMode = btn.dataset.mode === 'absolute' ? 'relative' : 'absolute';
        setMode(nextMode);
        render(tile, node, ui, summary);
      }, { once: true });
    }
  }

  /* ===== Init ===== */
  function setup() {
    const displayTile = byIdOrTitle(DISPLAY_TILE_ID, DISPLAY_TILE_TITLE);
    if (!displayTile || displayTile.dataset.pressureForecastInstalled === '1') return;
    const sourceTile = byIdOrTitle(SOURCE_TILE_ID, SOURCE_TILE_TITLE) || displayTile;
    const valueNode = findValueNode(sourceTile);
    if (!valueNode) return;

    displayTile.dataset.pressureForecastInstalled = '1';
    injectCSSOnce('pressure-forecast-css', CSS);
    displayTile.classList.add('pressure-forecast-host');
    if (displayTile === sourceTile && valueNode) {
      valueNode.classList.add('pressure-hidden-source');
    }

    const ui = document.createElement('div');
    ui.className = 'pressure-forecast';
    displayTile.appendChild(ui);

    const update = () => {
      const summary = parseSummary(valueNode.textContent.trim());
      render(displayTile, valueNode, ui, summary);
    };

    const observer = new MutationObserver(update);
    observer.observe(valueNode, { characterData: true, subtree: true, childList: true });
    update();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
})();
