(() => {
  /* ====== CONFIG ====== */
  const HOST_TILE_ID = 'tile-40';
  const HOST_TILE_TITLE = null; // fallback: search tile by title when id is missing

  const SOURCES = {
    main: 'tile-18',   // rate, hourly, daily, monthly, yearly
    event: 'tile-38',  // current event total
    weekly: 'tile-39', // weekly total
  };

  const HIDE_SOURCE_TILES = true;
  const HIDE_HOST_TILE_TITLE = true;

  const RATE_FULL_SCALE_IN_PER_HR = 1.4;
  const DROP_BOTTOM_Y = 150;
  const DROP_HEIGHT = 140;

  /* ====== CSS ====== */
  const CSS = `
  .rainfusion-host{position:relative;overflow:hidden}
  .rainfusion-wrap{position:absolute;inset:8px;display:grid;width:calc(100% - 16px);height:calc(100% - 16px);
    grid-template-columns:auto auto auto;gap:24px;align-content:center;justify-content:center;align-items:center;justify-items:center;
    font-family:"Inter","Segoe UI","Helvetica Neue",Arial,sans-serif;color:#f4f7ff;text-shadow:0 1px 2px rgba(0,0,0,.35)}
  .rainfusion-wrap .drop-column{display:flex;flex-direction:column;align-items:center;justify-content:center}
  .rainfusion-drop{width:100%;max-width:110px}
  .rainfusion-drop svg{width:100%;height:auto;display:block}
  .rainfusion-drop-outline{fill:none;stroke:#6ab9ff;stroke-width:6;stroke-linejoin:round}
  .rainfusion-drop-bg{fill:rgba(80,160,255,.15)}
  .rainfusion-drop-fill{transition:all .4s ease-in-out}
  .rainfusion-center{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center}
  .rainfusion-rate-line{display:flex;align-items:baseline;gap:6px;font-size:18px;font-weight:400;opacity:.9;font-variant-numeric:tabular-nums}
  .rainfusion-rate-line .label{font-weight:600;margin-right:2px}
  .rainfusion-daily-value{font-size:48px;font-weight:700;line-height:1}
  .rainfusion-daily-label{font-size:18px;font-weight:600;opacity:.9}
  .rainfusion-table{display:flex;align-items:center;justify-content:center}
  .rainfusion-table table{border-collapse:collapse;font-size:18px;min-width:140px}
  .rainfusion-table td{padding:4px 0;color:#f4f7ff}
  .rainfusion-table td:first-child{text-align:left;padding-right:12px;white-space:nowrap;opacity:.85}
  .rainfusion-table td:last-child{text-align:right;font-variant-numeric:tabular-nums}
  .hide-title .tile-title,.hide-title .title{display:none!important}
  .source-hidden{opacity:0!important;position:absolute!important;pointer-events:none!important;width:1px!important;height:1px!important;overflow:hidden!important}
  `;

  /* ====== utilities ====== */
  const injectCSSOnce = (id, css) => {
    if(document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = css;
    document.head.appendChild(style);
  };

  const byId = id => (id ? document.getElementById(id) : null);

  const findTileByTitle = title => {
    if(!title) return null;
    const tiles = document.querySelectorAll('.tile');
    for(const tile of tiles){
      const titleEl = tile.querySelector('.tile-title, .title');
      if(titleEl && titleEl.textContent.trim() === title){
        return tile;
      }
    }
    return null;
  };

  const getTileRoot = (id, title) => byId(id) || findTileByTitle(title);

  const getTileContent = tile => {
    if(!tile) return null;
    return tile.querySelector('.tile-contents, .tile-content, .tile-primary, .tile .content, .tile .primary, .tile-body, .tile-value') || tile;
  };

  const getTileText = tile => getTileContent(tile)?.innerText || '';

  const parseFirstNumber = (text) => {
    if(!text) return null;
    if(/trace/i.test(text)) return 0;
    const m = text.match(/(-?\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : null;
  };

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  const formatRate = value => value == null || !isFinite(value) ? '--' : value.toFixed(2);

  const formatInches = value => value == null || !isFinite(value) ? '--' : value.toFixed(2) + ' in';

  const whenTileAvailable = (id, title, cb) => {
    const existing = getTileRoot(id, title);
    if(existing){
      cb(existing);
      return;
    }
    const observer = new MutationObserver(() => {
      const tile = getTileRoot(id, title);
      if(tile){
        observer.disconnect();
        cb(tile);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  };

  const watchTile = (id, title, handler) => {
    whenTileAvailable(id, title, tile => {
      if(HIDE_SOURCE_TILES && tile.id !== HOST_TILE_ID){
        tile.classList.add('source-hidden');
      }
      const invoke = () => handler(tile);
      invoke();
      const observer = new MutationObserver(() => invoke());
      observer.observe(getTileContent(tile) || tile, { childList: true, subtree: true, characterData: true });
    });
  };

  /* ====== state ====== */
  const state = {
    rate: null,
    daily: null,
    hourly: null,
    monthly: null,
    yearly: null,
    event: null,
    weekly: null,
  };

  /* ====== DOM ====== */
  const initHost = (hostTile) => {
    injectCSSOnce('rainfusion-css', CSS);

    if(HIDE_HOST_TILE_TITLE && hostTile){
      hostTile.classList.add('hide-title');
    }

    hostTile.classList.add('rainfusion-host');

    const content = getTileContent(hostTile);
    if(!content) return null;
    content.innerHTML = '';

    const wrap = document.createElement('div');
    wrap.className = 'rainfusion-wrap';
    content.appendChild(wrap);

    const dropColumn = document.createElement('div');
    dropColumn.className = 'drop-column';
    wrap.appendChild(dropColumn);

    const drop = document.createElement('div');
    drop.className = 'rainfusion-drop';
    dropColumn.appendChild(drop);

    const idBase = `rainfusion-drop-${HOST_TILE_ID || Math.random().toString(36).slice(2)}`;
    const clipId = `${idBase}-clip`;
    const gradientId = `${idBase}-gradient`;

    drop.innerHTML = `
      <svg viewBox="0 0 120 160" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Rain rate">
        <defs>
          <clipPath id="${clipId}">
            <path d="M60 10 C40 45 20 75 20 105 C20 135 38 150 60 150 C82 150 100 135 100 105 C100 75 80 45 60 10 Z" />
          </clipPath>
          <linearGradient id="${gradientId}" x1="0" x2="0" y1="1" y2="0">
            <stop offset="0%" stop-color="#3d8bff" />
            <stop offset="100%" stop-color="#7dd3ff" />
          </linearGradient>
        </defs>
        <path class="rainfusion-drop-bg" d="M60 10 C40 45 20 75 20 105 C20 135 38 150 60 150 C82 150 100 135 100 105 C100 75 80 45 60 10 Z" />
        <rect class="rainfusion-drop-fill" x="20" y="150" width="80" height="0" clip-path="url(#${clipId})" rx="35" fill="url(#${gradientId})" />
        <path class="rainfusion-drop-outline" d="M60 10 C40 45 20 75 20 105 C20 135 38 150 60 150 C82 150 100 135 100 105 C100 75 80 45 60 10 Z" />
      </svg>`;

    const center = document.createElement('div');
    center.className = 'rainfusion-center';
    wrap.appendChild(center);

    const rateLine = document.createElement('div');
    rateLine.className = 'rainfusion-rate-line';
    rateLine.innerHTML = '<span class="label">Rate:</span><span class="value">--</span><span class="unit">in/hr</span>';
    center.appendChild(rateLine);

    const dailyValue = document.createElement('div');
    dailyValue.className = 'rainfusion-daily-value';
    dailyValue.innerHTML = '<span class="value">--</span>';
    center.appendChild(dailyValue);

    const dailyLabel = document.createElement('div');
    dailyLabel.className = 'rainfusion-daily-label';
    dailyLabel.textContent = 'Daily Rain';
    center.appendChild(dailyLabel);

    const tableWrap = document.createElement('div');
    tableWrap.className = 'rainfusion-table';
    wrap.appendChild(tableWrap);

    const table = document.createElement('table');
    tableWrap.appendChild(table);

    const rows = [
      ['Event', 'event'],
      ['Hourly', 'hourly'],
      ['Weekly', 'weekly'],
      ['Monthly', 'monthly'],
      ['Yearly', 'yearly'],
    ];

    const rowMap = new Map();

    for(const [label, key] of rows){
      const tr = document.createElement('tr');
      const tdLabel = document.createElement('td');
      tdLabel.textContent = label;
      const tdValue = document.createElement('td');
      tdValue.className = `value-${key}`;
      tdValue.textContent = '--';
      tr.appendChild(tdLabel);
      tr.appendChild(tdValue);
      table.appendChild(tr);
      rowMap.set(key, tdValue);
    }

    const dropFillRect = drop.querySelector('.rainfusion-drop-fill');
    const rateValueSpan = rateLine.querySelector('.value');
    const rateUnitSpan = rateLine.querySelector('.unit');
    const dailyValueSpan = dailyValue.querySelector('.value');

    const updateView = () => {
      const rate = state.rate;
      const ratio = rate == null || !isFinite(rate) ? 0 : clamp(rate / RATE_FULL_SCALE_IN_PER_HR, 0, 1);
      const height = DROP_HEIGHT * ratio;
      const y = DROP_BOTTOM_Y - height;
      dropFillRect.setAttribute('y', String(y));
      dropFillRect.setAttribute('height', String(height));

      rateValueSpan.textContent = formatRate(rate);
      rateUnitSpan.style.display = rate == null || !isFinite(rate) ? 'none' : 'inline';
      dailyValueSpan.textContent = state.daily == null || !isFinite(state.daily) ? '--' : state.daily.toFixed(2);

      rowMap.get('event').textContent = formatInches(state.event);
      rowMap.get('hourly').textContent = formatInches(state.hourly);
      rowMap.get('weekly').textContent = formatInches(state.weekly);
      rowMap.get('monthly').textContent = formatInches(state.monthly);
      rowMap.get('yearly').textContent = formatInches(state.yearly);
    };

    return { updateView };
  };

  /* ====== main ====== */
  let view = null;

  whenTileAvailable(HOST_TILE_ID, HOST_TILE_TITLE, hostTile => {
    view = initHost(hostTile);
    if(view){
      view.updateView();
    }
  });

  watchTile(SOURCES.main, null, tile => {
    const text = getTileText(tile);
    const lines = text.split(/\n+/).map(s => s.trim()).filter(Boolean);
    if(lines.length){
      const firstLine = lines[0];
      const rate = parseFirstNumber(firstLine);
      if(rate != null) state.rate = rate;
    }

    for(const line of lines){
      if(/hourly/i.test(line)){
        const v = parseFirstNumber(line);
        if(v != null) state.hourly = v;
      } else if(/daily/i.test(line)){
        const v = parseFirstNumber(line);
        if(v != null) state.daily = v;
      } else if(/monthly/i.test(line)){
        const v = parseFirstNumber(line);
        if(v != null) state.monthly = v;
      } else if(/yearly/i.test(line)){
        const v = parseFirstNumber(line);
        if(v != null) state.yearly = v;
      }
    }

    view && view.updateView();
  });

  watchTile(SOURCES.event, null, tile => {
    const text = getTileText(tile);
    const val = parseFirstNumber(text);
    if(val != null) state.event = val;
    view && view.updateView();
  });

  watchTile(SOURCES.weekly, null, tile => {
    const text = getTileText(tile);
    const val = parseFirstNumber(text);
    if(val != null) state.weekly = val;
    view && view.updateView();
  });
})();
