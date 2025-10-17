// weather-dashboard.js
//
// JavaScript presentation layer for the Hubitat dashboard tile.  This script is
// intended to be loaded via the JavaScript Injector driver (tile-0).  It reads the
// JSON payload exposed by the Weather Dashboard virtual device (tile-1, optional
// tile-2/tile-3) and renders an information dense layout inspired by the Ecowitt
// console.

(() => {
  const DISPLAY_TILE_ID = 'tile-0';
  const CSS_ID = 'weather-dashboard-css';
  const TEMP_RANGE = { min: -40, max: 120 };
  const AMBIENT_ROTATION_INTERVAL_MS = 5000;
  const INIT_RETRY_LIMIT = 40;
  const INIT_RETRY_DELAY = 250;
  const DATA_REFRESH_INTERVAL = 5000;
  const MAX_CHUNK_TILES = 10;
  const DEFAULT_BASE_WIDTH = 1200;
  const DEFAULT_BASE_HEIGHT = 900;

  const DEFAULT_LAYOUT = {
    baseWidth: DEFAULT_BASE_WIDTH,
    baseHeight: DEFAULT_BASE_HEIGHT,
    desktop: {
      columns: 'repeat(2, minmax(0, 1fr))',
      gap: '14px',
      rows: [
        { columns: ['temp-wind', 'ambient'], height: 450 },
        { columns: ['air', 'rain'], height: 160 },
        { columns: ['solar', 'rain'], height: 180 },
        { columns: ['solar', 'pressure'], height: 110 }
      ]
    },
    tablet: {
      columns: 'minmax(0, 1.25fr) minmax(0, 1fr)',
      gap: '12px',
      rows: [
        { columns: ['temp-wind', 'temp-wind'], height: 380 },
        { columns: ['air', 'ambient'], height: 240 },
        { columns: ['solar', 'rain'], height: 320 },
        { columns: ['pressure', 'pressure'], height: 220 }
      ]
    },
    mobile: {
      columns: '1fr',
      gap: '10px',
      rows: [
        { columns: ['temp-wind'], height: 360 },
        { columns: ['air'], height: 210 },
        { columns: ['solar'], height: 320 },
        { columns: ['ambient'], height: 220 },
        { columns: ['rain'], height: 260 },
        { columns: ['pressure'], height: 220 }
      ]
    }
  };

  const DEFAULT_TEMPLATES = compileLayoutTemplates(DEFAULT_LAYOUT);
  const DEFAULT_COLUMNS = {
    desktop: DEFAULT_LAYOUT.desktop.columns,
    tablet: DEFAULT_LAYOUT.tablet.columns,
    mobile: DEFAULT_LAYOUT.mobile.columns
  };
  const DEFAULT_GAPS = {
    desktop: DEFAULT_LAYOUT.desktop.gap,
    tablet: DEFAULT_LAYOUT.tablet.gap,
    mobile: DEFAULT_LAYOUT.mobile.gap
  };

  let currentBaseWidth = DEFAULT_BASE_WIDTH;
  let currentBaseHeight = DEFAULT_BASE_HEIGHT;

  const layoutState = {
    baseWidth: DEFAULT_BASE_WIDTH,
    baseHeight: DEFAULT_BASE_HEIGHT,
    columns: { ...DEFAULT_COLUMNS },
    gaps: { ...DEFAULT_GAPS },
    templates: DEFAULT_TEMPLATES,
    signature: null
  };

  const TEMP_COLORS = [
    { max: -20, colors: ['#70a9ff', '#3c6aff'] },
    { max: -5, colors: ['#5a8fff', '#3360ff'] },
    { max: 10, colors: ['#4f7dff', '#2f8aff'] },
    { max: 25, colors: ['#3e8eff', '#28b4ff'] },
    { max: 40, colors: ['#3fbaef', '#63d8ff'] },
    { max: 55, colors: ['#7ad95f', '#b8f48a'] },
    { max: 70, colors: ['#f3e96f', '#ffc96d'] },
    { max: 85, colors: ['#ffb95a', '#ff914a'] },
    { max: 100, colors: ['#ff7d3d', '#f25b2c'] },
    { max: Infinity, colors: ['#d83a2a', '#a52222'] }
  ];

  // Ambient ring geometry (single source of truth)
  const AMBIENT_RING = { r: 45, stroke: 10 };
  // separate ring geometry for outdoor gauge and wind compass
  const OUTDOOR_RING = { r: 45, stroke: 10 };

  const CARD_TITLES = {
    temperature: 'Outdoor Temperature',
    wind: 'Wind',
    rain: 'Rain',
    pressure: 'Barometer',
    sunMoon: 'Sun & Moon',
    air: 'Air Quality'
  };

  const LIGHTNING_BOLT_ICON = `
    <svg viewBox="0 0 48 48" class="wdash-lightning-bolt-svg" focusable="false" aria-hidden="true">
      <path d="M26.9 3.2L7.6 27h11.7l-3.6 18.3L40.4 21H28.6z" fill="#ffd766" stroke="rgba(0,0,0,0.28)" stroke-width="2" stroke-linejoin="round" />
    </svg>
  `;

  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const DEFAULT_MOON_PHASE_KEY = 'new-moon';
  const MOON_PHASE_NAME_MAP = {
    'new moon': 'new-moon',
    'waxing crescent': 'waxing-crescent',
    'first quarter': 'first-quarter',
    'waxing gibbous': 'waxing-gibbous',
    'full moon': 'full-moon',
    'waning gibbous': 'waning-gibbous',
    'last quarter': 'last-quarter',
    'third quarter': 'last-quarter',
    'waning crescent': 'waning-crescent'
  };

  let ambientRotation = {
    timer: null,
    sensors: [],
    index: 0,
    interval: AMBIENT_ROTATION_INTERVAL_MS,
    tempUnit: '°F',
    humidityUnit: '%',
    countdownTimer: null,
    nextSwitchAt: null,
    paused: false
  };

  let airQualityRotation = {
    timer: null,
    sources: [], // ['outdoor', 'indoor']
    index: 0,
    interval: 10000, // Rotate every 10 seconds
    paused: false,
    nextSwitchAt: null,
    countdownTimer: null,
    lastData: null
  };

  const hubClockState = {
    timer: null,
    target: null,
    baseUtc: null,
    deltaUtcMs: null,
    offsetMinutes: null,
    zone: null,
    mode: 'datetime',
    fallbackLabel: '',
    lastText: null,
    sourceParts: null
  };
  const hubClockFormatterCache = new Map();

  // remember last shown humidity per sensor (keyed by sensor identifiers)
  const ambientLastHumidity = new Map();
  // remember the last displayed humidity value (single source) so when the card is
  // rebuilt for a new sensor we can animate from the last visual state rather than 0%
  const ambientLastDisplayedHumidity = { key: null, value: null };
  // track which ambient index we've initialized into the DOM to avoid re-init loops
  let ambientLastInitIndex = null;

  const dataTileObservers = new Map();
  let domObserver = null;
  let scaleObserver = null;
  let scaleResizeHandler = null;
  let tempWindGaugeObserver = null;
  let tempWindGaugeResizeHandler = null;
  let tempWindGaugeRaf = null;
  let tempWindGaugeRafType = null;
  let tempWindGaugeLastSize = null;
  const placeholderLogged = new Set();
  let pressureMode = 'relative';
  let lastSuccessfulPayload = null;
  let lastSuccessfulRawPayload = null;
  let lastSuccessfulFingerprint = null;

  patchDashboardGlitches();
  whenDomReady(init);

  function whenDomReady(callback) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', callback, { once: true });
    } else {
      callback();
    }
  }

  function patchDashboardGlitches() {
    if (typeof window === 'undefined') return;

    if (!window.__wdashHistoryPatched && typeof window.addToDashboardHistory === 'function') {
      const original = window.addToDashboardHistory;
      window.addToDashboardHistory = function patchedAddToDashboardHistory(...args) {
        try {
          return original.apply(this, args);
        } catch (err) {
          console.warn('[WeatherDashboard] Suppressed dashboard history error', err);
          return undefined;
        }
      };
      window.__wdashHistoryPatched = true;
    }

    if (!window.__wdashSocketGuard) {
      window.addEventListener('error', event => {
        if (!event) return;
        const message = String(event.message || '');
        if (message.includes("Cannot set properties of undefined (setting 'value')") && event.filename && event.filename.indexOf('app.js') !== -1) {
          event.preventDefault();
          if (typeof event.stopImmediatePropagation === 'function') {
            event.stopImmediatePropagation();
          }
          console.warn('[WeatherDashboard] Ignored dashboard socket value update error', {
            message: event.message,
            filename: event.filename
          });
        }
      }, true);
      window.__wdashSocketGuard = true;
    }
  }

  function init(attempt = 0) {
    const displayTile = byId(DISPLAY_TILE_ID);
    if (!displayTile) {
      if (attempt < INIT_RETRY_LIMIT) {
        setTimeout(() => init(attempt + 1), INIT_RETRY_DELAY);
      } else {
        console.warn('[WeatherDashboard] Display tile not found after waiting');
      }
      return;
    }

    injectCSS();
    displayTile.classList.add('wdash-host');

    const content = findContentElement(displayTile);
    if (!content) {
      console.warn('[WeatherDashboard] Unable to find content node for display tile');
      return;
    }

    content.innerHTML = `
      <div class="wdash-root" style="--wdash-base-width:${DEFAULT_BASE_WIDTH}px;--wdash-base-height:${DEFAULT_BASE_HEIGHT}px;">
        <div class="wdash-frame">
          <div class="wdash" role="presentation">
            <div class="wdash-grid" data-empty="true"></div>
          </div>
        </div>
      </div>
    `;

    applyLayoutOverrides();
    setupScaling(displayTile, content);

    ensureDataTileObservers();
    watchForTileInsertions();

    safeRenderFromData();
    setInterval(safeRenderFromData, DATA_REFRESH_INTERVAL);
  }

  function safeRenderFromData() {
    try {
      renderFromData();
    } catch (err) {
      console.error('[WeatherDashboard] Unable to render dashboard payload', err);
    }
  }

  function renderFromData() {
    const payload = mergePayloads(readPayloads());
    const grid = document.querySelector('#' + DISPLAY_TILE_ID + ' .wdash-grid');
    if (!grid) return;

    applyLayoutOverrides(payload?.metadata);
    applyScale();

    if (!payload) {
      grid.dataset.empty = 'true';
      grid.innerHTML = `<div class="wdash-empty">Waiting for weather data…</div>`;
      clearAmbientRotation();
      toggleSourceTileMask(false);
      clearAirQualityRotation();
      stopHubClock();
      teardownTempWindGaugeSizing();
      return;
    }

    grid.dataset.empty = 'false';
    const newMarkup = buildMarkup(payload);
    // Only replace the grid contents when markup actually changes to avoid
    // spurious DOM rebuilds (which can make the ambient rings redraw)
    if (grid.innerHTML !== newMarkup) {
      grid.innerHTML = newMarkup;
      // initialize ambient humidity circle from any remembered last value so it
      // doesn't animate from 0% when the card is first built or when switching sensors
      try {
        const ambientContainer = document.querySelector('#' + DISPLAY_TILE_ID + ' .wdash-ambient');
        if (ambientContainer) initAmbientLastHum(ambientContainer);
      } catch (e) { /* ignore */ }
    }
    setupAmbientRotation(payload);
    setupAirQualityRotation(payload);
    setupInteractiveComponents(grid);
    setupHubClock(payload);
    // observe ambient container for size changes to keep ring geometry synchronized
    try {
      const ambientContainer = document.querySelector('#' + DISPLAY_TILE_ID + ' .wdash-ambient');
      if (ambientContainer && typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => { applyAmbientRingSizing(); applyOutdoorRingSizing(); });
        ro.observe(ambientContainer);
      } else {
        // fallback: window resize
        window.addEventListener('resize', () => { applyAmbientRingSizing(); applyOutdoorRingSizing(); });
      }
    } catch (e) {
      // ignore observer setup failures in constrained environments
    }
    toggleSourceTileMask(true);
  }

  function readPayloads() {
    const tile1 = byId('tile-1');
    const text1 = getTileText(tile1);
    if (!text1) return lastSuccessfulPayload ? [lastSuccessfulPayload] : [];

    const json1 = extractJson(text1);
    if (!json1) return lastSuccessfulPayload ? [lastSuccessfulPayload] : [];

      try {
        const parsed1 = JSON.parse(json1);
        const normalized1 = normalizeChunkEnvelope(parsed1);
        if (!normalized1) {
          // Not chunked, return as a single payload
          lastSuccessfulPayload = parsed1;
          lastSuccessfulRawPayload = json1;
          lastSuccessfulFingerprint = null;
          return [parsed1];
        }

        const totalChunks = normalized1.count;
        if (!Number.isInteger(totalChunks) || totalChunks < 1) {
          console.warn('[WeatherDashboard] Invalid chunkCount found in tile-1', parsed1);
          return lastSuccessfulPayload ? [lastSuccessfulPayload] : [];
        }

        const chunkEnvelopes = [parsed1];
      // Read every chunk tile that could contain weather dashboard data. This protects against
      // scenarios where a refreshed payload updates later chunks before earlier tiles repaint.
      for (let i = 2; i <= MAX_CHUNK_TILES; i++) {
        const tile = byId(`tile-${i}`);
        const text = getTileText(tile);
        if (!text) continue;
        const json = extractJson(text);
        if (!json) continue;
        try {
          const parsed = JSON.parse(json);
          if (isChunkEnvelope(parsed)) {
            chunkEnvelopes.push(parsed);
          }
        } catch (err) {
          console.warn(
            `[WeatherDashboard] Failed to parse payload from tile-${i}`,
            err && err.message ? err.message : err
          );
        }
      }

      const assembled = assembleChunkPayload(chunkEnvelopes, {
        lastSuccessfulPayload,
        lastSuccessfulRawPayload,
        lastSuccessfulFingerprint
      });
      if (assembled) {
        lastSuccessfulPayload = assembled.payload;
        lastSuccessfulRawPayload = assembled.raw;
        lastSuccessfulFingerprint = assembled.fingerprint || null;
        return [assembled.payload];
      }

      return lastSuccessfulPayload ? [lastSuccessfulPayload] : [];
    } catch (err) {
      console.warn('[WeatherDashboard] Failed to parse payload from tile-1', err, json1.slice(0, 200));
      return lastSuccessfulPayload ? [lastSuccessfulPayload] : [];
    }
  }

  function toggleSourceTileMask(hide) {
    const count = ambientRotation.chunkCount || 1;
    for (let i = 1; i <= count; i++) {
      const id = `tile-${i}`;
      const tile = byId(id);
      if (!tile) continue;
      tile.classList.toggle('wdash-source-tile', hide);
    }
  }

  function applyLayoutOverrides(metadata) {
    const root = document.querySelector('#' + DISPLAY_TILE_ID + ' .wdash-root');
    const dash = document.querySelector('#' + DISPLAY_TILE_ID + ' .wdash');
    if (!root || !dash) return;

    const override = metadata ? extractLayoutOverride(metadata.layout) : null;
    const mergedLayout = deepMerge(DEFAULT_LAYOUT, override || {});
    const compiled = compileLayoutTemplates(mergedLayout);

    const columns = {
      desktop: sanitizeColumns(mergedLayout.desktop?.columns, DEFAULT_COLUMNS.desktop),
      tablet: sanitizeColumns(mergedLayout.tablet?.columns, DEFAULT_COLUMNS.tablet),
      mobile: sanitizeColumns(mergedLayout.mobile?.columns, DEFAULT_COLUMNS.mobile)
    };
    const gaps = {
      desktop: sanitizeGap(mergedLayout.desktop?.gap, DEFAULT_GAPS.desktop),
      tablet: sanitizeGap(mergedLayout.tablet?.gap, DEFAULT_GAPS.tablet),
      mobile: sanitizeGap(mergedLayout.mobile?.gap, DEFAULT_GAPS.mobile)
    };

    const baseWidth = sanitizeDimension(mergedLayout.baseWidth, DEFAULT_BASE_WIDTH);
    const baseHeight = sanitizeDimension(mergedLayout.baseHeight, DEFAULT_BASE_HEIGHT);

    const signature = JSON.stringify({
      baseWidth,
      baseHeight,
      columns,
      gaps,
      templates: {
        desktop: { rows: compiled.desktop.rows, areas: compiled.desktop.areas },
        tablet: { rows: compiled.tablet.rows, areas: compiled.tablet.areas },
        mobile: { rows: compiled.mobile.rows, areas: compiled.mobile.areas }
      }
    });

    if (layoutState.signature === signature) return;

    layoutState.signature = signature;
    layoutState.baseWidth = baseWidth;
    layoutState.baseHeight = baseHeight;
    layoutState.columns = columns;
    layoutState.gaps = gaps;
    layoutState.templates = compiled;

    currentBaseWidth = baseWidth;
    currentBaseHeight = baseHeight;

    root.style.setProperty('--wdash-base-width', `${baseWidth}px`);
    root.style.setProperty('--wdash-base-height', `${baseHeight}px`);

    dash.style.setProperty('--wdash-grid-columns-desktop', columns.desktop);
    dash.style.setProperty('--wdash-grid-columns-tablet', columns.tablet);
    dash.style.setProperty('--wdash-grid-columns-mobile', columns.mobile);
    dash.style.setProperty('--wdash-grid-rows-desktop', compiled.desktop.rows);
    dash.style.setProperty('--wdash-grid-rows-tablet', compiled.tablet.rows);
    dash.style.setProperty('--wdash-grid-rows-mobile', compiled.mobile.rows);
    dash.style.setProperty('--wdash-grid-areas-desktop', compiled.desktop.areas);
    dash.style.setProperty('--wdash-grid-areas-tablet', compiled.tablet.areas);
    dash.style.setProperty('--wdash-grid-areas-mobile', compiled.mobile.areas);
    dash.style.setProperty('--wdash-grid-gap-desktop', gaps.desktop);
    dash.style.setProperty('--wdash-grid-gap-tablet', gaps.tablet);
    dash.style.setProperty('--wdash-grid-gap-mobile', gaps.mobile);

    const hasLightningArea = templateHasArea(compiled.desktop, 'lightning')
      || templateHasArea(compiled.tablet, 'lightning')
      || templateHasArea(compiled.mobile, 'lightning');
    if (hasLightningArea) {
      dash.dataset.layoutHasLightning = 'true';
    } else if (dash.dataset.layoutHasLightning) {
      delete dash.dataset.layoutHasLightning;
    }
  }

  function ensureDataTileObservers() {
    for (let i = 1; i <= MAX_CHUNK_TILES; i++) {
      const id = `tile-${i}`;
      const tile = byId(id);
      const existing = dataTileObservers.get(id);
      if (!tile) {
        if (existing) {
          existing.observer.disconnect();
          dataTileObservers.delete(id);
        }
        continue;
      }
      if (existing && existing.tile === tile) continue;
      if (existing) {
        existing.observer.disconnect();
      }
      const observer = new MutationObserver(debounce(safeRenderFromData, 150));
      observer.observe(tile, { childList: true, subtree: true, characterData: true });
      dataTileObservers.set(id, { observer, tile });
      safeRenderFromData();
    }
  }

  function setupScaling(displayTile, content) {
    const root = content.querySelector('.wdash-root');
    if (!root) return;
    applyScale(root);
    if (!scaleResizeHandler) {
      scaleResizeHandler = () => applyScale();
      window.addEventListener('resize', scaleResizeHandler);
    }
    if (typeof ResizeObserver !== 'function') return;
    if (scaleObserver) {
      scaleObserver.disconnect();
    }
    scaleObserver = new ResizeObserver(() => applyScale(root));
    scaleObserver.observe(displayTile);
  }

  function applyScale(rootEl) {
    const root = rootEl || document.querySelector('#' + DISPLAY_TILE_ID + ' .wdash-root');
    if (!root) return;
    const rect = root.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    if (!width || !height) return;
    const baseWidth = Math.max(1, Number(currentBaseWidth) || DEFAULT_BASE_WIDTH);
    const baseHeight = Math.max(1, Number(currentBaseHeight) || DEFAULT_BASE_HEIGHT);
    const scale = Math.max(0.1, Math.min(width / baseWidth, height / baseHeight));
    const renderWidth = baseWidth * scale;
    const renderHeight = baseHeight * scale;
    root.style.setProperty('--wdash-scale', `${scale}`);
    root.style.setProperty('--wdash-render-width', `${renderWidth}px`);
    root.style.setProperty('--wdash-render-height', `${renderHeight}px`);
  }

  function watchForTileInsertions() {
    if (domObserver || !(document.body || document.documentElement)) return;
    const root = document.body || document.documentElement;
    domObserver = new MutationObserver(debounce(() => {
      ensureDataTileObservers();
    }, 200));
    domObserver.observe(root, { childList: true, subtree: true });
  }

  function mergePayloads(payloads) {
    if (!payloads || !payloads.length) return null;
    return payloads.reduce((acc, item) => deepMerge(acc, item), {});
  }

  function buildMarkup(data) {
    return `
      ${[
        buildTempWindCard(data),
        buildAmbientSensorCard(data),
        buildLightningCard(data),
        buildPressureCard(data),
        buildRainCard(data),
        buildSolarSunCard(data),
        buildAirQualityCard(data)
      ].join('')}
    `;
  }

  function buildTempWindCard(data) {
    const outdoor = data.outdoor || {};
    const temp = toNumber(outdoor.temperatureF);
    const high = toNumber(outdoor.dailyHighF);
    const low = toNumber(outdoor.dailyLowF);
    const feels = toNumber(outdoor.feelsLikeF);
    const dew = toNumber(outdoor.dewPointF);
    const humidity = toNumber(outdoor.humidity);
    const trend = toNumber(outdoor.trendFPerHour);

    const wind = data.wind || {};
    const avg = wind.average || {};
    const speed = toNumber(wind.speedMph);
    const gust = toNumber(wind.gustMph);
    const dirDegrees = toNumber(wind.directionDegrees);
    const dirText = wind.directionCardinal || null;
    const avgSpeed = toNumber(avg.speedMph);
    const avgDir = toNumber(avg.directionDegrees);
    const avgDirText = avg.directionCardinal || (Number.isFinite(avgDir) ? degreesToCardinal(avgDir) : null);
    const windowMins = wind.averageMinutes || avg.minutes || 10;
    const dailyMaxGust = toNumber(wind.dailyMaxGustMph);

    const bearingLabel = dirText || (Number.isFinite(dirDegrees) ? degreesToCardinal(dirDegrees) : '--');

    const tempColor = colorForTemp(temp);
    const indicator = gaugeIndicator(temp);
    const dewText = formatTemperature(dew);
    const humidityText = formatPercent(humidity, 0);
    const trendText = formatSigned(trend, 1, '°/hr');
    const feelsText = formatTemperature(feels);
    const highText = formatTemperature(high);
    const lowText = formatTemperature(low);
    const gustText = Number.isFinite(gust) ? `${formatNumber(gust, 1)} mph` : '--';
    const avgSpeedText = Number.isFinite(avgSpeed) ? `${formatNumber(avgSpeed, 1)} mph` : '--';
    const avgCombinedText = `${avgDirText || '--'} ${avgSpeedText}`;
    const dailyMaxGustText = Number.isFinite(dailyMaxGust) ? `${formatNumber(dailyMaxGust, 1)} mph` : '--';

    const generatedAt = data.metadata?.generatedAt;
    const stationReportedAt = data.metadata?.weatherStationTime || generatedAt;
    const stationLabel = stationReportedAt ? formatHubClock(stationReportedAt, { includeSeconds: false }) : null;
    const updatedLabel = stationLabel ? `Updated ${stationLabel}` : '';

    const outdoorBatterySlot = buildBatterySlot(toNumber(outdoor.battery), {
      orientation: 'landscape',
      className: 'wdash-temp-wind-battery',
      label: 'Outdoor sensor',
      titlePrefix: 'Outdoor sensor battery'
    });

    let gaugeSizeAttr = '';
    if (Number.isFinite(tempWindGaugeLastSize) && tempWindGaugeLastSize > 0) {
      const normalizedGaugeSize = Math.max(0, Math.round(tempWindGaugeLastSize * 100) / 100);
      gaugeSizeAttr = ` data-temp-wind-gauge-size="${normalizedGaugeSize}" style="--temp-wind-gauge-size:${normalizedGaugeSize}px;"`;
    }

    const detailsRow = buildMetricRow([
      { label: 'Feels Like', value: feelsText },
      { label: 'Dew Point', value: dewText },
      { label: 'Humidity', value: humidityText },
      { label: 'Temp Trend', value: trendText },
      { label: `${windowMins}m Avg`, value: avgCombinedText },
      { label: 'Max Gust', value: dailyMaxGustText }
    ], 'wdash-temp-wind-details', { layout: 'fill', columns: 6 });

    const headerMeta = `
      <div class="wdash-temp-wind-header-meta">
        <span class="wdash-updated">
          <span class="wdash-updated-line wdash-updated-line--primary">${escapeHtml(updatedLabel)}</span>
        </span>
        ${outdoorBatterySlot}
      </div>
    `;

    return `
      <section class="wdash-card wdash-card--temp-wind"${gaugeSizeAttr}>
        <header class="wdash-card-header wdash-card-header--temp-wind">
          <div class="wdash-card-header-main">
            <h3>Outdoor Conditions</h3>
          </div>
          ${headerMeta}
        </header>
        <div class="wdash-temp-wind-main">
          <div class="wdash-temp">
            <div class="wdash-gauge" style="--gauge-indicator:${indicator};--gauge-color-a:${tempColor.colors[0]};--gauge-color-b:${tempColor.colors[1]};--gauge-color-mid:${tempColor.mid};--gauge-band-progress:${tempColor.progress};">
              <svg class="wdash-gauge-svg" viewBox="0 0 100 100" aria-hidden="true">
                <defs>
                  <linearGradient id="wdash-temp-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stop-color="${tempColor.colors[0]}" />
                    <stop offset="50%" stop-color="${tempColor.colors[1]}" />
                    <stop offset="100%" stop-color="${tempColor.colors[1]}" />
                  </linearGradient>
                </defs>
                <circle class="wdash-gauge-track" cx="50" cy="50" r="${OUTDOOR_RING.r + OUTDOOR_RING.stroke/2}" fill="transparent" stroke="rgba(255,255,255,0.12)" stroke-width="1" />
                <circle cx="50" cy="50" r="${OUTDOOR_RING.r - OUTDOOR_RING.stroke/2}" class="wdash-gauge-inner-edge" fill="transparent" stroke="rgba(255,255,255,0.08)" stroke-width="1.4" stroke-dasharray="6 6" />
                <circle class="wdash-gauge-inner-fill" cx="50" cy="50" r="${OUTDOOR_RING.r - OUTDOOR_RING.stroke/2}" fill="rgba(5,10,20,0.85)" />
                <circle class="wdash-gauge-fill" cx="50" cy="50" r="${OUTDOOR_RING.r}" fill="none" stroke="url(#wdash-temp-gradient)" stroke-width="${OUTDOOR_RING.stroke}" stroke-linecap="round" transform="rotate(-90 50 50)" stroke-dasharray="${Math.round(2*Math.PI*OUTDOOR_RING.r)}" stroke-dashoffset="0" />
              </svg>
              <div class="wdash-gauge-center">
                <div class="wdash-temp-extrema wdash-temp-extrema--high">
                  <span class="wdash-temp-extrema-label">High</span>
                  <span class="wdash-temp-extrema-value">${highText}</span>
                </div>
                <div class="wdash-gauge-current">
                  <span class="wdash-gauge-value">${formatTemperature(temp)}</span>
                </div>
                <div class="wdash-temp-extrema wdash-temp-extrema--low">
                  <span class="wdash-temp-extrema-label">Low</span>
                  <span class="wdash-temp-extrema-value">${lowText}</span>
                </div>
              </div>
            </div>
          </div>
          <div class="wdash-wind">
            <div class="wdash-wind-compass" aria-label="Wind direction ${bearingLabel} ${formatDegrees(dirDegrees)}">
              ${windCompassSvg(dirDegrees, avgDir)}
              <div class="wdash-wind-overlay">
                <span class="wdash-wind-bearing-line">
                  <span class="wdash-wind-bearing">${bearingLabel}</span>
                  <span class="wdash-wind-heading"> ${formatDegrees(dirDegrees)}</span>
                </span>
                <span class="wdash-wind-speed">
                  <span class="wdash-wind-speed-value">${formatNumber(speed, 1)}</span>
                  <span class="wdash-unit">mph</span>
                </span>
                <span class="wdash-wind-gust">
                  <span class="wdash-wind-gust-label">Gust: </span>
                  <span class="wdash-wind-gust-value">${gustText}</span>
                </span>
              </div>
            </div>
          </div>
        </div>
        <div class="wdash-temp-wind-footer">
          ${detailsRow}
        </div>
      </section>
    `;
  }

  function getAmbientSensorKey(sensor, index) {
    if (sensor && typeof sensor === 'object') {
      if (sensor.id != null) {
        const trimmedId = String(sensor.id).trim();
        if (trimmedId) {
          return `id:${trimmedId}`;
        }
      }
      if (sensor.name != null) {
        const trimmedName = String(sensor.name).trim();
        if (trimmedName) {
          return `name:${trimmedName}`;
        }
      }
    }
    if (Number.isInteger(index) && index >= 0) {
      return `index:${index}`;
    }
    return null;
  }

  function lookupAmbientCachedHumidity(sensor, sensorKey, headerName) {
    const candidates = [];
    if (sensorKey) candidates.push(sensorKey);
    if (sensor && sensor.name != null) {
      const sensorNameKey = getAmbientNameKey(sensor.name);
      if (sensorNameKey) candidates.push(sensorNameKey);
    }
    if (headerName) {
      const headerKey = getAmbientNameKey(headerName);
      if (headerKey) candidates.push(headerKey);
    }

    for (const key of candidates) {
      if (ambientLastHumidity.has(key)) {
        const value = ambientLastHumidity.get(key);
        if (Number.isFinite(value)) return value;
      }
    }

    if (Number.isFinite(ambientLastDisplayedHumidity.value)) {
      return ambientLastDisplayedHumidity.value;
    }

    return null;
  }

  function getAmbientNameKey(name) {
    if (name == null) return null;
    const trimmed = String(name).trim();
    return trimmed ? `name:${trimmed}` : null;
  }

  function getAmbientKeyFromElement(element) {
    if (!element) return null;
    try {
      if (element.dataset && typeof element.dataset.activeSensorKey === 'string') {
        const trimmed = element.dataset.activeSensorKey.trim();
        if (trimmed) return trimmed;
      }
    } catch (e) { /* ignore */ }
    try {
      if (typeof element.getAttribute === 'function') {
        const raw = element.getAttribute('data-active-sensor-key');
        if (raw && raw.trim().length) return raw.trim();
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  function assignAmbientKeyToElements(container, card, key) {
    const normalized = key && String(key).trim().length ? String(key).trim() : '';
    if (container) {
      if (normalized) {
        container.dataset.activeSensorKey = normalized;
      } else {
        delete container.dataset.activeSensorKey;
      }
    }
    if (card) {
      if (normalized) {
        card.dataset.activeSensorKey = normalized;
      } else {
        delete card.dataset.activeSensorKey;
      }
    }
  }

  // after building the ambient card markup, if we have a remembered humidity for
  // the first sensor, store it into the DOM element's data attribute so subsequent
  // updateAmbientDisplay can animate from that value instead of from 0%.
  function initAmbientLastHum(container) {
    try {
      const circle = container.querySelector('.wdash-ambient-circle--humidity .wdash-ambient-fill');
      if (!circle) return;
      const card = container.closest('.wdash-card--ambient');
      const scope = card || container;
      const containerKey = getAmbientKeyFromElement(container) || getAmbientKeyFromElement(card);
      const headerName = scope.querySelector('.wdash-ambient-name')?.textContent || '';
      const headerKey = getAmbientNameKey(headerName);
      let last = null;
      if (containerKey && ambientLastHumidity.has(containerKey)) {
        last = ambientLastHumidity.get(containerKey);
      } else if (headerKey && ambientLastHumidity.has(headerKey)) {
        last = ambientLastHumidity.get(headerKey);
      }
      if (last == null && Number.isFinite(ambientLastDisplayedHumidity.value)) {
        last = ambientLastDisplayedHumidity.value;
      }
      if (last != null) {
        const r = AMBIENT_RING.r;
        const circumference = Math.round(2 * Math.PI * r);
        const dash = Math.max(0, Math.min(1, last / 100)) * circumference;
        const offset = Math.round(circumference - dash);
        circle.setAttribute('stroke-dashoffset', String(offset));
        circle.dataset.lastHum = String(last);
        if (containerKey) {
          circle.dataset.sensorKey = containerKey;
        }
      }
    } catch (e) { /* ignore */ }
  }

  function buildAmbientSensorCard(data) {
    const sensors = Array.isArray(data.ambientSensors) ? data.ambientSensors.filter(Boolean) : [];
    const hasSensors = sensors.length > 0;
    const sensor = sensors[0] || {};
    const tempUnit = data.ambientTemperatureUnit || '°F';
    const humidityUnit = data.ambientHumidityUnit || '%';
    const sensorName = typeof sensor.name === 'string' ? sensor.name.trim() : '';
    const nameDisplay = hasSensors
      ? (sensorName.length ? sensorName : 'Ambient Sensor')
      : 'Ambient Sensors';
    const rotationText = hasSensors
      ? (sensors.length > 1 ? `Sensor 1 of ${sensors.length}` : '')
      : 'No sensors configured';
    const tempDisplay = formatAmbientValue(sensor.temperatureF, tempUnit, 1);
    const humidityDisplay = formatAmbientValue(sensor.humidity, humidityUnit, 0);
    const batteryLevel = toNumber(sensor.battery);
    const batteryLabel = sensorName.length ? sensorName : 'Ambient sensor';
    const batterySlot = buildBatterySlot(batteryLevel, {
      orientation: 'landscape',
      className: 'wdash-ambient-battery',
      label: batteryLabel,
      titlePrefix: `${batteryLabel} battery`
    });
    const timerDisabledAttr = sensors.length > 1 ? '' : ' disabled';
    const timerLabel = sensors.length > 1 ? 'Pause ambient sensor rotation' : 'Ambient sensor rotation unavailable';

    const sensorKey = getAmbientSensorKey(sensor, 0);
    const keyAttr = sensorKey ? ` data-active-sensor-key="${escapeHtml(sensorKey)}"` : '';

    const humidityCircumference = Math.round(2 * Math.PI * AMBIENT_RING.r);
    const cachedHumidity = lookupAmbientCachedHumidity(sensor, sensorKey, nameDisplay);
    const humidityValue = Number.isFinite(cachedHumidity) ? clamp(cachedHumidity, 0, 100) : null;
    const humidityOffset = humidityValue != null
      ? Math.round(humidityCircumference - (humidityValue / 100) * humidityCircumference)
      : humidityCircumference;
    const humidityDataAttr = humidityValue != null
      ? ` data-last-hum="${humidityValue}"`
      : ' data-last-hum=""';
    const humiditySensorAttr = sensorKey ? ` data-sensor-key="${escapeHtml(sensorKey)}"` : '';

    return `
      <section class="wdash-card wdash-card--ambient${hasSensors ? '' : ' wdash-ambient--empty'}"${keyAttr}>
        <header class="wdash-card-header wdash-card-header--ambient">
          <h3 class="wdash-ambient-name">${escapeHtml(nameDisplay)}</h3>
          <span class="wdash-ambient-rotation">${escapeHtml(rotationText)}</span>
        </header>
        <div class="wdash-ambient" data-count="${sensors.length}"${keyAttr}>
          <div class="wdash-ambient-circles">
            <div class="wdash-ambient-circle wdash-ambient-circle--temp" style="position: relative;">
                <svg class="wdash-ambient-svg wdash-ambient-svg--temp" viewBox="0 0 100 100" aria-hidden="true">
                <defs>
                  <linearGradient id="wdash-ambient-temp-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop class="wdash-svg-stop" offset="0%" stop-color="#4aa3ff" />
                      <stop class="wdash-svg-stop" offset="50%" stop-color="#6bc3ff" />
                      <stop class="wdash-svg-stop" offset="100%" stop-color="#6bc3ff" />
                  </linearGradient>
                </defs>
                <!-- inner filled background circle sized to match ring inner edge -->
                <circle class="wdash-ambient-inner-circle" cx="50" cy="50" r="${AMBIENT_RING.r - AMBIENT_RING.stroke/2 + 0.5}" fill="rgba(5,10,20,0.95)" />
                <circle class="wdash-ambient-track" cx="50" cy="50" r="${AMBIENT_RING.r}" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="${AMBIENT_RING.stroke}" stroke-linecap="butt" />
                <circle class="wdash-ambient-fill" cx="50" cy="50" r="${AMBIENT_RING.r}" fill="none" stroke="url(#wdash-ambient-temp-gradient)" stroke-width="${AMBIENT_RING.stroke}" stroke-linecap="round" stroke-dasharray="${Math.round(2*Math.PI*AMBIENT_RING.r)}" stroke-dashoffset="0" />
              </svg>
              <span class="wdash-ambient-reading wdash-ambient-reading--temp">${escapeHtml(tempDisplay)}</span>
              <span class="wdash-ambient-label">Temperature</span>
              ${batterySlot}
            </div>
            <div class="wdash-ambient-circle wdash-ambient-circle--humidity">
              <svg class="wdash-ambient-svg wdash-ambient-svg--humidity" viewBox="0 0 100 100" aria-hidden="true">
                <circle class="wdash-ambient-inner-circle" cx="50" cy="50" r="${AMBIENT_RING.r - AMBIENT_RING.stroke/2 + 0.5}" fill="rgba(5,10,20,0.95)" />
                <circle class="wdash-ambient-track" cx="50" cy="50" r="${AMBIENT_RING.r}" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="${AMBIENT_RING.stroke}" stroke-linecap="butt" />
                <circle class="wdash-ambient-fill" cx="50" cy="50" r="${AMBIENT_RING.r}" fill="none" stroke="#5b2fe6" stroke-width="${AMBIENT_RING.stroke}" stroke-linecap="round" stroke-dasharray="${humidityCircumference}"${humidityDataAttr}${humiditySensorAttr} stroke-dashoffset="${humidityOffset}" />
              </svg>
              <span class="wdash-ambient-reading wdash-ambient-reading--humidity">${escapeHtml(humidityDisplay)}</span>
              <span class="wdash-ambient-label">Humidity</span>
              <button type="button" class="wdash-ambient-timer" aria-label="${escapeHtml(timerLabel)}" aria-pressed="false"${timerDisabledAttr}>
                <svg class="wdash-ambient-timer-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <!-- Simplified sync-style icon: two curved strokes with chevrons drawn as short stroked segments -->
                  <g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <!-- top-right arc + chevron -->
                    <path d="M4.5 12a8.2 8.2 0 0114.18-4.24"></path>
                    <path d="M19.5 3v5.25H14.25"></path>
                    <!-- bottom-left arc + chevron -->
                    <path d="M19.5 12a8.2 8.2 0 01-14.18 4.24"></path>
                    <path d="M4.5 21v-5.25H9.75"></path>
                  </g>
                </svg>
                <span class="wdash-ambient-timer-countdown">--</span>
              </button>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  function buildLightningCard(data) {
    const lightning = data.lightning || {};
    const zone = (() => {
      const raw = data?.metadata?.weatherStationTimezone;
      if (!raw) return null;
      const text = String(raw).trim();
      return text.length ? text : null;
    })();

    const nowUtc = Date.now();
    const eventParts = parseHubDateTimeParts(lightning.time);
    const eventUtc = eventParts ? convertLocalPartsToUtc(eventParts, zone) : NaN;
    const daysAgo = Number.isFinite(eventUtc) ? calculateDaysAgo(nowUtc, eventUtc) : null;

    const distance = toNumber(lightning.distance);
    const count = toNumber(lightning.count);
    const battery = toNumber(lightning.battery);

    const daysAgoDisplay = Number.isFinite(daysAgo) ? String(daysAgo) : '--';
    const distanceDisplay = Number.isFinite(distance) ? `${formatNumber(distance, 1)} mi` : '--';
    const countDisplay = Number.isFinite(count) ? formatNumber(count, 0) : '--';
    const batteryIcon = renderBatteryIcon({
      level: Number.isFinite(battery) ? clamp(battery, 0, 100) : null,
      orientation: 'landscape',
      showLabel: false,
      title: Number.isFinite(battery)
        ? `Lightning sensor battery ${Math.round(clamp(battery, 0, 100))}%`
        : 'Lightning sensor battery level unavailable'
    });

    return `
      <section class="wdash-card wdash-card--lightning">
        <header class="wdash-card-header wdash-card-header--lightning">
          <h3>Lightning</h3>
          <span class="wdash-lightning-header-icon" aria-hidden="true">${renderLightningBoltIcon()}</span>
        </header>
        <div class="wdash-lightning">
          <div class="wdash-lightning-data">
            <span class="wdash-lightning-label">Days Ago</span>
            <span class="wdash-lightning-value">${escapeHtml(daysAgoDisplay)}</span>
            <span class="wdash-lightning-label">Distance</span>
            <span class="wdash-lightning-value">${escapeHtml(distanceDisplay)}</span>
            <span class="wdash-lightning-label">Count</span>
            <span class="wdash-lightning-value">${escapeHtml(countDisplay)}</span>
          </div>
          <div class="wdash-lightning-battery" aria-hidden="true">${batteryIcon}</div>
        </div>
      </section>
    `;
  }

  function buildRainCard(data) {
    const rain = data.rain || {};
    const rate = toNumber(rain.rateInPerHour);
    const hourlyIn = toNumber(rain.hourlyIn);

    // Determine the fill ratio based on 8 discrete states of hourly rainfall
    let fillRatio = 0;
    if (hourlyIn > 1.2) {
      fillRatio = 1; // State 8: > 1.2
    } else if (hourlyIn > 1.0) {
      fillRatio = 6 / 7; // State 7: > 1.0 to 1.2
    } else if (hourlyIn > 0.8) {
      fillRatio = 5 / 7; // State 6: > 0.8 to 1.0
    } else if (hourlyIn > 0.6) {
      fillRatio = 4 / 7; // State 5: > 0.6 to 0.8
    } else if (hourlyIn > 0.4) {
      fillRatio = 3 / 7; // State 4: > 0.4 to 0.6
    } else if (hourlyIn > 0.2) {
      fillRatio = 2 / 7; // State 3: > 0.2 to 0.4
    } else if (hourlyIn > 0) {
      fillRatio = 1 / 7; // State 2: > 0 to 0.2
    } // State 1: 0 (default)

    const DROP_HEIGHT = 140;
    const DROP_BOTTOM_Y = 150;
    const fillHeight = DROP_HEIGHT * fillRatio;
    const fillY = DROP_BOTTOM_Y - fillHeight;

    const rightColStats = [
      { label: 'Event', value: formatRain(rain.eventIn) },
      { label: 'Hourly', value: formatRain(rain.hourlyIn) },
      { label: 'Weekly', value: formatRain(rain.weeklyIn) },
      { label: 'Monthly', value: formatRain(rain.monthlyIn) },
      { label: 'Yearly', value: formatRain(rain.yearlyIn) }
    ];

    const rainBatterySlot = buildBatterySlot(toNumber(rain.battery), {
      orientation: 'landscape',
      className: 'wdash-rain-battery',
      label: 'Rain sensor',
      titlePrefix: 'Rain sensor battery'
    });

    return `
      <section class="wdash-card wdash-card--rain">
        <div class="wdash-rain-main">
          <div class="wdash-rain-col wdash-rain-col--drop">
            <svg viewBox="0 0 120 160" role="img" aria-label="Rain rate visualization">
              <defs>
                <clipPath id="wdash-rain-clip"><path d="M60 10 C40 45 20 75 20 105 C20 135 38 150 60 150 C82 150 100 135 100 105 C100 75 80 45 60 10 Z" /></clipPath>
                <linearGradient id="wdash-rain-gradient" x1="0" x2="0" y1="1" y2="0"><stop offset="0%" stop-color="#3d8bff" /><stop offset="100%" stop-color="#7dd3ff" /></linearGradient>
              </defs>
              <path class="wdash-rain-drop-bg" d="M60 10 C40 45 20 75 20 105 C20 135 38 150 60 150 C82 150 100 135 100 105 C100 75 80 45 60 10 Z" />
              <rect class="wdash-rain-drop-fill" x="20" y="${fillY}" width="80" height="${fillHeight}" clip-path="url(#wdash-rain-clip)" rx="35" fill="url(#wdash-rain-gradient)" />
              <path class="wdash-rain-drop-outline" d="M60 10 C40 45 20 75 20 105 C20 135 38 150 60 150 C82 150 100 135 100 105 C100 75 80 45 60 10 Z" />
            </svg>
          </div>
          <div class="wdash-rain-col wdash-rain-col--center">
            <div class="wdash-rain-rate-wrapper">
              ${buildMetricRow([
                { label: 'Rate', value: formatRain(rate) }
              ], 'wdash-rain-stats wdash-metric-row--table', {
              })}
            </div>
            <div class="wdash-rain-daily-metric">
              <div class="wdash-rain-daily-value">${formatRain(rain.dailyIn)}</div>
              <div class="wdash-rain-daily-label">Daily</div>
              ${rainBatterySlot}
            </div>
          </div>
          <div class="wdash-rain-col wdash-rain-col--stats">
            ${buildMetricRow(rightColStats, 'wdash-rain-stats', { variant: 'table' })}
          </div>
        </div>
      </section>
    `;
  }

  function buildPressureCard(data) {
    const pressure = data.pressure || {};
    const trend = pressure.trend || '--';
    const rate = toNumber(pressure.trendInHgPerHour);
    const change = toNumber(pressure.changeInTrendWindow);
    const outlook = data.outlook24h || {};
    const mode = pressureMode === 'absolute' ? 'absolute' : 'relative';
    const relative = escapeHtml(formatPressure(pressure.relativeInHg));
    const absolute = escapeHtml(formatPressure(pressure.absoluteInHg));
    const stats = [
      { label: 'Tendency', value: trend },
      { label: 'Rate', value: formatSigned(rate, 3, 'inHg/hr') },
      { label: 'Change', value: formatSigned(change, 3, 'inHg') }
    ];

    return `
      <section class="wdash-card wdash-card--pressure" data-pressure-mode="${mode}">
        ${cardHeader(CARD_TITLES.pressure, data)}
        <div class="wdash-pressure">
          <div class="wdash-pressure-main">
            <div class="wdash-pressure-toggle" role="group" aria-label="Barometer mode">
              <button type="button" class="wdash-pressure-button${mode === 'relative' ? ' is-active' : ''}" data-pressure-mode="relative" aria-pressed="${mode === 'relative'}">Relative</button>
              <button type="button" class="wdash-pressure-button${mode === 'absolute' ? ' is-active' : ''}" data-pressure-mode="absolute" aria-pressed="${mode === 'absolute'}">Absolute</button>
            </div>
            <div class="wdash-pressure-reading">
              <span class="wdash-pressure-value" data-pressure-value="relative">${relative}</span>
              <span class="wdash-pressure-value" data-pressure-value="absolute">${absolute}</span>
            </div>
          </div>
          ${buildMetricRow(stats, 'wdash-pressure-stats')}
          <div class="wdash-pressure-outlook">
            <span class="wdash-outlook-label">${outlook.category || 'Outlook'}</span>
            <span class="wdash-outlook-text">${outlook.summary || 'No forecast available.'}</span>
          </div>
        </div>
      </section>
    `;
  }

  function buildSolarSunCard(data) {
    const solar = data.solar || {};
    const sun = data.sun || {};
    const moon = sun.moon || {};
    const uvIndex = toNumber(solar.uvIndex);
    const solarRadiation = toNumber(solar.solarRadiationWm2); // Support multiple keys

    const now = parseDateTime(data.metadata?.generatedAt);
    const stationReportedAt = data.metadata?.weatherStationTime || data.metadata?.generatedAt;
    const stationLabel = stationReportedAt ? formatHubDateTime(stationReportedAt) : null;
    const stationZoneLabel = (() => {
      const zone = data.metadata?.weatherStationTimezone;
      if (!zone) return '';
      const text = typeof zone === 'string' ? zone.trim() : String(zone);
      return text;
    })();
    const sunrise = parseDateTime(sun.sunrise);
    const sunset = parseDateTime(sun.sunset);

    const progress = sunProgress(sun, now);
    const isDay = progress >= 0 && progress <= 1;
    const dayNightClass = isDay ? 'is-day' : 'is-night';

    const moonPhaseKey = normalizeMoonPhaseKey(moon) || DEFAULT_MOON_PHASE_KEY;
    const moonPhaseName = moon.phase || 'Unknown';
    const moonHemisphere = (moon.hemisphere || '').toLowerCase() === 'southern' ? 'southern' : 'northern';
    const illuminationPercent = (() => {
      const percent = toNumber(moon.illuminationPercent);
      if (Number.isFinite(percent)) return percent;
      const fraction = toNumber(moon.illuminationFraction);
      if (Number.isFinite(fraction)) return fraction * 100;
      return NaN;
    })();
    const illuminationText = Number.isFinite(illuminationPercent) ? formatPercent(illuminationPercent, 0) : '--';
    const moonAriaParts = [];
    if (moonPhaseName && moonPhaseName !== 'Unknown') moonAriaParts.push(moonPhaseName);
    if (Number.isFinite(illuminationPercent)) moonAriaParts.push(`${illuminationPercent.toFixed(0)}% illuminated`);
    const moonAriaLabel = moonAriaParts.length ? `Moon phase: ${moonAriaParts.join(', ')}` : 'Moon phase unavailable';

    const moonIconClass = `wdash-moon-icon${moonHemisphere === 'southern' ? ' is-southern' : ''}`;

    // Unified geometry for the arc and sun path, all within the SVG's viewBox
    // A 150-degree arc (210 to 330) with padding so the sun marker doesn't clip.
    const arc = { cx: 100, cy: 100, r: 85, startAngle: 210, endAngle: 330 };
    const startPoint = getPointOnArc(arc, 0);
    const endPoint = getPointOnArc(arc, 1);
    const arcPath = `M ${startPoint.x} ${startPoint.y} A ${arc.r} ${arc.r} 0 0 1 ${endPoint.x} ${endPoint.y}`;

    // Calculate sun's position using the same geometry and apply it as an SVG transform
    const sunPoint = getPointOnArc(arc, progress);
    const sunTransform = `translate(${sunPoint.x}, ${sunPoint.y})`;

    // --- Metric Positioning ---
    // UV Index (upper left)
    const uvStyle = `left: ${35 / 2}%; top: ${28}%;`;
    // Solar (center)
    const solarStyle = `left: ${100 / 2}%; top: ${45}%;`;
    // Moon phase (upper right)
    const moonStyle = `left: ${165 / 2}%; top: ${28}%;`;

    // --- Time Label Positioning ---
    const sunriseStyle = `left: ${startPoint.x / 2}%; top: ${startPoint.y}%`;
    const sunsetStyle = `left: ${endPoint.x / 2}%; top: ${endPoint.y}%`;

    return `
      <section class="wdash-card wdash-card--solar">
        ${cardHeader(
          CARD_TITLES.sunMoon,
          data,
          stationLabel,
          {
            fallbackToRelative: false,
            clock: {
              mode: 'datetime',
              source: stationReportedAt,
              timezoneLabel: stationZoneLabel
            }
          }
        )}
        <div class="wdash-solar">
          <div class="wdash-sun-graphic">
            <svg class="wdash-sun-svg" viewBox="0 0 200 100">
              <defs>
                <linearGradient id="wdash-sun-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stop-color="#ffd45a" />
                  <stop offset="100%" stop-color="#ff9445" />
                </linearGradient>
              </defs>
              <path class="wdash-sun-arc" d="${arcPath}" />
              <g class="wdash-sun-marker ${dayNightClass}" transform="${sunTransform}">
                <circle r="8" fill="url(#wdash-sun-gradient)" />
              </g>
            </svg>
            <!-- Metric Labels (HTML) -->
            <div class="wdash-sun-html-metric" style="${uvStyle}">
              <div class="wdash-sun-metric-label">UV Index</div>
              <div class="wdash-sun-metric-value">${Number.isFinite(uvIndex) ? formatNumber(uvIndex, 1) : '--'}</div>
            </div>
            <div class="wdash-sun-html-metric" style="${solarStyle}">
              <div class="wdash-sun-metric-label">Solar</div>
              <div class="wdash-sun-metric-value">${Number.isFinite(solarRadiation) ? formatNumber(solarRadiation, 0) : '--'} <span class="wdash-sun-metric-unit">W/m²</span></div>
            </div>
            <div class="wdash-sun-html-metric wdash-sun-html-metric--moon" style="${moonStyle}">
              <div class="${moonIconClass}" data-phase="${moonPhaseKey}" role="img" aria-label="${escapeHtml(moonAriaLabel)}"></div>
              <div class="wdash-moon-label">
                <div class="wdash-moon-phase-name">${escapeHtml(moonPhaseName)}</div>
                <div class="wdash-moon-illumination">${illuminationText}</div>
              </div>
            </div>
            <!-- Time Labels (HTML) -->
            <div class="wdash-sun-time wdash-sun-time--rise" style="${sunriseStyle}">
              <span class="wdash-value">${formatTime(sun.sunrise)}</span>
            </div>
            <div class="wdash-sun-time wdash-sun-time--set" style="${sunsetStyle}">
              <span class="wdash-value">${formatTime(sun.sunset)}</span>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  function buildAirQualityCard(data) {
    const sources = [];
    if (data.outdoorAirQuality) sources.push('Outdoor');
    if (data.indoorAirQuality) sources.push('Indoor');

    const currentSource = airQualityRotation.sources[airQualityRotation.index] || sources[0] || 'Outdoor';
    const airData = currentSource === 'Indoor' ? data.indoorAirQuality : data.outdoorAirQuality;

    const metrics = padAirQualityMetrics(buildAirQualityMetrics(airData, currentSource));
    const batteryLevel = toNumber(airData?.battery);
    const batteryLabel = `${currentSource} air quality sensor`;
    const batterySlot = buildBatterySlot(batteryLevel, {
      orientation: 'landscape',
      className: 'wdash-air-battery',
      label: batteryLabel,
      titlePrefix: `${batteryLabel} battery`
    });

    const headerHtml = `
      <header class="wdash-card-header wdash-card-header--air">
        <div class="wdash-card-header-main">
          <h3>${escapeHtml(CARD_TITLES.air)}</h3>
        </div>
        <div class="wdash-air-header-meta">
          <span class="wdash-air-source">${escapeHtml(currentSource)}</span>
          ${batterySlot}
        </div>
      </header>
    `;

    return `
      <section class="wdash-card wdash-card--air" data-aq-source="${currentSource.toLowerCase()}">
        ${headerHtml}
        ${buildMetricRow(metrics, 'wdash-air-metrics')}
      </section>
    `;
  }

  function buildAirQualityMetrics(air, type) {
    if (!air) return [{ label: 'AQI', value: '--' }];

    const metrics = [];
    const aqi = toNumber(air.aqi);
    const pm25 = toNumber(air.pm25);
    const aqi24h = toNumber(air.aqi_avg_24h);
    const pm25_24h = toNumber(air.pm25_avg_24h);

    if (Number.isFinite(aqi)) {
      metrics.push({ label: 'AQI', value: formatNumber(aqi, 0), color: air.aqiColor });
    }
    if (Number.isFinite(aqi24h)) {
      metrics.push({ label: 'AQI 24h AVE', value: formatNumber(aqi24h, 0), color: air.aqiColor_avg_24h });
    }
    if (Number.isFinite(pm25)) {
      metrics.push({ label: 'PM2.5', value: `${formatNumber(pm25, 1)} µg/m³` });
    }
    if (Number.isFinite(pm25_24h)) {
      metrics.push({ label: 'PM2.5 24h AVE', value: `${formatNumber(pm25_24h, 1)} µg/m³` });
    }

    if (type === 'Indoor') {
      const pm10 = toNumber(air.pm10);
      const pm10_24h = toNumber(air.pm10_avg_24h);
      const co2 = toNumber(air.carbonDioxide);
      const co2_24h = toNumber(air.carbonDioxide_avg_24h);

      if (Number.isFinite(pm10)) {
        metrics.push({ label: 'PM10', value: `${formatNumber(pm10, 1)} µg/m³` });
      }
      if (Number.isFinite(pm10_24h)) {
        metrics.push({ label: 'PM10 24h AVE', value: `${formatNumber(pm10_24h, 1)} µg/m³` });
      }
      if (Number.isFinite(co2)) {
        metrics.push({ label: 'CO₂', value: `${formatNumber(co2, 0)} ppm` });
      }
      if (Number.isFinite(co2_24h)) {
        metrics.push({ label: 'CO₂ 24h AVE', value: `${formatNumber(co2_24h, 0)} ppm` });
      }
    }

    return metrics.length > 0 ? metrics : [{ label: 'AQI', value: '--' }];
  }

  function padAirQualityMetrics(metrics, columns = 4, rows = 2) {
    const list = Array.isArray(metrics) ? metrics.slice() : [];
    const totalSlots = columns * rows;
    if (list.length >= totalSlots) return list;
    while (list.length < totalSlots) {
      list.push({ label: '', value: '', placeholder: true });
    }
    return list;
  }

  /* ---------- helpers ---------- */

  function setupInteractiveComponents(container) {
    setupPressureToggle(container);
    setupAmbientControls(container);
    setupTempWindGaugeSizing(container);
    // ensure ambient ring sizing is applied on setup
    applyAmbientRingSizing();
    // also size outdoor gauge/compass
    applyOutdoorRingSizing();
  }

  function setupHubClock(data) {
    const target = document.querySelector('#' + DISPLAY_TILE_ID + ' .wdash-updated [data-hub-clock]');
    if (!target) {
      stopHubClock();
      return;
    }

    const dataset = target.dataset || {};
    const zone = (() => {
      const raw = data?.metadata?.weatherStationTimezone || dataset.hubClockZone;
      if (!raw) return null;
      const text = String(raw).trim();
      return text.length ? text : null;
    })();
    const timezoneEl = target.parentElement?.querySelector('[data-hub-clock-timezone]') || null;
    const zoneLabel = (() => {
      if (zone) return zone;
      if (timezoneEl && timezoneEl.textContent) return timezoneEl.textContent.trim();
      return '';
    })();
    if (timezoneEl) {
      timezoneEl.textContent = zoneLabel;
    }
    const isoSource = data?.metadata?.weatherStationTime
      || data?.metadata?.generatedAt
      || dataset.hubClockSource
      || null;
    if (!isoSource) {
      target.textContent = '';
      stopHubClock();
      return;
    }

    const parts = parseIsoDateParts(isoSource);
    const fallbackLabel = (() => {
      if (parts) {
        const formatted = formatHubDateTime(parts);
        if (formatted) return formatted;
        if (parts.original) return parts.original;
      }
      return isoSource != null ? String(isoSource) : '';
    })();

    if (!parts || !parts.hasTime) {
      target.textContent = fallbackLabel;
      stopHubClock();
      return;
    }

    const baseUtcFromSource = hubClockPartsToUtc(parts);
    if (!Number.isFinite(baseUtcFromSource)) {
      target.textContent = fallbackLabel;
      stopHubClock();
      return;
    }

    const nowUtc = Date.now();
    const useLiveZoneTime = !!zone;
    const offsetMinutes = determineHubClockOffsetMinutes(
      baseUtcFromSource,
      parts,
      zone,
      useLiveZoneTime ? nowUtc : baseUtcFromSource
    );

    if (hubClockState.timer) {
      clearInterval(hubClockState.timer);
      hubClockState.timer = null;
    }

    hubClockState.target = target;
    hubClockState.mode = (dataset.hubClockMode || 'datetime').toLowerCase() === 'clock' ? 'clock' : 'datetime';
    if (target.dataset) {
      target.dataset.hubClockSource = String(isoSource);
      target.dataset.hubClockMode = hubClockState.mode;
      if (zone) {
        target.dataset.hubClockZone = zone;
      } else if ('hubClockZone' in target.dataset) {
        delete target.dataset.hubClockZone;
      }
    }
    hubClockState.baseUtc = useLiveZoneTime ? nowUtc : baseUtcFromSource;
    hubClockState.deltaUtcMs = useLiveZoneTime ? 0 : baseUtcFromSource - nowUtc;
    hubClockState.offsetMinutes = Number.isFinite(offsetMinutes) ? offsetMinutes : null;
    hubClockState.zone = zone;
    hubClockState.sourceParts = {
      year: Number(parts.year),
      month: Number(parts.month),
      day: Number(parts.day),
      hour: Number.isFinite(parts.hour) ? Number(parts.hour) : 0,
      minute: Number.isFinite(parts.minute) ? Number(parts.minute) : 0,
      second: Number.isFinite(parts.second) ? Number(parts.second) : 0,
      offsetMinutes: Number.isFinite(offsetMinutes) ? Number(offsetMinutes) : null,
      hasTime: !!parts.hasTime
    };
    hubClockState.fallbackLabel = fallbackLabel;
    hubClockState.lastText = null;

    renderHubClock(true);
    hubClockState.timer = setInterval(renderHubClock, 1000);
  }

  function stopHubClock() {
    if (hubClockState.timer) {
      clearInterval(hubClockState.timer);
      hubClockState.timer = null;
    }
    hubClockState.target = null;
    hubClockState.baseUtc = null;
    hubClockState.deltaUtcMs = null;
    hubClockState.offsetMinutes = null;
    hubClockState.zone = null;
    hubClockState.mode = 'datetime';
    hubClockState.fallbackLabel = '';
    hubClockState.lastText = null;
    hubClockState.sourceParts = null;
  }

  function renderHubClock(force = false) {
    const target = hubClockState.target;
    if (!target) return;
    if (!document.contains(target)) {
      stopHubClock();
      return;
    }

    if (!Number.isFinite(hubClockState.baseUtc)) {
      target.textContent = hubClockState.fallbackLabel || '';
      stopHubClock();
      return;
    }

    const parts = computeHubClockParts();
    if (!parts) {
      target.textContent = hubClockState.fallbackLabel || '';
      return;
    }

    const dateEl = target.querySelector('[data-hub-clock-date]');
    const timeEl = target.querySelector('[data-hub-clock-time]');
    const meridiemEl = target.querySelector('[data-hub-clock-meridiem]');
    const hasSegmentTargets = !!(dateEl || timeEl || meridiemEl);

    if (hasSegmentTargets) {
      if (hubClockState.mode === 'clock') {
        const clockText = formatHubClock(parts) || '';
        if (force || clockText !== hubClockState.lastText) {
          if (timeEl) timeEl.textContent = clockText;
          if (dateEl) dateEl.textContent = '';
          if (meridiemEl) meridiemEl.textContent = '';
          hubClockState.lastText = clockText;
        }
        return;
      }

      const dateText = formatHubDateFromParts(parts) || '';
      const segments = clockSegmentsFromParts(parts);
      if (!segments) {
        const fallbackText = formatHubDateTime(parts) || hubClockState.fallbackLabel || '';
        if (force || fallbackText !== hubClockState.lastText) {
          target.textContent = fallbackText;
          hubClockState.lastText = fallbackText;
        }
        return;
      }
      const assembled = dateText ? `${dateText}, ${segments.text}` : segments.text;
      if (force || assembled !== hubClockState.lastText) {
        if (dateEl) dateEl.textContent = dateText;
        if (timeEl) timeEl.textContent = segments.time;
        if (meridiemEl) meridiemEl.textContent = segments.meridiem;
        hubClockState.lastText = assembled;
      }
      return;
    }

    const text = hubClockState.mode === 'clock'
      ? formatHubClock(parts)
      : formatHubDateTime(parts);

    const finalText = text || hubClockState.fallbackLabel || '';
    if (force || finalText !== hubClockState.lastText) {
      target.textContent = finalText;
      hubClockState.lastText = finalText;
    }
  }

  function computeHubClockParts() {
    if (!hubClockState.sourceParts) {
      return null;
    }
    const utcMs = (() => {
      if (Number.isFinite(hubClockState.deltaUtcMs)) {
        return Date.now() + hubClockState.deltaUtcMs;
      }
      if (Number.isFinite(hubClockState.baseUtc)) {
        return hubClockState.baseUtc;
      }
      return NaN;
    })();
    if (!Number.isFinite(utcMs)) return null;

    const offsetMinutes = getHubClockOffsetMinutes(utcMs);
    const offsetMs = Number.isFinite(offsetMinutes) ? offsetMinutes * 60000 : 0;
    const date = new Date(utcMs + offsetMs);
    if (isNaN(date)) return null;

    const hasTime = !!hubClockState.sourceParts.hasTime;
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: hasTime ? date.getUTCHours() : null,
      minute: hasTime ? date.getUTCMinutes() : null,
      second: hasTime ? date.getUTCSeconds() : null,
      hasTime,
      offsetMinutes: Number.isFinite(offsetMinutes) ? offsetMinutes : null
    };
  }

  function getHubClockOffsetMinutes(utcMs) {
    if (!Number.isFinite(utcMs)) return null;
    if (hubClockState.zone) {
      const zoneOffset = computeTimeZoneOffsetMinutes(utcMs, hubClockState.zone);
      if (Number.isFinite(zoneOffset)) {
        hubClockState.offsetMinutes = zoneOffset;
        if (hubClockState.sourceParts) {
          hubClockState.sourceParts.offsetMinutes = zoneOffset;
        }
        return zoneOffset;
      }
    }
    if (Number.isFinite(hubClockState.offsetMinutes)) {
      return hubClockState.offsetMinutes;
    }
    if (hubClockState.sourceParts && Number.isFinite(hubClockState.sourceParts.offsetMinutes)) {
      return hubClockState.sourceParts.offsetMinutes;
    }
    return null;
  }

  function determineHubClockOffsetMinutes(baseUtc, parts, zone, referenceUtc) {
    if (parts && Number.isFinite(parts.offsetMinutes)) {
      return Number(parts.offsetMinutes);
    }
    if (zone) {
      const basis = Number.isFinite(referenceUtc) ? referenceUtc : baseUtc;
      const zoneOffset = computeTimeZoneOffsetMinutes(basis, zone);
      if (Number.isFinite(zoneOffset)) {
        return zoneOffset;
      }
    }
    return null;
  }

  function hubClockPartsToUtc(parts) {
    if (!parts) return NaN;
    const year = Number(parts.year);
    const month = Number(parts.month);
    const day = Number(parts.day);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
      return NaN;
    }
    const monthIndex = Math.max(0, Math.min(11, Math.floor(month) - 1));
    const dayValue = Math.max(1, Math.min(31, Math.floor(day)));
    const hour = Number.isFinite(parts.hour) ? Math.max(0, Math.min(23, Math.floor(parts.hour))) : 0;
    const minute = Number.isFinite(parts.minute) ? Math.max(0, Math.min(59, Math.floor(parts.minute))) : 0;
    const second = Number.isFinite(parts.second) ? Math.max(0, Math.min(59, Math.floor(parts.second))) : 0;
    const baseUtc = Date.UTC(year, monthIndex, dayValue, hour, minute, second, 0);
    if (!Number.isFinite(baseUtc)) return NaN;
    const offsetMinutes = Number.isFinite(parts.offsetMinutes) ? Number(parts.offsetMinutes) : 0;
    return baseUtc - offsetMinutes * 60000;
  }

  function computeTimeZoneOffsetMinutes(utcMs, zone) {
    if (!Number.isFinite(utcMs) || !zone) return null;
    if (typeof Intl === 'undefined' || typeof Intl.DateTimeFormat !== 'function') {
      return null;
    }
    try {
      const formatter = getHubClockFormatter(zone);
      if (!formatter) return null;
      const parts = formatter.formatToParts(new Date(utcMs));
      const components = {};
      for (const part of parts) {
        switch (part.type) {
          case 'year':
            components.year = Number(part.value);
            break;
          case 'month':
            components.month = Number(part.value);
            break;
          case 'day':
            components.day = Number(part.value);
            break;
          case 'hour':
            components.hour = Number(part.value);
            break;
          case 'minute':
            components.minute = Number(part.value);
            break;
          case 'second':
            components.second = Number(part.value);
            break;
          default:
            break;
        }
      }
      if (!Number.isFinite(components.year)
        || !Number.isFinite(components.month)
        || !Number.isFinite(components.day)) {
        return null;
      }
      const hour = Number.isFinite(components.hour) ? components.hour : 0;
      const minute = Number.isFinite(components.minute) ? components.minute : 0;
      const second = Number.isFinite(components.second) ? components.second : 0;
      const localizedUtc = Date.UTC(
        components.year,
        Math.max(0, Math.min(11, components.month - 1)),
        Math.max(1, Math.min(31, components.day)),
        Math.max(0, Math.min(23, hour)),
        Math.max(0, Math.min(59, minute)),
        Math.max(0, Math.min(59, second))
      );
      if (!Number.isFinite(localizedUtc)) return null;
      const rawDiffMinutes = (localizedUtc - utcMs) / 60000;
      if (!Number.isFinite(rawDiffMinutes)) return null;
      const rounded = Math.round(rawDiffMinutes);
      return Number.isFinite(rounded) ? rounded : null;
    } catch (err) {
      return null;
    }
  }

  function getHubClockFormatter(zone) {
    if (!zone) return null;
    if (hubClockFormatterCache.has(zone)) {
      return hubClockFormatterCache.get(zone);
    }
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
      });
      hubClockFormatterCache.set(zone, formatter);
      return formatter;
    } catch (err) {
      hubClockFormatterCache.set(zone, null);
      return null;
    }
  }

  // Ensure ambient SVG rings use unified sizing derived from CSS variables
  function applyAmbientRingSizing() {
    const container = document.querySelector('#' + DISPLAY_TILE_ID + ' .wdash-ambient');
    if (!container) return;

    const svgTemp = container.querySelector('.wdash-ambient-svg--temp');
    const svgHum = container.querySelector('.wdash-ambient-svg--humidity');
    const computed = getComputedStyle(container);
    const rVar = Number(computed.getPropertyValue('--ambient-ring-r')) || AMBIENT_RING.r;
    const strokeVar = Number(computed.getPropertyValue('--ambient-ring-stroke')) || AMBIENT_RING.stroke;

    // Update AMBIENT_RING to reflect CSS-driven defaults so JS math can continue to use it
    AMBIENT_RING.r = Number.isFinite(rVar) ? rVar : AMBIENT_RING.r;
    AMBIENT_RING.stroke = Number.isFinite(strokeVar) ? strokeVar : AMBIENT_RING.stroke;

    [svgTemp, svgHum].forEach(svg => {
      if (!svg) return;
      const viewBoxSize = 100; // our SVG uses 0..100
      const px = svg.clientWidth || svg.getBoundingClientRect().width || viewBoxSize;
      const scale = px / viewBoxSize;
      const r = AMBIENT_RING.r;
      const stroke = AMBIENT_RING.stroke;
      const innerR = r - stroke/2 + 0.5; // small overlap for anti-alias

      const track = svg.querySelector('.wdash-ambient-track');
      const fill = svg.querySelector('.wdash-ambient-fill');
      const inner = svg.querySelector('.wdash-ambient-inner-circle');

      applyRingSizing(svg, AMBIENT_RING);
    });
  }

  // Generic helper: update an SVG ring given a ring definition { r, stroke }
  function applyRingSizing(svg, ringDef) {
    if (!svg || !ringDef) return;
    const r = ringDef.r;
    const stroke = ringDef.stroke;
    const outer = svg.querySelector('.wdash-gauge-outer, .wdash-gauge-track');
  const fill = svg.querySelector('.wdash-ambient-fill, .wdash-gauge-fill');
  const inner = svg.querySelector('.wdash-ambient-inner-circle, .wdash-gauge-inner, .wdash-gauge-inner-edge');
  const innerFill = svg.querySelector('.wdash-gauge-inner-fill');

    // compute edge radii (band centered at r, stroke spans r-stroke/2 .. r+stroke/2)
    const outerEdge = r + stroke / 2;
    const innerEdge = r - stroke / 2;

    if (outer) {
      outer.setAttribute('r', String(outerEdge));
      // outer edge stroke is thin (1px visual) but keep attribute for potential theming
      outer.setAttribute('stroke-width', String(1));
    }
    if (fill) {
      // colored band (optional) remains centered at r
      fill.setAttribute('r', String(r));
      fill.setAttribute('stroke-width', String(stroke));
      const circumference = Math.round(2 * Math.PI * r);
      fill.setAttribute('stroke-dasharray', String(circumference));
    }
    if (inner) {
      inner.setAttribute('r', String(innerEdge));
      if (inner.classList && inner.classList.contains('wdash-gauge-inner')) {
        // dashed inner edge uses a small stroke width
        inner.setAttribute('stroke-width', String(1.4));
      }
    }
      if (innerFill) {
        innerFill.setAttribute('r', String(innerEdge));
        // keep inner fill matching the dashboard center background; attribute left for theming
        innerFill.setAttribute('fill', 'rgba(5,10,20,0.85)');
      }
  }

  // Apply sizing for outdoor gauge and wind compass SVGs
  function applyOutdoorRingSizing() {
    const container = document.querySelector('#' + DISPLAY_TILE_ID + ' .wdash-temp');
    if (!container) return;
    const gaugeSvg = container.querySelector('.wdash-gauge-svg');
    if (gaugeSvg) applyRingSizing(gaugeSvg, OUTDOOR_RING);

    // wind compass SVG(s)
    const windContainer = document.querySelector('#' + DISPLAY_TILE_ID + ' .wdash-wind');
    if (windContainer) {
      const compassSvgs = windContainer.querySelectorAll('svg.wdash-compass-svg');
      compassSvgs.forEach(svg => applyRingSizing(svg, OUTDOOR_RING));
    }
  }

  function teardownTempWindGaugeSizing() {
    if (tempWindGaugeObserver) {
      tempWindGaugeObserver.disconnect();
      tempWindGaugeObserver = null;
    }
    if (tempWindGaugeResizeHandler) {
      window.removeEventListener('resize', tempWindGaugeResizeHandler);
      tempWindGaugeResizeHandler = null;
    }
    if (tempWindGaugeRaf != null) {
      if (tempWindGaugeRafType === 'raf' && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(tempWindGaugeRaf);
      } else if (tempWindGaugeRafType === 'timeout') {
        clearTimeout(tempWindGaugeRaf);
      }
      tempWindGaugeRaf = null;
      tempWindGaugeRafType = null;
    }
  }

  function scheduleTempWindGaugeSizing(card) {
    const target = card || document.querySelector('#' + DISPLAY_TILE_ID + ' .wdash-card--temp-wind');
    if (!target) return;
    if (tempWindGaugeRaf != null) return;
    const runner = () => {
      tempWindGaugeRaf = null;
      tempWindGaugeRafType = null;
      applyTempWindGaugeSizing(target);
    };
    if (typeof requestAnimationFrame === 'function') {
      tempWindGaugeRafType = 'raf';
      tempWindGaugeRaf = requestAnimationFrame(runner);
    } else {
      tempWindGaugeRafType = 'timeout';
      tempWindGaugeRaf = setTimeout(runner, 16);
    }
  }

  function setupTempWindGaugeSizing(container) {
    teardownTempWindGaugeSizing();
    const card = container.querySelector('.wdash-card--temp-wind');
    if (!card) return;
    const main = card.querySelector('.wdash-temp-wind-main');
    if (!main) return;

    if (Number.isFinite(tempWindGaugeLastSize) && tempWindGaugeLastSize > 0) {
      card.dataset.tempWindGaugeSize = String(tempWindGaugeLastSize);
      card.style.setProperty('--temp-wind-gauge-size', `${tempWindGaugeLastSize}px`);
    } else {
      card.style.removeProperty('--temp-wind-gauge-size');
      delete card.dataset.tempWindGaugeSize;
    }

    applyTempWindGaugeSizing(card);
    scheduleTempWindGaugeSizing(card);

    if (typeof ResizeObserver === 'function') {
      tempWindGaugeObserver = new ResizeObserver(() => scheduleTempWindGaugeSizing(card));
      tempWindGaugeObserver.observe(card);
    } else {
      tempWindGaugeResizeHandler = () => scheduleTempWindGaugeSizing(card);
      window.addEventListener('resize', tempWindGaugeResizeHandler);
    }
  }

  function applyTempWindGaugeSizing(cardOverride) {
    const card = cardOverride || document.querySelector('#' + DISPLAY_TILE_ID + ' .wdash-card--temp-wind');
    if (!card) {
      tempWindGaugeLastSize = null;
      return;
    }
    const main = card.querySelector('.wdash-temp-wind-main');
    if (!main) {
      card.style.removeProperty('--temp-wind-gauge-size');
      delete card.dataset.tempWindGaugeSize;
      tempWindGaugeLastSize = null;
      return;
    }

    const header = card.querySelector('.wdash-card-header');
    const metrics = card.querySelector('.wdash-temp-wind-details');
    const cardStyle = getComputedStyle(card);
    const mainStyle = getComputedStyle(main);
    const paddingTop = parseFloat(cardStyle.paddingTop) || 0;
    const paddingBottom = parseFloat(cardStyle.paddingBottom) || 0;
    const rowGap = parseFloat(cardStyle.rowGap) || parseFloat(cardStyle.gap) || 0;
    const mainPaddingTop = parseFloat(mainStyle.paddingTop) || 0;
    const mainPaddingBottom = parseFloat(mainStyle.paddingBottom) || 0;

    let available = card.offsetHeight - paddingTop - paddingBottom;
    if (header) available -= header.offsetHeight;
    if (metrics) available -= metrics.offsetHeight;

    let gapCount = 0;
    if (header) gapCount += 1;
    if (metrics) gapCount += 1;
    if (gapCount > 0 && rowGap > 0) {
      available -= rowGap * gapCount;
    }

    available -= mainPaddingTop + mainPaddingBottom;
    if (!Number.isFinite(available)) {
      available = 0;
    }

    let gaugeSize = available;
    if (available <= 0) {
      gaugeSize = 0;
    } else if (available < 80) {
      gaugeSize = available;
    }

    const tempCol = main.querySelector('.wdash-temp');
    const windCol = main.querySelector('.wdash-wind');
    let columnWidth = 0;
    if (tempCol && tempCol.offsetWidth) {
      columnWidth = tempCol.offsetWidth;
    }
    if (windCol && windCol.offsetWidth) {
      columnWidth = columnWidth > 0 ? Math.min(columnWidth, windCol.offsetWidth) : windCol.offsetWidth;
    }
    if (columnWidth > 0 && gaugeSize > columnWidth) {
      gaugeSize = columnWidth;
    }

    if (!Number.isFinite(gaugeSize)) {
      gaugeSize = 0;
    }

    const normalized = Math.max(0, Math.round(gaugeSize * 100) / 100);
    const previous = Number(card.dataset.tempWindGaugeSize);
    tempWindGaugeLastSize = normalized;
    if (Number.isFinite(previous) && Math.abs(previous - normalized) < 0.5) return;
    card.dataset.tempWindGaugeSize = String(normalized);
    card.style.setProperty('--temp-wind-gauge-size', `${normalized}px`);
  }

  function setupPressureToggle(container) {
    const card = container.querySelector('.wdash-card--pressure');
    if (!card) return;

    const buttons = card.querySelectorAll('[data-pressure-mode]');
    buttons.forEach(button => {
      if (button.dataset.pressureListenerBound === 'true') return;
      button.addEventListener('click', handlePressureToggleClick);
      button.dataset.pressureListenerBound = 'true';
    });

    updatePressureCard(card);
  }

  function handlePressureToggleClick(event) {
    const button = event.currentTarget;
    if (!button) return;
    const mode = button.dataset.pressureMode === 'absolute' ? 'absolute' : 'relative';
    if (!mode || mode === pressureMode) return;
    pressureMode = mode;
    updatePressureCard(button.closest('.wdash-card--pressure'));
  }

  function updatePressureCard(card) {
    if (!card) return;
    card.dataset.pressureMode = pressureMode;
    const buttons = card.querySelectorAll('[data-pressure-mode]');
    buttons.forEach(button => {
      const isActive = button.dataset.pressureMode === pressureMode;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    });
  }

  function setupAmbientControls(container) {
    const button = container.querySelector('.wdash-ambient-timer');
    if (!button) return;

    if (button.dataset.ambientListenerBound !== 'true') {
      button.addEventListener('click', handleAmbientToggleClick);
      button.dataset.ambientListenerBound = 'true';
    }

    updateAmbientTimerDisplay();
  }

  function handleAmbientToggleClick() {
    if (ambientRotation.sensors.length <= 1) return;
    toggleAmbientRotationPause();
  }

  function toggleAmbientRotationPause(force) {
    const desired = typeof force === 'boolean' ? force : !ambientRotation.paused;
    if (desired === ambientRotation.paused) {
      updateAmbientTimerDisplay();
      return;
    }

    ambientRotation.paused = desired;
    if (ambientRotation.paused) {
      stopAmbientRotationTimer();
    } else if (ambientRotation.sensors.length > 1) {
      scheduleAmbientRotation();
    }

    updateAmbientTimerDisplay();
  }

  function scheduleAmbientRotation() {
    resetAmbientTimerState();

    if (ambientRotation.paused || ambientRotation.sensors.length <= 1) {
      ambientRotation.nextSwitchAt = null;
      clearAmbientCountdownTimer();
      updateAmbientTimerDisplay();
      return;
    }

    ambientRotation.nextSwitchAt = Date.now() + ambientRotation.interval;
    ambientRotation.timer = setTimeout(() => {
      ambientRotation.timer = null;
      advanceAmbientSensor();
    }, ambientRotation.interval);

    ensureAmbientCountdownTimer();
    updateAmbientTimerDisplay();
  }

  function advanceAmbientSensor() {
    if (!ambientRotation.sensors.length) {
      stopAmbientRotationTimer();
      return;
    }

    ambientRotation.index = (ambientRotation.index + 1) % ambientRotation.sensors.length;
    updateAmbientDisplay();

    if (!ambientRotation.paused && ambientRotation.sensors.length > 1) {
      scheduleAmbientRotation();
    }
  }

  function resetAmbientTimerState() {
    if (ambientRotation.timer) {
      clearTimeout(ambientRotation.timer);
      ambientRotation.timer = null;
    }
  }

  function stopAmbientRotationTimer() {
    resetAmbientTimerState();
    ambientRotation.nextSwitchAt = null;
    clearAmbientCountdownTimer();
  }

  function ensureAmbientCountdownTimer() {
    if (ambientRotation.countdownTimer) return;
    ambientRotation.countdownTimer = setInterval(() => {
      updateAmbientTimerDisplay();
    }, 250);
  }

  function clearAmbientCountdownTimer() {
    if (!ambientRotation.countdownTimer) return;
    clearInterval(ambientRotation.countdownTimer);
    ambientRotation.countdownTimer = null;
  }

  function updateAmbientTimerDisplay() {
    const button = document.querySelector('#' + DISPLAY_TILE_ID + ' .wdash-ambient-timer');
    if (!button) return;

    const disabled = ambientRotation.sensors.length <= 1;
    if (button.disabled !== disabled) {
      button.disabled = disabled;
    }

    button.classList.toggle('is-paused', ambientRotation.paused && !disabled);
    const label = ambientRotation.sensors.length > 1
      ? (ambientRotation.paused ? 'Resume ambient sensor rotation' : 'Pause ambient sensor rotation')
      : 'Ambient sensor rotation unavailable';
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', disabled ? 'false' : String(ambientRotation.paused));

    const countdownEl = button.querySelector('.wdash-ambient-timer-countdown');
    if (countdownEl) {
      if (disabled) {
        countdownEl.textContent = '--';
      } else if (ambientRotation.paused || !ambientRotation.nextSwitchAt) {
        countdownEl.textContent = '--';
      } else {
        const remainingMs = ambientRotation.nextSwitchAt - Date.now();
        const remaining = Math.max(0, Math.ceil(remainingMs / 1000));
        countdownEl.textContent = String(remaining);
      }
    }
  }

  function setupAmbientRotation(data) {
    const container = document.querySelector('#' + DISPLAY_TILE_ID + ' .wdash-ambient');
    if (!container) return;

    const sensors = Array.isArray(data?.ambientSensors) ? data.ambientSensors.filter(Boolean) : [];
    ambientRotation.sensors = sensors;
    ambientRotation.tempUnit = data?.ambientTemperatureUnit || '°F';
    ambientRotation.chunkCount = data?.metadata?.chunkCount || 1;
    ambientRotation.humidityUnit = data?.ambientHumidityUnit || '%';
    ambientRotation.interval = AMBIENT_ROTATION_INTERVAL_MS;

    if (ambientRotation.index >= ambientRotation.sensors.length) {
      ambientRotation.index = ambientRotation.sensors.length ? ambientRotation.sensors.length - 1 : 0;
    }

    updateAmbientDisplay();

    if (ambientRotation.sensors.length <= 1) {
      ambientRotation.index = 0;
      stopAmbientRotationTimer();
    } else if (ambientRotation.paused) {
      stopAmbientRotationTimer();
    } else if (!ambientRotation.timer) {
      scheduleAmbientRotation();
    }

    updateAmbientTimerDisplay();
  }

  function clearAmbientRotation() {
    stopAmbientRotationTimer();
    clearAirQualityRotation();
    ambientRotation.sensors = [];
    ambientRotation.index = 0;
    ambientRotation.paused = false;
  }

  function updateAmbientDisplay() {
    const container = document.querySelector('#' + DISPLAY_TILE_ID + ' .wdash-ambient');
    if (!container) return;

    // If the ambient index changed since last init, (re)initialize the
    // humidity circle from remembered values so the transition starts from the
    // current visual state rather than empty.
    try {
      if (ambientLastInitIndex !== ambientRotation.index) {
        initAmbientLastHum(container);
        ambientLastInitIndex = ambientRotation.index;
      }
    } catch (e) { /* ignore */ }

    // keep SVG ring sizing in sync with container scale
    applyAmbientRingSizing();
    applyOutdoorRingSizing();

    const sensor = ambientRotation.sensors[ambientRotation.index];
    const card = container.closest('.wdash-card--ambient');
    const scope = card || container;
    const sensorKey = getAmbientSensorKey(sensor, ambientRotation.index);
    assignAmbientKeyToElements(container, card, sensorKey);

    const tempEl = container.querySelector('.wdash-ambient-reading--temp');
    const humidityEl = container.querySelector('.wdash-ambient-reading--humidity');
    const nameEl = scope.querySelector('.wdash-ambient-name');
    const rotationEl = scope.querySelector('.wdash-ambient-rotation');
    const batteryEl = container.querySelector('.wdash-ambient-battery');

    if (!sensor) {
      if (tempEl) tempEl.textContent = formatAmbientValue(null, ambientRotation.tempUnit, 1);
      if (humidityEl) humidityEl.textContent = formatAmbientValue(null, ambientRotation.humidityUnit, 0);
      if (nameEl) nameEl.textContent = 'No sensors configured';
      if (rotationEl) rotationEl.textContent = '';
      container.classList.add('wdash-ambient--empty');
      if (card) card.classList.add('wdash-ambient--empty');
      if (batteryEl) {
        updateBatterySlot(batteryEl, null, {
          orientation: 'landscape',
          label: 'Ambient sensor',
          titlePrefix: 'Ambient sensor battery'
        });
      }
      assignAmbientKeyToElements(container, card, null);
      return;
    }

    container.classList.remove('wdash-ambient--empty');
    if (card) card.classList.remove('wdash-ambient--empty');
    const sensorName = sensor && typeof sensor.name === 'string' ? sensor.name.trim() : '';
    if (tempEl) tempEl.textContent = formatAmbientValue(sensor.temperatureF, ambientRotation.tempUnit, 1);
    if (humidityEl) humidityEl.textContent = formatAmbientValue(sensor.humidity, ambientRotation.humidityUnit, 0);
    if (nameEl) nameEl.textContent = sensor.name || 'Sensor';
    if (rotationEl) {
      rotationEl.textContent = ambientRotation.sensors.length > 1
        ? `Sensor ${ambientRotation.index + 1} of ${ambientRotation.sensors.length}`
        : '';
    }
    if (batteryEl) {
      updateBatterySlot(batteryEl, sensor ? sensor.battery : null, {
        orientation: 'landscape',
        label: sensorName || 'Ambient sensor',
        titlePrefix: sensorName ? `${sensorName} battery` : 'Ambient sensor battery'
      });
    }

    updateAmbientTimerDisplay();

    // Draw rings for temperature and humidity using inline SVG for better compatibility
    try {
      const tempFill = container.querySelector('.wdash-ambient-circle--temp .wdash-ambient-svg .wdash-ambient-fill');
      const tempTrack = container.querySelector('.wdash-ambient-circle--temp .wdash-ambient-svg .wdash-ambient-track');
      const humFill = container.querySelector('.wdash-ambient-circle--humidity .wdash-ambient-svg .wdash-ambient-fill');
      const humTrack = container.querySelector('.wdash-ambient-circle--humidity .wdash-ambient-svg .wdash-ambient-track');

      // Temperature: set stroke color to a blended mid color from the temperature band
      if (tempFill && tempTrack) {
        const t = toNumber(sensor.temperatureF);
        const tempColors = colorForTemp(t);
        const mid = tempColors.mid || mixColors(tempColors.colors[0], tempColors.colors[1], 0.5);
        // If the temp fill uses a gradient, attempt to update its stops; otherwise fall back to mid color
        const svg = tempFill.ownerSVGElement;
        if (svg) {
    const grad = svg.querySelector('#wdash-ambient-temp-gradient') || svg.querySelector('linearGradient');
          if (grad) {
            const stops = grad.querySelectorAll('stop');
            if (stops[0]) stops[0].setAttribute('stop-color', tempColors.colors[0]);
            if (stops[1]) stops[1].setAttribute('stop-color', tempColors.mid);
            if (stops[2]) stops[2].setAttribute('stop-color', tempColors.colors[1]);
          } else {
            tempFill.setAttribute('stroke', tempColors.mid);
          }
        } else {
          tempFill.setAttribute('stroke', tempColors.mid);
        }
        tempTrack.setAttribute('stroke', 'rgba(255,255,255,0.06)');
        // prepare for potential arc animation by ensuring stroke-dasharray covers full circumference
        try {
          const r = AMBIENT_RING.r;
          const circumference = Math.round(2 * Math.PI * r);
          tempFill.setAttribute('stroke-dasharray', String(circumference));
          // default to fully drawn (no offset) — we may animate this in future edits
          tempFill.setAttribute('stroke-dashoffset', '0');
          tempFill.setAttribute('stroke-linecap', 'round');
        } catch (e) {/* ignore */}
      }

      // Humidity: use stroke-dashoffset on the circle to show percentage (counter-clockwise from top)
      if (humFill && humTrack) {
        const rawHum = toNumber(sensor.humidity);
        const hum = Number.isFinite(rawHum) ? clamp(rawHum, 0, 100) : 0;
        const r = AMBIENT_RING.r;
        const circumference = Math.round(2 * Math.PI * r);
        const fillFraction = hum / 100;
        const dash = Math.max(0, Math.min(1, fillFraction)) * circumference;
        const offset = Math.round(circumference - dash);

        // Determine previous offset to animate from. Preference order:
        // 1) explicit data-last-hum on the circle (set during build or previous update)
        // 2) remembered in ambientLastHumidity map keyed by sensor id/name
        // 3) fallback to current circle stroke-dashoffset (if present)
        // 4) fallback to circumference (empty)
        let prevHum = null;
        try {
          const headerName = (scope.querySelector('.wdash-ambient-name')?.textContent || '').trim();
          if (humFill.dataset && humFill.dataset.lastHum) {
            const parsed = Number(humFill.dataset.lastHum);
            if (Number.isFinite(parsed)) {
              prevHum = parsed;
            }
          }
          if (!Number.isFinite(prevHum) && humFill.dataset && humFill.dataset.sensorKey) {
            const storedKey = humFill.dataset.sensorKey.trim();
            if (storedKey && ambientLastHumidity.has(storedKey)) {
              prevHum = ambientLastHumidity.get(storedKey);
            }
          }
          if (!Number.isFinite(prevHum) && sensorKey && ambientLastHumidity.has(sensorKey)) {
            prevHum = ambientLastHumidity.get(sensorKey);
          }
          if (!Number.isFinite(prevHum) && sensor && sensor.name != null) {
            const sensorNameKey = getAmbientNameKey(sensor.name);
            if (sensorNameKey && ambientLastHumidity.has(sensorNameKey)) {
              prevHum = ambientLastHumidity.get(sensorNameKey);
            }
          }
          if (!Number.isFinite(prevHum) && headerName) {
            const headerKey = getAmbientNameKey(headerName);
            if (headerKey && ambientLastHumidity.has(headerKey)) {
              prevHum = ambientLastHumidity.get(headerKey);
            }
          }
          if (!Number.isFinite(prevHum) && Number.isFinite(ambientLastDisplayedHumidity.value)) {
            // fallback to the last displayed humidity value (across sensors)
            prevHum = ambientLastDisplayedHumidity.value;
          }
          if (!Number.isFinite(prevHum)) {
            const existing = humFill.getAttribute('stroke-dashoffset');
            if (existing != null) {
              const cur = Number(existing);
              if (!isNaN(cur)) {
                const prevDash = Math.max(0, Math.min(circumference, cur));
                prevHum = Math.round(((circumference - prevDash) / circumference) * 100);
              }
            }
          }
        } catch (e) { /* ignore */ }

        const prevFraction = Number.isFinite(prevHum) ? clamp(prevHum / 100, 0, 1) : null;
        const prevOffset = prevFraction != null ? Math.round(circumference - (prevFraction * circumference)) : circumference;

        humFill.setAttribute('stroke-dasharray', String(circumference));
        if (String(humFill.getAttribute('stroke-dashoffset')) !== String(offset)) {
          humFill.setAttribute('stroke-dashoffset', String(prevOffset));
          if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => {
              try { humFill.setAttribute('stroke-dashoffset', String(offset)); } catch (e) { /* ignore */ }
            });
          } else {
            setTimeout(() => {
              try { humFill.setAttribute('stroke-dashoffset', String(offset)); } catch (e) { /* ignore */ }
            }, 16);
          }
        }

        // persist latest humidity for next refresh/sensor reselect
        try {
          const headerName = (scope.querySelector('.wdash-ambient-name')?.textContent || '').trim();
          const headerKey = getAmbientNameKey(headerName);
          const sensorNameKey = sensor && sensor.name != null ? getAmbientNameKey(sensor.name) : null;
          if (sensorKey) ambientLastHumidity.set(sensorKey, hum);
          if (sensorNameKey) ambientLastHumidity.set(sensorNameKey, hum);
          if (headerKey) ambientLastHumidity.set(headerKey, hum);
          if (humFill.dataset) {
            humFill.dataset.lastHum = String(hum);
            if (sensorKey) humFill.dataset.sensorKey = sensorKey;
          }
          ambientLastDisplayedHumidity.key = sensorKey || sensorNameKey || headerKey;
          ambientLastDisplayedHumidity.value = hum;
        } catch (e) { /* ignore */ }

        humFill.setAttribute('stroke', '#5b2fe6');
        humTrack.setAttribute('stroke', 'rgba(255,255,255,0.12)');
      }
    } catch (err) {
      console.warn('[WeatherDashboard] ambient ring draw failed', err);
    }
  }

  function setupAirQualityRotation(data) {
    airQualityRotation.lastData = data;
    const sources = [];
    if (data?.outdoorAirQuality) sources.push('Outdoor');
    if (data?.indoorAirQuality) sources.push('Indoor');
    airQualityRotation.sources = sources;

    if (airQualityRotation.index >= sources.length) {
      airQualityRotation.index = 0;
    }

    if (sources.length > 1 && !airQualityRotation.timer) {
      scheduleAirQualityRotation();
    } else if (sources.length <= 1) {
      clearAirQualityRotation();
    }
  }

  function scheduleAirQualityRotation() {
    if (airQualityRotation.timer) clearTimeout(airQualityRotation.timer);
    airQualityRotation.timer = setTimeout(() => {
      airQualityRotation.timer = null;
      airQualityRotation.index = (airQualityRotation.index + 1) % airQualityRotation.sources.length;
      updateAirQualityCard();
      scheduleAirQualityRotation();
    }, airQualityRotation.interval);
  }

  function clearAirQualityRotation() {
    if (airQualityRotation.timer) {
      clearTimeout(airQualityRotation.timer);
      airQualityRotation.timer = null;
    }
    airQualityRotation.sources = [];
    airQualityRotation.index = 0;
  }

  function updateAirQualityCard() {
    const card = document.querySelector('#' + DISPLAY_TILE_ID + ' .wdash-card--air');
    if (!card || !airQualityRotation.lastData) return;

    const newMarkup = buildAirQualityCard(airQualityRotation.lastData);
    card.outerHTML = newMarkup;
  }

  function cardHeader(title, data, subLabel = null, options = {}) {
    const {
      fallbackToRelative = true,
      clock = null,
      headerClass = '',
      leading = '',
      subtitle = null,
      useSubLabelInUpdated = true
    } = options || {};
    const generatedAt = data?.metadata?.generatedAt;
    const relative = generatedAt ? formatRelativeTime(generatedAt) : null;
    let label = '';
    if (useSubLabelInUpdated !== false && subLabel != null) {
      const raw = typeof subLabel === 'string' ? subLabel : String(subLabel);
      if (raw && raw.trim().length) {
        label = raw.trim();
      }
    }
    if (!label && fallbackToRelative && relative) {
      label = `Updated ${relative}`;
    }
    const spanAttributes = [];
    let timezoneLabel = '';
    if (clock && clock !== false) {
      spanAttributes.push('data-hub-clock="true"');
      const mode = clock.mode ? String(clock.mode).toLowerCase() : '';
      if (mode) spanAttributes.push(`data-hub-clock-mode="${escapeHtml(mode)}"`);
      if (clock.source) spanAttributes.push(`data-hub-clock-source="${escapeHtml(clock.source)}"`);
      if (clock.timezoneLabel != null) {
        const tz = typeof clock.timezoneLabel === 'string' ? clock.timezoneLabel : String(clock.timezoneLabel);
        if (tz && tz.trim().length) {
          timezoneLabel = tz.trim();
        }
      }
    }
    const attrText = spanAttributes.length ? ' ' + spanAttributes.join(' ') : '';
    let primaryLineHtml = `<span class="wdash-updated-line wdash-updated-line--primary"${attrText}>${escapeHtml(label)}</span>`;
    if (clock && clock !== false) {
      const candidateSources = [];
      if (clock.source) candidateSources.push(clock.source);
      if (data?.metadata?.weatherStationTime) candidateSources.push(data.metadata.weatherStationTime);
      if (data?.metadata?.generatedAt) candidateSources.push(data.metadata.generatedAt);
      let parsedSource = null;
      for (const source of candidateSources) {
        const parsed = parseIsoDateParts(source);
        if (parsed && parsed.hasTime) {
          parsedSource = parsed;
          break;
        }
      }
      if (parsedSource) {
        const dateText = formatHubDateFromParts(parsedSource);
        const clockSegments = clockSegmentsFromParts(parsedSource);
        if (dateText && clockSegments) {
          primaryLineHtml = [
            `<span class="wdash-updated-line wdash-updated-line--primary"${attrText}>`,
            `<span class="wdash-clock-date" data-hub-clock-date="true">${escapeHtml(dateText)}</span>, `,
            `<span class="wdash-clock-time" data-hub-clock-time="true">${escapeHtml(clockSegments.time)}</span> `,
            `<span class="wdash-clock-meridiem" data-hub-clock-meridiem="true">${escapeHtml(clockSegments.meridiem)}</span>`,
            `</span>`
          ].join('');
        }
      }
    }
    const updatedLines = [primaryLineHtml];
    if (timezoneLabel) {
      updatedLines.push(`<span class="wdash-updated-line wdash-updated-line--secondary" data-hub-clock-timezone="true">${escapeHtml(timezoneLabel)}</span>`);
    }
    const headerClasses = ['wdash-card-header', headerClass].filter(Boolean).join(' ');
    const leadingContent = typeof leading === 'string' ? leading : (leading != null ? String(leading) : '');
    const leadingMarkup = leadingContent.trim();
    const subtitleText = subtitle != null ? String(subtitle).trim() : '';
    const hasStructuredLayout = (leadingMarkup.length > 0) || subtitleText.length > 0;

    if (!hasStructuredLayout) {
      return `
        <header class="${headerClasses}">
          <h3>${escapeHtml(title)}</h3>
          <span class="wdash-updated">${updatedLines.join('')}</span>
        </header>
      `;
    }

    const leadingHtml = leadingMarkup.length > 0
      ? `<span class="wdash-card-header-leading">${leadingMarkup}</span>`
      : '';
    const subtitleHtml = subtitleText
      ? `<span class="wdash-card-subtitle">${escapeHtml(subtitleText)}</span>`
      : '';

    return `
      <header class="${headerClasses}">
        ${leadingHtml}
        <div class="wdash-card-header-main">
          <h3>${escapeHtml(title)}</h3>
          ${subtitleHtml}
        </div>
        <span class="wdash-updated">${updatedLines.join('')}</span>
      </header>
    `;
  }

  function windCompassSvg(directionDegrees, averageDegrees) {
    const dir = Number.isFinite(directionDegrees) ? ((directionDegrees % 360) + 360) % 360 : 0;
    const avg = Number.isFinite(averageDegrees) ? ((averageDegrees % 360) + 360) % 360 : null;

    // Use same central geometry as gauges
    const cx = 50;
    const cy = 50;
    const r = OUTDOOR_RING.r;
    const stroke = OUTDOOR_RING.stroke;
    const innerR = r - stroke / 2 + 0.5;
  // Position ticks so they stay inside the ring stroke (between innerR and outer ring inner edge)
  const outerEdge = r + stroke / 2; // absolute outer edge of band
  const outerTick = r - (stroke / 4); // tick positions (inside band)
  const minorInnerTick = innerR + (r - innerR) * 0.35;
  const majorInnerTick = innerR + (r - innerR) * 0.15;

    // Build 16 ticks (every 22.5deg)
    const ticks = [];
    for (let i = 0; i < 16; i++) {
      const d = i * (360 / 16);
      const rad = (d - 90) * Math.PI / 180;
      const isMajor = d % 90 === 0;
      const inner = isMajor ? majorInnerTick : minorInnerTick;
      const x1 = cx + inner * Math.cos(rad);
      const y1 = cy + inner * Math.sin(rad);
      const x2 = cx + outerTick * Math.cos(rad);
      const y2 = cy + outerTick * Math.sin(rad);
      ticks.push(`<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" class="wdash-compass-tick${isMajor ? ' wdash-compass-tick--major' : ''}" />`);
    }

    // Only label main cardinals N E S W placed between inner and outer rings
    const cardinals = [ { label: 'N', deg: 0 }, { label: 'E', deg: 90 }, { label: 'S', deg: 180 }, { label: 'W', deg: 270 } ];
    const labelRadius = innerR + (r - innerR) * 0.5; // midway between inner and outer
    const fontSize = Math.max(8, Math.min(12, Math.floor((r - innerR) * 0.55)));
    const cardinalMarkup = cardinals.map(c => {
      const rad = (c.deg - 90) * Math.PI / 180;
      const x = cx + labelRadius * Math.cos(rad);
      const y = cy + labelRadius * Math.sin(rad);
      // center text both horizontally and vertically inside the ring
      return `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" text-anchor="middle" dominant-baseline="middle" font-size="${fontSize}" class="wdash-compass-cardinal">${c.label}</text>`;
    }).join('');

    // Compute triangle pointer geometry (isosceles with tip on innerR and base on outerTick)
    // We need delta such that base B == s/2 where B = 2*outerR*sin(delta) and s is equal side length
    function solveDelta(innerR, outerR) {
      // Solve for alpha (degrees) where base B == s/2
      const toRad = deg => deg * Math.PI / 180;
      const f = (deg) => {
        const a = toRad(deg);
        const B = 2 * outerR * Math.sin(a);
        const s = Math.sqrt(innerR*innerR + outerR*outerR - 2*innerR*outerR*Math.cos(a));
        return B - s/2;
      };
      let lo = 1; let hi = 60;
      let flo = f(lo); let fhi = f(hi);
      if (isNaN(flo) || isNaN(fhi)) return toRad(15);
      // If signs are same, expand range up to 89 degrees
      let expand = 0;
      while (flo * fhi > 0 && expand < 5) {
        hi = Math.min(89, hi * 2);
        fhi = f(hi);
        expand++;
      }
      if (flo * fhi > 0) return toRad(15);
      let bestDeg = (lo + hi)/2;
      for (let iter = 0; iter < 40; iter++) {
        const mid = (lo + hi) / 2;
        const fm = f(mid);
        if (Math.abs(fm) < 1e-4) { bestDeg = mid; break; }
        if (flo * fm <= 0) {
          hi = mid; fhi = fm;
        } else {
          lo = mid; flo = fm;
        }
        bestDeg = mid;
      }
      return toRad(bestDeg);
    }

    // Solve delta using outerEdge for pointer base so triangle spans full band depth
  const delta = solveDelta(innerR, outerEdge);
  // defensive fallback: if solver returns NaN or extremely small, use 15deg
  const safeDelta = Number.isFinite(delta) && Math.abs(delta) > 1e-6 ? delta : (15 * Math.PI / 180);
  // delta is already in radians; subtract PI/2 to rotate from up (-90deg)
  const radL = safeDelta - (Math.PI / 2);
  const radR = -safeDelta - (Math.PI / 2);
  const tipX = cx;
  const tipY = cy - innerR;
  const leftBaseX = cx + outerEdge * Math.cos(radL);
  const leftBaseY = cy + outerEdge * Math.sin(radL);
  const rightBaseX = cx + outerEdge * Math.cos(radR);
  const rightBaseY = cy + outerEdge * Math.sin(radR);
    const currentPath = `M ${tipX.toFixed(2)} ${tipY.toFixed(2)} L ${rightBaseX.toFixed(2)} ${rightBaseY.toFixed(2)} L ${leftBaseX.toFixed(2)} ${leftBaseY.toFixed(2)} Z`;
    const avgPath = currentPath;

    // Render: current (filled) then avg (hollow stroke) on top
    // Use CSS rotation (style) on the group so transitions animate the group transform and do not trigger SVG paint flashes
    return `
      <svg viewBox="0 0 100 100" class="wdash-compass-svg" role="presentation">
        <circle cx="${cx}" cy="${cy}" r="${r}" class="wdash-gauge-track" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="${stroke}" stroke-linecap="butt" />
        <circle cx="${cx}" cy="${cy}" r="${innerR}" class="wdash-gauge-inner" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="1.4" stroke-dasharray="6 8" />
        ${ticks.join('')}
        ${cardinalMarkup}
        <g class="wdash-compass-arrow wdash-compass-arrow--current" style="transform: rotate(${dir}deg);">
          <path d="${currentPath}" class="wdash-compass-current" fill="#4cc3ff" stroke="rgba(76,195,255,0.55)" stroke-width="0.8" stroke-linejoin="round" />
        </g>
  ${avg === null ? '' : `<g class="wdash-compass-arrow wdash-compass-arrow--avg" style="transform: rotate(${avg}deg);"><path d="${avgPath}" class="wdash-compass-avg" fill="none" stroke="rgba(208,213,220,0.95)" stroke-width="1.0" stroke-linejoin="round" /></g>`}
      </svg>
    `;
  }

  function buildMetricRow(items, extraClass = '', options = {}) {
    if (!Array.isArray(items) || !items.length) return '';
    const { variant, columns, layout } = options || {};
    const classes = ['wdash-metric-row', extraClass];
    if (variant) {
      classes.push(`wdash-metric-row--${variant}`);
    }
    if (layout) {
      classes.push(`wdash-metric-row--layout-${layout}`);
    }
    const className = classes.filter(Boolean).join(' ');
    const columnValue = Number.isFinite(Number(columns)) ? Number(columns) : null;
    const styleAttr = columnValue ? ` style="--wdash-columns: ${columnValue};"` : '';
    return `
      <div class="${className}"${styleAttr}>
        ${items.map(item => {
          const isPlaceholder = Boolean(item && item.placeholder);
          const tintColor = !isPlaceholder ? sanitizeHexColor(item?.color) : null;
          const baseClass = tintColor ? 'wdash-metric wdash-metric--tinted' : 'wdash-metric';
          const metricClass = isPlaceholder ? `${baseClass} wdash-metric--placeholder` : baseClass;
          const attrs = [];
          if (tintColor) attrs.push(`style="background-color: ${tintColor};"`);
          if (isPlaceholder) attrs.push('aria-hidden="true"');
          const attrString = attrs.length ? ' ' + attrs.join(' ') : '';
          const labelText = isPlaceholder ? '' : escapeHtml(item?.label || '');
          const valueText = isPlaceholder ? '' : (item?.value != null ? escapeHtml(item.value) : '--');
          const subText = !isPlaceholder && item?.sub != null ? escapeHtml(item.sub) : null;
          return `
          <div class="${metricClass}"${attrString}>
            <span class="wdash-metric-label">${labelText}</span>
            <span class="wdash-metric-value">${valueText}</span>
            ${subText ? `<span class="wdash-metric-sub">${subText}</span>` : ''}
          </div>
        `}).join('')}
      </div>
    `;
  }

  function sanitizeHexColor(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    const match = trimmed.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
    return match ? `#${match[1]}` : null;
  }

  function compileLayoutTemplates(layoutConfig) {
    const breakpoints = ['desktop', 'tablet', 'mobile'];
    const result = {};
    for (const key of breakpoints) {
      const section = layoutConfig && layoutConfig[key];
      const rows = Array.isArray(section)
        ? section
        : Array.isArray(section?.rows)
          ? section.rows
          : [];
      result[key] = compileGridTemplate(rows);
    }
    return result;
  }

  function templateHasArea(compiledTemplate, areaName) {
    if (!compiledTemplate || typeof compiledTemplate.areas !== 'string' || !areaName) {
      return false;
    }
    const tokens = compiledTemplate.areas
      .replace(/["']/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
    return tokens.includes(areaName);
  }

  function compileGridTemplate(layout) {
    if (!Array.isArray(layout)) {
      return { areas: '"."', rows: 'repeat(1, minmax(0, 1fr))', rowCount: 1 };
    }
    const areaLines = [];
    const rowTracks = [];
    let rowCount = 0;
    for (const entry of layout) {
      const repeat = Math.max(1, Number(entry?.repeat) || 1);
      const columns = Array.isArray(entry?.columns)
        ? entry.columns.filter(col => typeof col === 'string' && col.length)
        : [];
      if (!columns.length) continue;
      const track = normalizeTrackSize(entry?.height ?? entry?.rowHeight ?? entry?.size);
      for (let i = 0; i < repeat; i += 1) {
        areaLines.push(`"${columns.join(' ')}"`);
        rowTracks.push(track);
      }
      rowCount += repeat;
    }
    if (!areaLines.length) {
      return { areas: '"."', rows: 'repeat(1, minmax(0, 1fr))', rowCount: 1 };
    }
    const safeRowCount = Math.max(rowCount, 1);
    const defaultTrack = 'minmax(0, 1fr)';
    const hasCustomTrack = rowTracks.some(track => track !== defaultTrack);
    const rowsValue = hasCustomTrack
      ? rowTracks.join(' ')
      : `repeat(${safeRowCount}, ${defaultTrack})`;
    return { areas: areaLines.join('\n  '), rows: rowsValue, rowCount: safeRowCount };
  }

  function normalizeTrackSize(value) {
    const defaultTrack = 'minmax(0, 1fr)';
    if (value == null) return defaultTrack;
    if (typeof value === 'number' && Number.isFinite(value)) {
      return `${Math.max(0, value)}px`;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return defaultTrack;
      if (/^var\(\s*--[\w-]+\s*(?:,[^)]*)?\)$/i.test(trimmed)) return trimmed;
      if (/^(?:calc|minmax|clamp|fit-content)\((?:[^()]+|\([^()]*\))*\)$/i.test(trimmed)) return trimmed;
      if (/^\d*\.?\d+fr$/i.test(trimmed)) return trimmed.toLowerCase();
      if (/^\d*\.?\d+(?:px|rem|em|vh|vw|%)$/i.test(trimmed)) return trimmed.toLowerCase();
    }
    return defaultTrack;
  }

  function sanitizeColumns(value, fallback) {
    if (Array.isArray(value)) {
      const tracks = value
        .map(item => normalizeTrackSize(item))
        .filter(Boolean);
      if (tracks.length) {
        return tracks.join(' ');
      }
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length) return trimmed;
    }
    return fallback;
  }

  function sanitizeGap(value, fallback) {
    if (value == null) return fallback;
    if (typeof value === 'number' && Number.isFinite(value)) {
      return `${Math.max(0, value)}px`;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length) return trimmed;
    }
    return fallback;
  }

  function sanitizeDimension(value, fallback) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value;
    }
    if (typeof value === 'string') {
      const match = value.trim().match(/^(-?\d+(?:\.\d+)?)/);
      if (match) {
        const numeric = Number(match[1]);
        if (Number.isFinite(numeric) && numeric > 0) {
          return numeric;
        }
      }
    }
    return fallback;
  }

  function extractLayoutOverride(raw) {
    if (!raw) return null;
    if (isPlainObject(raw)) return raw;
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        if (isPlainObject(parsed)) return parsed;
      } catch (err) {
        console.warn('[WeatherDashboard] Ignored invalid layout override JSON', err);
      }
    }
    return null;
  }

  function injectCSS() {
    if (document.getElementById(CSS_ID)) return;
    const style = document.createElement('style');
    style.id = CSS_ID;
    style.textContent = `

.wdash-host .tile-title, .wdash-host .tile-primary > .title { display: none !important; }
.wdash-source-tile { opacity: 0 !important; pointer-events: none !important; }
.wdash-root { position: relative; width: 100%; height: 100%; --wdash-base-width: 1200px; --wdash-base-height: 900px; --wdash-scale: 1; --wdash-render-width: var(--wdash-base-width); --wdash-render-height: var(--wdash-base-height); background: rgba(4, 9, 20, 0.85); border-radius: 12px; overflow: hidden; box-sizing: border-box; display: flex; align-items: center; justify-content: center; }
.wdash-frame { position: relative; width: var(--wdash-render-width); height: var(--wdash-render-height); display: flex; align-items: center; justify-content: center; overflow: hidden; box-sizing: border-box; }
.wdash { width: var(--wdash-base-width); height: var(--wdash-base-height); font-family: 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif; color: #f4f6ff; background: linear-gradient(145deg, rgba(27,35,58,0.95), rgba(13,18,32,0.95)); backdrop-filter: blur(4px); border-radius: 12px; padding: 18px; box-sizing: border-box; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.05); transform-origin: top left; transform: scale(var(--wdash-scale)); }
.wdash-grid { display: grid; gap: var(--wdash-grid-gap-desktop, ${DEFAULT_GAPS.desktop}); height: 100%; width: 100%; grid-template-columns: var(--wdash-grid-columns-desktop, ${DEFAULT_COLUMNS.desktop}); grid-template-rows: var(--wdash-grid-rows-desktop, ${DEFAULT_TEMPLATES.desktop.rows}); grid-template-areas: var(--wdash-grid-areas-desktop, ${DEFAULT_TEMPLATES.desktop.areas}); }
.wdash-grid[data-empty="true"] { display: flex; align-items: center; justify-content: center; }
.wdash-grid > * { min-height: 0; }
.wdash-empty { width: 100%; text-align: center; font-size: 1.1rem; opacity: 0.7; }
.wdash-card { background: linear-gradient(145deg, rgba(27,35,58,0.92), rgba(13,18,32,0.92)); border-radius: 14px; padding: 12px; display: flex; flex-direction: column; gap: 10px; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.05); height: 100%; min-height: 0; }
.wdash-card-header { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.72rem; color: #8ea0c8; }
.wdash-card-header-main { display: flex; flex-direction: column; gap: 2px; flex: 1 1 auto; min-width: 0; }
.wdash-card-header-leading { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
.wdash-card-subtitle { font-size: 0.62rem; letter-spacing: 0.08em; color: #9badcf; }
.wdash-card-header h3 { margin: 0; font-size: 0.82rem; font-weight: 700; color: #c9d8ff; }
.wdash-card-header--ambient { width: 100%; align-items: baseline; }
.wdash-card-header--ambient .wdash-ambient-name { margin: 0; }
.wdash-card-header--ambient .wdash-ambient-rotation { margin-left: auto; text-align: right; }
.wdash-card-header--air { align-items: center; gap: 10px; }
.wdash-card-header--air .wdash-card-header-main { align-items: flex-start; }
.wdash-air-header-meta { margin-left: auto; display: inline-flex; align-items: center; gap: 8px; }
.wdash-air-source { font-size: 0.62rem; letter-spacing: 0.08em; text-transform: uppercase; color: #9badcf; }
.wdash-air-battery { display: inline-flex; align-items: center; }
.wdash-card-header--temp-wind { align-items: center; gap: 10px; }
.wdash-card-header--temp-wind .wdash-card-header-main { align-items: flex-start; text-align: left; }
.wdash-temp-wind-header-meta { margin-left: auto; display: inline-flex; align-items: center; gap: 8px; }
.wdash-temp-wind-battery { display: inline-flex; align-items: center; }
.wdash-updated { display: inline-flex; flex-direction: column; align-items: flex-end; gap: 2px; font-size: 0.68rem; opacity: 0.7; text-align: right; }
.wdash-updated-line { white-space: nowrap; line-height: 1.2; }
.wdash-updated-line--secondary { font-size: 0.62rem; opacity: 0.65; }
.wdash-clock-time { font-family: 'SFMono-Regular', 'Roboto Mono', 'Menlo', 'Courier New', monospace; font-variant-numeric: tabular-nums; letter-spacing: 0.02em; }
.wdash-card--temp-wind { grid-area: temp-wind; gap: 6px; padding-block: 5px; --temp-wind-gauge-size: 260px; }
.wdash-card--temp-wind .wdash-gauge, .wdash-card--temp-wind .wdash-wind-compass { width: min(100%, var(--temp-wind-gauge-size, 260px)); }
.wdash-card--temp-wind .wdash-metric-row--gauge { max-width: var(--temp-wind-gauge-size, 260px); }
.wdash-card--temp-wind .wdash-temp-wind-main { padding-block: 2px; }
.wdash-card--ambient { grid-area: ambient; gap: 12px; align-items: stretch; }
.wdash-card--lightning { grid-area: lightning; gap: 8px; align-items: stretch; min-width: 0; display: none; }
.wdash[data-layout-has-lightning="true"] .wdash-card--lightning { display: flex; }
.wdash-card-header--lightning { align-items: flex-start; }
.wdash-lightning-header-icon { display: flex; align-items: flex-start; justify-content: flex-end; margin-left: auto; }
.wdash-lightning-header-icon .wdash-lightning-bolt-svg { width: 30px; height: auto; transform: scaleY(1.15) rotate(10deg); transform-origin: center; filter: drop-shadow(0 4px 10px rgba(0,0,0,0.45)); }
.wdash-card--rain { grid-area: rain; }
.wdash-rain-battery { display: inline-flex; align-items: center; justify-content: center; }
.wdash-card--pressure { grid-area: pressure; }
.wdash-card--solar { grid-area: solar; }
.wdash-card--air { grid-area: air; }
.wdash-temp, .wdash-wind, .wdash-solar, .wdash-pressure { display: flex; flex-direction: column; gap: 10px; flex: 1; }
.wdash-pressure { gap: 10px; }
.wdash-temp-wind-main { display: flex; gap: 14px; flex: 1; }
.wdash-temp-wind-main > .wdash-temp, .wdash-temp-wind-main > .wdash-wind { flex: 1; }
.wdash-temp-wind-details { display: flex; justify-content: space-between; gap: 12px; }
.wdash-temp { align-items: center; }
.wdash-wind { align-items: center; }
.wdash-gauge, .wdash-wind-compass { position: relative; width: min(100%, 260px); aspect-ratio: 1 / 1; margin: 0 auto; }
  .wdash-gauge-svg { position: absolute; inset: 11%; width: calc(100% - 22%); height: calc(100% - 22%); display: block; }
.wdash-gauge-center { position: absolute; inset: 26%; border-radius: 50%; background: rgba(5,10,20,0.85); display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 12px 10px; gap: 6px; text-align: center; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.04); }
.wdash-gauge-current { display: flex; flex-direction: column; gap: 4px; align-items: center; }
.wdash-gauge-value { font-size: 2.32rem; font-weight: 800; letter-spacing: -0.02em; }
.wdash-gauge-label { font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.12em; color: #9badcf; }
.wdash-temp-extrema { display: flex; flex-direction: column; align-items: center; gap: 1px; }
.wdash-temp-extrema-label { font-size: 0.6rem; letter-spacing: 0.12em; text-transform: uppercase; color: #8ea0c8; }
.wdash-temp-extrema-value { font-size: 0.95rem; font-weight: 600; color: #dce8ff; }
.wdash-temp-extrema--high .wdash-temp-extrema-value { color: #ffb95a; }
.wdash-temp-extrema--low .wdash-temp-extrema-value { color: #7cc5ff; }
.wdash-metric-row { display: flex; flex-wrap: wrap; gap: 10px; width: 100%; }
.wdash-metric { flex: 1 1 auto; min-width: 0; background: rgba(255,255,255,0.05); border-radius: 12px; padding: 6px 8px; display: flex; flex-direction: column; gap: 2px; text-align: center; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.04); }
.wdash-metric-row--layout-fill { flex-wrap: nowrap; }
.wdash-metric-row--layout-fill .wdash-metric { flex-grow: 0; flex-shrink: 1; flex-basis: auto; }
.wdash-metric-label { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.08em; color: #8ea0c8; }
.wdash-metric-value { font-size: 0.98rem; font-weight: 600; color: #f4f6ff; white-space: nowrap; }
.wdash-metric--tinted .wdash-metric-label { color: #f4f6ff; opacity: 0.9; }
.wdash-metric-sub { font-size: 0.68rem; color: #9badcf; }
.wdash-metric-row--gauge { display: grid; grid-template-columns: repeat(var(--wdash-columns, 3), minmax(0, 1fr)); width: 100%; max-width: 260px; margin: 0 auto; gap: 4px 12px; justify-items: center; align-items: end; }
.wdash-metric-row--gauge .wdash-metric { background: transparent; box-shadow: none; padding: 0; gap: 3px; min-width: 0; align-items: center; }
.wdash-metric-row--gauge .wdash-metric-label { font-size: 0.58rem; letter-spacing: 0.1em; color: #93a5d0; white-space: nowrap; }
.wdash-metric-row--gauge .wdash-metric-value { font-size: 0.92rem; }
.wdash-metric-row--gauge .wdash-metric-sub { font-size: 0.68rem; color: #a6b5d6; }
.wdash-unit { font-size: 0.9rem; margin-left: 2px; opacity: 0.8; }
.wdash-wind-overlay { position: absolute; inset: 24% 20%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; text-align: center; pointer-events: none; text-shadow: 0 2px 8px rgba(0,0,0,0.45); }
.wdash-wind-bearing-line { display: inline-flex; align-items: baseline; gap: 4px; font-weight: 700; }
.wdash-wind-bearing { font-size: 0.78rem; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: #dbe8ff; }
.wdash-wind-speed { display: inline-flex; align-items: baseline; gap: 4px; font-weight: 700; }
.wdash-wind-speed-value { font-size: 2.1rem; color: #5bd6ff; }
.wdash-wind-heading { font-size: 0.78rem; color: #9badcf; letter-spacing: 0.08em; }
  .wdash-wind-compass svg { position: absolute; inset: 11%; width: calc(100% - 22%); height: calc(100% - 22%); display: block; filter: drop-shadow(0 8px 18px rgba(0,0,0,0.4)); }
.wdash-wind-gust { display: inline-flex; align-items: baseline; gap: 4px; font-weight: 700; }
.wdash-wind-gust-value { font-size: 0.98rem; font-weight: 600; color: #f4f6ff; }
.wdash-wind-gust-label { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.08em; color: #8ea0c8; }
.wdash-compass-inner { fill: none; stroke: rgba(255,255,255,0.1); stroke-width: 1.4; stroke-dasharray: 6 8; }
.wdash-compass-tick { stroke: rgba(255,255,255,0.2); stroke-width: 1.4; stroke-linecap: round; }
.wdash-compass-tick--major { stroke-width: 2.2; }
.wdash-compass-cardinal { fill: rgba(255,255,255,0.68); font-size: 10px; font-weight: 700; letter-spacing: 0.06em; }
.wdash-compass-arrow { transition: transform 260ms cubic-bezier(.2,.9,.2,1); -webkit-transform-box: view-box; transform-box: view-box; -webkit-transform-origin: 50% 50%; transform-origin: 50% 50%; }
.wdash-compass-arrow path { stroke-linejoin: round; stroke-linecap: round; }
.wdash-compass-arrow--current path { fill: #4cc3ff; stroke: rgba(76,195,255,0.55); stroke-width: 1.5; }
.wdash-compass-arrow--avg path { fill: none; stroke: rgba(208,213,220,0.95); stroke-width: 1.0; }
.wdash-compass-avg { pointer-events: none; }
.wdash-compass-current { pointer-events: none; }
.wdash-ambient { display: flex; flex-direction: column; gap: 14px; flex: 1; /* ambient ring defaults (viewBox units) */ --ambient-ring-r: 45; --ambient-ring-stroke: 10; }
.wdash-battery-slot { display: inline-flex; align-items: center; justify-content: center; }
.wdash-battery-slot.is-hidden { display: none !important; }
.wdash-battery { --wdash-battery-width: 18px; --wdash-battery-height: 33px; --wdash-battery-fill-color: #4bd37b; --wdash-battery-border: 2px; --wdash-battery-tip-length: 5px; display: inline-flex; align-items: center; justify-content: center; gap: 0; color: inherit; }
.wdash-battery--portrait { flex-direction: column; }
.wdash-battery--landscape { flex-direction: row; }
.wdash-battery-tip { display: block; box-sizing: border-box; background: var(--wdash-battery-fill-color, #4bd37b); border: var(--wdash-battery-border) solid var(--wdash-battery-fill-color, #4bd37b); order: 0; transition: color 0.2s ease, border-color 0.2s ease, background-color 0.2s ease; }
.wdash-battery--portrait .wdash-battery-tip { width: calc(var(--wdash-battery-width) - (var(--wdash-battery-border) * 2)); height: var(--wdash-battery-tip-length); border-bottom: 0; margin-bottom: calc(var(--wdash-battery-border) * -1); border-radius: 2px 2px 0 0; }
.wdash-battery--landscape .wdash-battery-tip { width: var(--wdash-battery-tip-length); height: calc(var(--wdash-battery-width) - (var(--wdash-battery-border) * 2)); border-left: 0; margin-left: calc(var(--wdash-battery-border) * -1); border-radius: 0 2px 2px 0; order: 2; }
.wdash-battery-body { position: relative; width: var(--wdash-battery-width); height: var(--wdash-battery-height); border: var(--wdash-battery-border) solid var(--wdash-battery-fill-color, #4bd37b); border-radius: 6px; padding: 3px; box-sizing: border-box; display: flex; flex-direction: column; justify-content: space-between; gap: 2px; background: rgba(8,12,24,0.85); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.04); order: 1; transition: border-color 0.2s ease, box-shadow 0.2s ease; }
.wdash-battery--landscape .wdash-battery-body { width: var(--wdash-battery-height); height: var(--wdash-battery-width); flex-direction: row; }
.wdash-battery-segment { position: relative; flex: 1; border-radius: 2px; background: rgba(255,255,255,0.08); overflow: hidden; }
.wdash-battery--portrait .wdash-battery-segment::after { content: ''; position: absolute; left: 1px; right: 1px; bottom: 1px; height: var(--wdash-battery-segment-fill, 0%); border-radius: 1.5px; background: var(--wdash-battery-fill-color, #4bd37b); transition: height 220ms ease; }
.wdash-battery--landscape .wdash-battery-segment::after { content: ''; position: absolute; top: 1px; bottom: 1px; right: 1px; left: auto; width: var(--wdash-battery-segment-fill, 0%); border-radius: 1.5px; background: var(--wdash-battery-fill-color, #4bd37b); transition: width 220ms ease; }
.wdash-battery-percent { font-size: 0.7rem; font-weight: 600; letter-spacing: 0.06em; order: 3; margin-top: 4px; }
.wdash-battery--landscape .wdash-battery-percent { margin-top: 0; margin-left: 6px; }
.wdash-battery--with-label { gap: 4px; }
.wdash-battery--critical { --wdash-battery-fill-color: #ff6b63; }
.wdash-battery--unknown { --wdash-battery-fill-color: #8ea0c8; }
.wdash-lightning { display: flex; flex-direction: column; align-items: center; justify-content: center; flex: 1; min-height: 0; gap: 16px; padding: 4px 6px 10px; }
.wdash-lightning-data { display: grid; grid-template-columns: max-content max-content; gap: 10px 20px; justify-content: center; align-items: center; }
.wdash-lightning-label { font-size: 0.72rem; letter-spacing: 0.08em; color: #8ea0c8; text-transform: uppercase; text-align: right; justify-self: end; }
.wdash-lightning-value { font-size: 1.05rem; font-weight: 600; color: #f4f6ff; white-space: nowrap; text-align: left; justify-self: start; text-transform: none; }
.wdash-lightning-battery { display: flex; justify-content: center; width: 100%; }
.wdash-ambient-circles { display: flex; gap: 12px; justify-content: center; }
.wdash-ambient-circle { flex: 0 0 130px; width: 130px; aspect-ratio: 1; border-radius: 50%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; color: #fff; font-weight: 600; box-shadow: 0 10px 22px rgba(4,9,20,0.4); text-align: center; padding: 12px; position: relative; background: transparent; }
.wdash-ambient-svg { position: absolute; inset: 4px; width: calc(100% - 8px); height: calc(100% - 8px); z-index: 1; pointer-events: none; }
.wdash-ambient-svg .wdash-ambient-track { transition: none; }
.wdash-ambient-svg .wdash-ambient-fill { transition: stroke-dashoffset 260ms cubic-bezier(.2,.9,.2,1); transform-origin: 50% 50%; transform: rotate(-90deg); }
.wdash-svg-stop { transition: none; }
.wdash-ambient-svg .wdash-ambient-inner-circle { transition: none; }
.wdash-gauge-svg circle, .wdash-wind-compass svg circle, .wdash-wind-compass svg stop { transition: none !important; }
.wdash-wind-compass svg path, .wdash-wind-compass svg line { transition: none !important; }
.wdash-ambient-circle > .wdash-ambient-reading,
.wdash-ambient-circle > .wdash-ambient-reading + .wdash-ambient-label,
.wdash-ambient-circle > .wdash-ambient-reading,
.wdash-ambient-circle > .wdash-ambient-label { position: relative; z-index: 2; }
.wdash-ambient-reading { font-size: 1.8rem; font-weight: 700; }
.wdash-ambient-label { font-size: 0.64rem; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.8; }
.wdash-ambient-circle--temp { background: transparent; }
.wdash-ambient-circle--humidity { background: transparent; }
.wdash-ambient-circle--temp .wdash-ambient-battery { position: absolute; top: calc(92px + 20px); left: -36px; transform: translateY(-50%); }
.wdash-ambient-timer { --wdash-timer-color: #29d88b; position: absolute; top: 92px; right: -36px; width: 40px; height: 40px; border: none; padding: 0; border-radius: 50%; background: transparent; color: var(--wdash-timer-color); display: grid; place-items: center; cursor: pointer; filter: drop-shadow(0 8px 16px rgba(0,0,0,0.45)); transition: transform 0.2s ease, filter 0.2s ease, color 0.2s ease; }
.wdash-ambient-timer:hover:not(:disabled) { transform: translateY(-1px); filter: drop-shadow(0 16px 26px rgba(0,0,0,0.55)); }
.wdash-ambient-timer:active:not(:disabled) { transform: translateY(1px); filter: drop-shadow(0 10px 18px rgba(0,0,0,0.45)); }
.wdash-ambient-timer.is-paused { --wdash-timer-color: #ff6b63; }
.wdash-ambient-timer:disabled { cursor: not-allowed; opacity: 0.55; filter: drop-shadow(0 8px 16px rgba(0,0,0,0.35)); }
.wdash-ambient-timer-icon { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.wdash-ambient-timer-countdown { position: relative; z-index: 1; font-size: 0.76rem; font-weight: 700; letter-spacing: 0.02em; color: #f5f9ff; text-shadow: 0 2px 6px rgba(0,0,0,0.5); }
.wdash-ambient-reading { font-size: 1.8rem; font-weight: 700; }
.wdash-ambient-label { font-size: 0.64rem; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.8; }
.wdash-ambient-name { font-weight: 700; }
.wdash-ambient-rotation { font-size: 0.75rem; color: #8ea0c8; }
.wdash-ambient-rotation:empty { display: none; }
.wdash-ambient--empty .wdash-ambient-reading { opacity: 0.6; }
.wdash-rain-main { display: grid; grid-template-columns: minmax(0, 0.85fr) 1fr 1fr; gap: 18px; align-items: stretch; flex: 1; }
.wdash-rain-col { min-height: 0; }
.wdash-rain-col--drop { display: flex; align-items: stretch; justify-content: center; }
.wdash-rain-col--drop svg { width: auto; height: 100%; max-width: 100%; max-height: 100%; display: block; filter: drop-shadow(0 6px 12px rgba(0,0,0,0.3)); }
.wdash-rain-drop-outline { fill: none; stroke: #6ab9ff; stroke-width: 4; stroke-linejoin: round; }
.wdash-rain-drop-bg { fill: rgba(80,160,255,0.15); }
.wdash-rain-drop-fill { transition: all 0.4s ease-in-out; }
.wdash-rain-col--center { display: flex; flex-direction: column; justify-content: space-between; height: 100%; text-align: center; }
.wdash-rain-rate-wrapper { width: 75%; margin: 0 auto; }
.wdash-rain-daily-metric { flex-grow: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; }
.wdash-rain-daily-value { font-size: 2.8rem; font-weight: 800; line-height: 1; }
.wdash-rain-daily-label { font-size: 0.9rem; font-weight: 700; color: #c9d8ff; }
.wdash-rain-daily-metric .wdash-battery-slot { margin-top: 2px; }
.wdash-rain-col--stats { align-self: start; }
.wdash-rain-stats.wdash-metric-row--table { display: block; width: 100%; }
.wdash-rain-stats.wdash-metric-row--table .wdash-metric { background: none; box-shadow: none; display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.07); }
.wdash-rain-stats.wdash-metric-row--table .wdash-metric { flex-direction: row; align-items: baseline; }
.wdash-rain-stats.wdash-metric-row--table .wdash-metric:last-child { border-bottom: none; }
.wdash-rain-stats.wdash-metric-row--table .wdash-metric-label { text-align: left; font-size: 0.9rem; font-weight: 600; color: #c9d8ff; }
.wdash-rain-stats.wdash-metric-row--table .wdash-metric-value { text-align: right; font-size: 0.9rem; font-weight: 600; color: #f4f6ff; font-variant-numeric: tabular-nums; }
.wdash-pressure-main { display: flex; flex-direction: row; align-items: center; justify-content: center; gap: 16px; }
.wdash-pressure-toggle { display: inline-flex; gap: 4px; padding: 4px; border-radius: 999px; background: rgba(255,255,255,0.05); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.04); }
.wdash-pressure-button { border: none; background: transparent; color: #9badcf; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.12em; padding: 5px 12px; border-radius: 999px; cursor: pointer; transition: all 0.2s ease; }
.wdash-pressure-button:hover { color: #f4f6ff; }
.wdash-pressure-button.is-active { background: linear-gradient(140deg, #5ab3ff, #3f8bff); color: #0d1426; box-shadow: 0 8px 16px rgba(74,150,255,0.35); }
.wdash-pressure-reading { font-size: 1.82rem; font-weight: 700; color: #e3edff; min-height: 2.2rem; display: flex; align-items: center; justify-content: center; }
.wdash-temp-wind-footer { position: relative; }
.wdash-temp-wind-footer .wdash-temp-wind-details { position: relative; z-index: 1; }
.wdash-pressure-value { display: none; }
.wdash-card--pressure[data-pressure-mode="relative"] .wdash-pressure-value[data-pressure-value="relative"],
.wdash-card--pressure[data-pressure-mode="absolute"] .wdash-pressure-value[data-pressure-value="absolute"] { display: inline-flex; }
.wdash-pressure-stats .wdash-metric-value { font-size: 0.88rem; }
.wdash-pressure-outlook { background: rgba(255,255,255,0.06); border-radius: 10px; padding: 8px 10px; font-size: 0.76rem; display: grid; gap: 4px; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.04); }
.wdash-outlook-label { font-weight: 700; color: #ffb95a; text-transform: uppercase; letter-spacing: 0.06em; font-size: 0.75rem; }
.wdash-outlook-text { line-height: 1.35; }
.wdash-solar { display: flex; flex-direction: column; gap: 6px; flex: 1; }
.wdash-sun-graphic { position: relative; width: 100%; aspect-ratio: 2.6 / 1; border-radius: 16px; background: transparent; overflow: hidden; }
.wdash-sun-arc { position: absolute; inset: 16% 12% 42%; border: 2px solid rgba(255,255,255,0.25); border-bottom: none; border-radius: 100% 100% 0 0 / 100% 100% 0 0; }
.wdash-sun-horizon { position: absolute; left: 12%; right: 12%; bottom: 42%; height: 2px; background: rgba(255,255,255,0.25); }
.wdash-sun-svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.wdash-sun-svg .wdash-sun-arc { fill: none; stroke: rgba(255,255,255,0.25); stroke-width: 2.5; vector-effect: non-scaling-stroke; }
.wdash-sun-svg .wdash-sun-marker { transition: transform 0.3s ease; will-change: transform; }
.wdash-sun-svg .wdash-sun-marker.is-night { opacity: 0; }
.wdash-sun-svg .wdash-sun-marker circle { filter: drop-shadow(0 0 8px rgba(255,200,110,0.6)); }
.wdash-sun-html-metric { position: absolute; display: flex; flex-direction: column; align-items: center; gap: 2px; transform: translate(-50%, -50%); text-align: center; }
.wdash-sun-metric-label { font-size: 0.8rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #8ea0c8; }
.wdash-sun-metric-value { font-size: 0.8rem; font-weight: 600; color: #f4f6ff; }
.wdash-sun-metric-unit { opacity: 0.8; }
.wdash-sun-html-metric--moon { gap: 6px; }
.wdash-moon-icon { width: 16px; height: 16px; border-radius: 50%; background: #050913; box-shadow: 0 0 0 4px rgba(176,183,198,0.22), inset 0 0 6px rgba(0,0,0,0.65); position: relative; display: inline-block; transform-origin: center; }
.wdash-moon-icon::after, .wdash-moon-icon::before { content: ''; position: absolute; inset: 0; border-radius: 50%; }
.wdash-moon-icon::after { background: radial-gradient(circle at 50% 40%, #f7f9ff 0%, #e4ecff 60%, #cad5ff 100%); opacity: 0; }
.wdash-moon-icon::before { background: radial-gradient(circle at 50% 60%, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.75) 65%, rgba(0,0,0,0.9) 100%); opacity: 0; }
.wdash-moon-icon[data-phase='full-moon']::after { opacity: 1; clip-path: inset(0 0 0 0 round 50%); }
.wdash-moon-icon[data-phase='new-moon']::after { opacity: 0; }
.wdash-moon-icon[data-phase='first-quarter']::after { opacity: 1; clip-path: inset(0 0 0 50% round 50%); }
.wdash-moon-icon[data-phase='last-quarter']::after { opacity: 1; clip-path: inset(0 50% 0 0 round 50%); }
.wdash-moon-icon[data-phase='waxing-crescent']::after { opacity: 1; clip-path: ellipse(35% 48% at 70% 50%); }
.wdash-moon-icon[data-phase='waning-crescent']::after { opacity: 1; clip-path: ellipse(35% 48% at 30% 50%); }
.wdash-moon-icon[data-phase='waxing-gibbous']::after { opacity: 1; clip-path: ellipse(70% 48% at 60% 50%); }
.wdash-moon-icon[data-phase='waning-gibbous']::after { opacity: 1; clip-path: ellipse(70% 48% at 40% 50%); }
.wdash-moon-icon[data-phase='waxing-gibbous']::before,
.wdash-moon-icon[data-phase='waning-gibbous']::before { opacity: 0.7; clip-path: ellipse(55% 48% at 50% 50%); }
.wdash-moon-icon[data-phase='waxing-crescent']::before,
.wdash-moon-icon[data-phase='waning-crescent']::before { opacity: 0.5; clip-path: ellipse(40% 48% at 50% 50%); }
.wdash-moon-icon.is-southern { transform: scaleX(-1); }
.wdash-moon-label { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.wdash-moon-phase-name { font-size: 0.74rem; font-weight: 600; color: #f4f6ff; white-space: nowrap; }
.wdash-moon-illumination { font-size: 0.64rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: #8ea0c8; }
.wdash-sun-time { position: absolute; font-size: 0.8rem; font-weight: 600; color: #c9d8ff; transform: translate(-50%, 8px); white-space: nowrap; }
.wdash-sun-time--rise { /* Positioned by inline style */ }
.wdash-sun-time--set { /* Positioned by inline style */ }
.wdash-air-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); grid-auto-rows: auto; gap: 6px 10px; align-content: start; }
.wdash-air-metrics .wdash-metric { flex: unset; min-height: 0; width: 100%; height: 100%; }
.wdash-air-metrics .wdash-metric-value { font-size: 1.02rem; }
.wdash-air-metrics .wdash-metric--placeholder { visibility: hidden; pointer-events: none; }
@media (max-width: 1100px) {
  .wdash-grid { gap: var(--wdash-grid-gap-tablet, ${DEFAULT_GAPS.tablet}); grid-template-columns: var(--wdash-grid-columns-tablet, ${DEFAULT_COLUMNS.tablet}); grid-template-rows: var(--wdash-grid-rows-tablet, ${DEFAULT_TEMPLATES.tablet.rows}); grid-template-areas: var(--wdash-grid-areas-tablet, ${DEFAULT_TEMPLATES.tablet.areas}); }
}
@media (max-width: 900px) {
  .wdash { padding: 14px; }
}
@media (max-width: 720px) {
  .wdash-grid { gap: var(--wdash-grid-gap-mobile, ${DEFAULT_GAPS.mobile}); grid-template-columns: var(--wdash-grid-columns-mobile, ${DEFAULT_COLUMNS.mobile}); grid-template-rows: var(--wdash-grid-rows-mobile, ${DEFAULT_TEMPLATES.mobile.rows}); grid-template-areas: var(--wdash-grid-areas-mobile, ${DEFAULT_TEMPLATES.mobile.areas}); }
  .wdash-card { padding: 10px; }
  .wdash-metric-row { flex-direction: column; }
  .wdash-metric { min-width: unset; }
  .wdash-ambient-circles { flex-direction: column; }
}

    `;
    document.head.appendChild(style);
  }

  function gaugeIndicator(temp) {
    if (!Number.isFinite(temp)) return '0deg';
    const clamped = clamp(temp, TEMP_RANGE.min, TEMP_RANGE.max);
    const pct = (clamped - TEMP_RANGE.min) / (TEMP_RANGE.max - TEMP_RANGE.min);
    return `${(pct * 360).toFixed(1)}deg`;
  }

  function colorForTemp(temp) {
    if (!Number.isFinite(temp)) {
      const fallback = ['#4aa3ff', '#6bc3ff'];
      return { colors: fallback, mid: mixColors(fallback[0], fallback[1], 0.5), progress: 0.5 };
    }

    let previousMax = TEMP_RANGE.min;
    for (const entry of TEMP_COLORS) {
      const bandMax = entry.max;
      const maxValue = Number.isFinite(bandMax) ? bandMax : TEMP_RANGE.max;
      if (temp <= bandMax) {
        const span = maxValue - previousMax || 1;
        const local = clamp((temp - previousMax) / span, 0, 1);
        const gradientPosition = 0.2 + local * 0.6;
        return {
          colors: entry.colors,
          mid: mixColors(entry.colors[0], entry.colors[1], local),
          progress: gradientPosition
        };
      }
      previousMax = bandMax;
    }

    const last = TEMP_COLORS[TEMP_COLORS.length - 1];
    const span = TEMP_RANGE.max - previousMax || 1;
    const local = clamp((temp - previousMax) / span, 0, 1);
    const gradientPosition = 0.2 + local * 0.6;
    return {
      colors: last.colors,
      mid: mixColors(last.colors[0], last.colors[1], local),
      progress: gradientPosition
    };
  }

  function formatAmbientValue(value, unit, decimals = 0) {
    const numeric = toNumber(value);
    const suffix = unit || '';
    if (Number.isFinite(numeric)) {
      return `${numeric.toFixed(decimals)}${suffix}`;
    }
    return `--${suffix}`;
  }

  function sunProgress(sun, referenceTime) {
    if (!sun) return null;
    const sunrise = parseDateTime(sun.sunrise);
    const sunset = parseDateTime(sun.sunset);
    const now = referenceTime || new Date();

    if (!sunrise || !sunset || sunset <= sunrise) return -1; // Return -1 if times are invalid

    const total = sunset.getTime() - sunrise.getTime();
    if (total <= 0) return null;
    const elapsed = now.getTime() - sunrise.getTime();
    // Return the raw progress, which can be < 0 or > 1
    return elapsed / total;
  }

  function normalizeMoonPhaseKey(moon) {
    if (!moon || typeof moon !== 'object') return null;
    if (typeof moon.phaseKey === 'string' && moon.phaseKey.trim().length) {
      return moon.phaseKey.trim().toLowerCase();
    }
    if (typeof moon.phase === 'string' && moon.phase.trim().length) {
      const normalized = moon.phase.trim().toLowerCase();
      if (MOON_PHASE_NAME_MAP[normalized]) return MOON_PHASE_NAME_MAP[normalized];
      const slug = normalized.replace(/[^a-z]+/g, '-').replace(/^-+|-+$/g, '');
      return slug || null;
    }
    return null;
  }

  function getPointOnArc(arc, progress) {
    const angleDeg = arc.startAngle + (arc.endAngle - arc.startAngle) * clamp(progress, 0, 1);
    const angleRad = angleDeg * (Math.PI / 180);
    return {
      x: arc.cx + arc.r * Math.cos(angleRad),
      y: arc.cy + arc.r * Math.sin(angleRad)
    };
  }

  function mixColors(colorA, colorB, ratio) {
    const a = parseHexColor(colorA);
    const b = parseHexColor(colorB);
    const t = clamp(Number.isFinite(ratio) ? ratio : 0.5, 0, 1);
    if (!a || !b) return colorA;
    const mixed = a.map((component, index) => Math.round(component + (b[index] - component) * t));
    return `#${mixed.map(v => v.toString(16).padStart(2, '0')).join('')}`;
  }

  function parseHexColor(value) {
    if (typeof value !== 'string') return null;
    const hex = value.trim();
    if (/^#([0-9a-f]{3})$/i.test(hex)) {
      const [, short] = /^#([0-9a-f]{3})$/i.exec(hex);
      const expanded = short.split('').map(ch => ch + ch).join('');
      return expanded.match(/.{2}/g).map(part => parseInt(part, 16));
    }
    if (/^#([0-9a-f]{6})$/i.test(hex)) {
      return hex.slice(1).match(/.{2}/g).map(part => parseInt(part, 16));
    }
    return null;
  }

  function clamp(value, min, max) {
    const v = Number(value);
    if (!Number.isFinite(v)) return min;
    return Math.min(Math.max(v, min), max);
  }

  function formatTemperature(value) {
    if (!Number.isFinite(value)) return '--°';
    return `${value.toFixed(1)}°`;
  }

  function parseDateTime(value) {
    if (!value) return null;
    const date = new Date(value);
    return isNaN(date) ? null : date;
  }

  function formatNumber(value, decimals = 0) {
    if (!Number.isFinite(value)) return '--';
    return value.toFixed(decimals);
  }

  function formatPercent(value, decimals = 0) {
    if (!Number.isFinite(value)) return '--';
    return `${value.toFixed(decimals)}%`;
  }

  function formatRain(value) {
    if (!Number.isFinite(value)) return '--';
    return `${value.toFixed(2)} in`;
  }

  function formatPressure(value) {
    if (!Number.isFinite(value)) return '--';
    return `${value.toFixed(2)} inHg`;
  }

  function formatSigned(value, decimals = 1, suffix = '') {
    if (!Number.isFinite(value)) return '--';
    const sign = value > 0 ? '+' : value < 0 ? '−' : '';
    const abs = Math.abs(value).toFixed(decimals);
    return `${sign}${abs}${suffix ? ' ' + suffix : ''}`;
  }

  function formatDegrees(value) {
    if (!Number.isFinite(value)) return '--°';
    return `${value.toFixed(0)}°`;
  }

  function buildBatterySlot(levelInput, options = {}) {
    const orientation = String(options.orientation || '').toLowerCase() === 'landscape'
      ? 'landscape'
      : 'portrait';
    const showLabel = !!options.showLabel;
    const hideWhenInvalid = options.hideWhenInvalid !== false;
    const rawLabel = options.label != null ? String(options.label) : '';
    const label = rawLabel.trim();
    const titlePrefix = options.titlePrefix != null
      ? String(options.titlePrefix).trim()
      : (label ? `${label} battery` : '');
    const className = options.className ? ` ${options.className}` : '';
    const ariaHidden = options.ariaHidden ? ' aria-hidden="true"' : '';

    const level = Number.isFinite(levelInput) ? clamp(levelInput, 0, 100) : null;
    const iconTitle = level != null && titlePrefix
      ? `${titlePrefix} ${Math.round(level)}%`
      : (titlePrefix && level == null ? `${titlePrefix}` : '');
    const iconHtml = level != null
      ? renderBatteryIcon({
          level,
          orientation,
          showLabel,
          title: iconTitle
        })
      : '';

    const classes = [
      'wdash-battery-slot',
      className,
      hideWhenInvalid && level == null ? 'is-hidden' : ''
    ].filter(Boolean).join(' ');

    const dataset = [
      `data-battery-orientation="${escapeHtml(orientation)}"`,
      `data-battery-show-label="${showLabel ? 'true' : 'false'}"`,
      `data-battery-hide-when-invalid="${hideWhenInvalid ? 'true' : 'false'}"`,
      `data-battery-level="${level != null ? level : ''}"`
    ];
    if (label) dataset.push(`data-battery-label="${escapeHtml(label)}"`);
    if (titlePrefix) dataset.push(`data-battery-title-prefix="${escapeHtml(titlePrefix)}"`);

    return `
      <div class="${classes}" ${dataset.join(' ')}${ariaHidden}>${iconHtml}</div>
    `;
  }

  function updateBatterySlot(element, levelInput, options = {}) {
    if (!element) return;
    const orientation = options.orientation
      ? (String(options.orientation).toLowerCase() === 'landscape' ? 'landscape' : 'portrait')
      : (element.dataset.batteryOrientation === 'landscape' ? 'landscape' : 'portrait');
    const showLabel = options.showLabel != null
      ? !!options.showLabel
      : element.dataset.batteryShowLabel === 'true';
    const hideWhenInvalid = options.hideWhenInvalid != null
      ? !!options.hideWhenInvalid
      : element.dataset.batteryHideWhenInvalid !== 'false';
    const rawLabel = options.label != null
      ? String(options.label)
      : (element.dataset.batteryLabel || '');
    const label = rawLabel.trim();
    const titlePrefix = options.titlePrefix != null
      ? String(options.titlePrefix).trim()
      : (element.dataset.batteryTitlePrefix || (label ? `${label} battery` : ''));

    const level = Number.isFinite(levelInput) ? clamp(levelInput, 0, 100) : null;

    element.dataset.batteryOrientation = orientation;
    element.dataset.batteryShowLabel = showLabel ? 'true' : 'false';
    element.dataset.batteryHideWhenInvalid = hideWhenInvalid ? 'true' : 'false';
    if (label) {
      element.dataset.batteryLabel = label;
    } else {
      delete element.dataset.batteryLabel;
    }
    if (titlePrefix) {
      element.dataset.batteryTitlePrefix = titlePrefix;
    } else {
      delete element.dataset.batteryTitlePrefix;
    }
    element.dataset.batteryLevel = level != null ? String(level) : '';

    if (level == null && hideWhenInvalid) {
      element.classList.add('is-hidden');
      element.innerHTML = '';
      return;
    }

    if (hideWhenInvalid) {
      element.classList.toggle('is-hidden', level == null);
    } else {
      element.classList.remove('is-hidden');
    }

    const title = titlePrefix
      ? (level != null ? `${titlePrefix} ${Math.round(level)}%` : titlePrefix)
      : '';
    const iconHtml = level != null
      ? renderBatteryIcon({
          level,
          orientation,
          showLabel,
          title
        })
      : '';
    element.innerHTML = iconHtml;
  }

  function renderBatteryIcon(options = {}) {
    const hasLevel = Object.prototype.hasOwnProperty.call(options || {}, 'level');
    const rawLevel = hasLevel ? options.level : null;
    let level = Number.isFinite(rawLevel) ? Number(rawLevel) : toNumber(rawLevel);
    level = Number.isFinite(level) ? clamp(level, 0, 100) : null;

    const orientation = options && String(options.orientation).toLowerCase() === 'landscape'
      ? 'landscape'
      : 'portrait';
    const showLabel = !!(options && options.showLabel);
    const critical = level != null && level <= 20;
    const unknown = level == null;
    const color = unknown ? '#8ea0c8' : (critical ? '#ff6b63' : '#4bd37b');
    const labelText = showLabel ? (level != null ? `${Math.round(level)}%` : '--') : '';

    const classes = [
      'wdash-battery',
      `wdash-battery--${orientation}`,
      showLabel ? 'wdash-battery--with-label' : '',
      critical ? 'wdash-battery--critical' : '',
      unknown ? 'wdash-battery--unknown' : ''
    ].filter(Boolean).join(' ');

    const segments = [];
    const segmentCount = 5;
    const indices = orientation === 'portrait'
      ? Array.from({ length: segmentCount }, (_, idx) => segmentCount - 1 - idx)
      : Array.from({ length: segmentCount }, (_, idx) => idx);
    for (const index of indices) {
      let fill = '0%';
      if (level != null) {
        const fraction = (level / 100) * segmentCount;
        const segmentFill = Math.max(0, Math.min(1, fraction - index));
        fill = `${Math.round(segmentFill * 100)}%`;
      }
      segments.push(`<span class="wdash-battery-segment" style="--wdash-battery-segment-fill:${fill};"></span>`);
    }

    const title = options && options.title ? String(options.title) : '';
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';

    return `
      <span class="${classes}" data-battery-level="${level != null ? level : ''}" style="--wdash-battery-fill-color:${color};"${titleAttr}>
        <span class="wdash-battery-tip" aria-hidden="true"></span>
        <span class="wdash-battery-body">
          ${segments.join('')}
        </span>
        ${showLabel ? `<span class="wdash-battery-percent">${escapeHtml(labelText)}</span>` : ''}
      </span>
    `;
  }

  function renderLightningBoltIcon() {
    return LIGHTNING_BOLT_ICON;
  }

  function formatTime(value) {
    if (!value) return '--';
    if (/\d{4}-\d{2}-\d{2}T/.test(value)) {
      const d = new Date(value);
      if (!isNaN(d)) {
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
    }
    return value;
  }

  function formatRelativeTime(value) {
    const date = new Date(value);
    if (isNaN(date)) return null;
    const diff = Date.now() - date.getTime();
    if (Math.abs(diff) < 60 * 1000) return 'just now';
    const minutes = Math.round(Math.abs(diff) / 60000);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} hr ago`;
    const days = Math.round(hours / 24);
    return `${days} day${days !== 1 ? 's' : ''} ago`;
  }

  function parseHubDateTimeParts(value) {
    if (value == null) return null;
    const parts = parseIsoDateParts(value);
    if (parts) return parts;

    const raw = typeof value === 'string' ? value.trim() : String(value);
    if (!raw) return null;

    const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:,\s*(\d{1,2}):(\d{2})(?:\s*([AaPp][Mm]))?)?$/);
    if (!match) return null;

    let month = Number(match[1]);
    let day = Number(match[2]);
    let year = Number(match[3]);
    const hasTime = match[4] != null;
    let hour = hasTime ? Number(match[4]) : null;
    const minuteRaw = hasTime ? Number(match[5]) : null;
    const meridiem = match[6] ? match[6].toLowerCase() : null;

    if (!Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(year)) {
      return null;
    }

    month = Math.max(1, Math.min(12, Math.floor(month)));
    day = Math.max(1, Math.min(31, Math.floor(day)));

    if (year < 100) {
      year += year >= 70 ? 1900 : 2000;
    }

    let minute = null;
    if (hasTime) {
      if (!Number.isFinite(hour) || !Number.isFinite(minuteRaw)) {
        return null;
      }
      minute = Math.max(0, Math.min(59, Math.floor(minuteRaw)));
      let normalizedHour = Math.max(0, Math.min(12, Math.floor(hour)));
      if (meridiem === 'pm' && normalizedHour < 12) {
        normalizedHour += 12;
      } else if (meridiem === 'am' && normalizedHour === 12) {
        normalizedHour = 0;
      } else if (!meridiem && normalizedHour === 12) {
        normalizedHour = 12;
      }
      hour = normalizedHour % 24;
    }

    return {
      year,
      month,
      day,
      hour: hasTime ? hour : null,
      minute,
      second: hasTime ? 0 : null,
      offsetMinutes: null,
      hasTime,
      original: raw
    };
  }

  function convertLocalPartsToUtc(parts, zone) {
    if (!parts || !Number.isFinite(parts.year) || !Number.isFinite(parts.month) || !Number.isFinite(parts.day)) {
      return NaN;
    }

    const monthIndex = Math.max(0, Math.min(11, Math.floor(parts.month) - 1));
    const day = Math.max(1, Math.min(31, Math.floor(parts.day)));
    const hour = Number.isFinite(parts.hour) ? Math.max(0, Math.min(23, Math.floor(parts.hour))) : 0;
    const minute = Number.isFinite(parts.minute) ? Math.max(0, Math.min(59, Math.floor(parts.minute))) : 0;
    const second = Number.isFinite(parts.second) ? Math.max(0, Math.min(59, Math.floor(parts.second))) : 0;

    const baseLocal = Date.UTC(parts.year, monthIndex, day, hour, minute, second);
    if (!Number.isFinite(baseLocal)) return NaN;

    if (Number.isFinite(parts.offsetMinutes)) {
      return baseLocal - Number(parts.offsetMinutes) * 60000;
    }

    if (!zone) {
      return baseLocal;
    }

    let resolved = baseLocal;
    let guess = baseLocal;
    for (let i = 0; i < 3; i++) {
      const offset = computeTimeZoneOffsetMinutes(guess, zone);
      if (!Number.isFinite(offset)) {
        break;
      }
      resolved = baseLocal - offset * 60000;
      if (Math.abs(resolved - guess) < 500) {
        guess = resolved;
        break;
      }
      guess = resolved;
    }
    return resolved;
  }

  function calculateDaysAgo(nowUtc, eventUtc) {
    if (!Number.isFinite(nowUtc) || !Number.isFinite(eventUtc)) return null;
    const diff = nowUtc - eventUtc;
    if (!Number.isFinite(diff)) return null;
    if (diff <= 0) return 0;
    return Math.floor(diff / 86400000);
  }

  function parseIsoDateParts(value) {
    if (value == null) return null;
    const raw = typeof value === 'string' ? value : String(value);
    const trimmed = raw.trim();
    if (!trimmed) return null;

    const strictMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/);
    if (strictMatch) {
      const year = Number(strictMatch[1]);
      const month = Number(strictMatch[2]);
      const day = Number(strictMatch[3]);
      const hasTime = strictMatch[4] != null;
      const hour = hasTime ? Number(strictMatch[4]) : null;
      const minute = hasTime ? Number(strictMatch[5]) : null;
      const second = hasTime && strictMatch[6] != null ? Number(strictMatch[6]) : 0;
      let offsetMinutes = null;
      const tzRaw = hasTime ? strictMatch[7] : null;
      if (tzRaw) {
        if (tzRaw === 'Z') {
          offsetMinutes = 0;
        } else {
          const cleaned = tzRaw.replace(/:/g, '');
          const sign = tzRaw.startsWith('-') ? -1 : 1;
          const tzHour = Number(cleaned.slice(1, 3));
          const tzMinute = Number(cleaned.slice(3, 5) || 0);
          if (Number.isFinite(tzHour) && Number.isFinite(tzMinute)) {
            offsetMinutes = sign * (tzHour * 60 + tzMinute);
          }
        }
      }
      return {
        year,
        month,
        day,
        hour,
        minute,
        second,
        offsetMinutes,
        hasTime,
        original: trimmed
      };
    }

    const looseMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/);
    if (!looseMatch) return null;

    const year = Number(looseMatch[1]);
    const month = Number(looseMatch[2]);
    const day = Number(looseMatch[3]);
    const hasTime = looseMatch[4] != null;
    let hour = hasTime ? Number(looseMatch[4]) : null;
    const minute = hasTime ? Number(looseMatch[5]) : null;
    const second = hasTime && looseMatch[6] != null ? Number(looseMatch[6]) : 0;
    const meridiem = looseMatch[7] ? looseMatch[7].toLowerCase() : null;

    if (hasTime) {
      if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
        return {
          year,
          month,
          day,
          hour: null,
          minute: null,
          second: null,
          offsetMinutes: null,
          hasTime: false,
          original: trimmed
        };
      }
      const normalizedHour = Math.max(0, Math.min(23, Math.floor(hour)));
      if (meridiem === 'pm' && normalizedHour < 12) {
        hour = normalizedHour + 12;
      } else if (meridiem === 'am' && normalizedHour === 12) {
        hour = 0;
      } else {
        hour = normalizedHour;
      }
    }

    return {
      year,
      month,
      day,
      hour: hasTime ? hour : null,
      minute,
      second,
      offsetMinutes: null,
      hasTime,
      original: trimmed
    };
  }

  function clockSegmentsFromParts(parts, options = {}) {
    if (!parts || !parts.hasTime) return null;
    const hour = Number(parts.hour);
    const minute = Number(parts.minute);
    const second = Number(parts.second);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
      return null;
    }
    const normalizedHour = ((Math.floor(hour) % 24) + 24) % 24;
    const normalizedMinute = Math.max(0, Math.min(59, Math.floor(minute)));
    const normalizedSecond = Number.isFinite(second) ? Math.max(0, Math.min(59, Math.floor(second))) : 0;
    const hour12 = normalizedHour % 12 === 0 ? 12 : normalizedHour % 12;
    const meridiem = normalizedHour >= 12 ? 'pm' : 'am';
    const hourStr = String(hour12).padStart(2, '0');
    const minuteStr = String(normalizedMinute).padStart(2, '0');
    const secondStr = String(normalizedSecond).padStart(2, '0');
    const includeSeconds = options && options.includeSeconds !== false;
    const time = includeSeconds
      ? `${hourStr}:${minuteStr}:${secondStr}`
      : `${hourStr}:${minuteStr}`;
    return { time, meridiem, text: `${time} ${meridiem}` };
  }

  function formatHubClock(value, options) {
    const parts = value && typeof value === 'object' && 'hour' in value
      ? value
      : parseIsoDateParts(value);
    if (!parts || !parts.hasTime) {
      return value != null ? String(value) : '';
    }
    const segments = clockSegmentsFromParts(parts, options);
    if (!segments) {
      return parts.original || (value != null ? String(value) : '');
    }
    return segments.text;
  }

  function formatHubDateFromParts(parts) {
    if (!parts || !Number.isFinite(parts.year) || !Number.isFinite(parts.month) || !Number.isFinite(parts.day)) {
      return '';
    }
    const monthIndex = Math.max(0, Math.min(11, Math.floor(parts.month) - 1));
    const day = Math.max(1, Math.min(31, Math.floor(parts.day)));
    const date = new Date(Date.UTC(parts.year, monthIndex, day));
    if (isNaN(date)) return '';
    const dayName = DAY_NAMES[date.getUTCDay()] || '';
    const monthName = MONTH_NAMES[monthIndex] || '';
    const dayStr = String(day).padStart(2, '0');
    return `${dayName}, ${monthName} ${dayStr} ${parts.year}`;
  }

  function formatHubDateTime(value) {
    const parts = value && typeof value === 'object' && ('year' in value || 'month' in value || 'day' in value)
      ? value
      : parseIsoDateParts(value);
    if (!parts) {
      return value != null ? String(value) : '';
    }
    const dateText = formatHubDateFromParts(parts);
    const timeText = parts.hasTime ? formatHubClock(parts) : '';
    if (dateText && timeText) return `${dateText}, ${timeText}`;
    if (dateText) return dateText;
    if (timeText) return timeText;
    return parts.original || (value != null ? String(value) : '');
  }

  function degreesToCardinal(deg) {
    if (!Number.isFinite(deg)) return '--';
    const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const index = Math.round(((deg % 360) / 22.5)) % dirs.length;
    return dirs[index];
  }

  function toNumber(value) {
    if (Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const match = value.match(/-?\d+(?:\.\d+)?/);
      if (match) return Number(match[0]);
    }
    return NaN;
  }

  function deepMerge(target, source) {
    const output = { ...target };
    for (const key of Object.keys(source)) {
      if (isPlainObject(source[key]) && isPlainObject(output[key])) {
        output[key] = deepMerge(output[key], source[key]);
      } else {
        output[key] = source[key];
      }
    }
    return output;
  }

  function isPlainObject(value) {
    return Object.prototype.toString.call(value) === '[object Object]';
  }

  function isChunkEnvelope(payload) {
    return normalizeChunkEnvelope(payload) != null;
  }

  function normalizeChunkEnvelope(envelope) {
    if (!envelope || typeof envelope !== 'object') return null;

    const rawNamespace = typeof envelope.ns === 'string' ? envelope.ns : envelope.chunkNamespace;
    const namespace = rawNamespace === 'wd' ? 'weather-dashboard' : rawNamespace;
    if (namespace !== 'weather-dashboard') return null;

    const rawIndex = envelope.i != null ? envelope.i : envelope.chunkIndex;
    const rawCount = envelope.c != null ? envelope.c : envelope.chunkCount;
    const index = Number(rawIndex);
    const count = Number(rawCount);
    if (!Number.isInteger(index) || !Number.isInteger(count)) return null;
    if (index < 1 || count < 1) return null;

    const rawFingerprint = envelope.fp != null ? envelope.fp : envelope.chunkFingerprint;
    const fingerprint = typeof rawFingerprint === 'string' && rawFingerprint.length ? rawFingerprint : null;

    const rawOffset = envelope.o != null ? envelope.o : envelope.chunkOffset;
    const rawLength = envelope.l != null ? envelope.l : envelope.chunkLength;
    const rawTotal = envelope.t != null ? envelope.t : envelope.chunkTotalLength;
    const offset = toFiniteNumber(rawOffset);
    const length = toFiniteNumber(rawLength);
    const totalLength = toFiniteNumber(rawTotal);

    const rawData = envelope.d != null ? envelope.d : envelope.chunkData;
    const data = typeof rawData === 'string' ? rawData : '';

    return {
      namespace,
      index,
      count,
      fingerprint,
      offset: Number.isFinite(offset) ? offset : NaN,
      length: Number.isFinite(length) ? length : NaN,
      totalLength: Number.isFinite(totalLength) ? totalLength : NaN,
      data,
      raw: envelope
    };
  }

  function assembleChunkPayload(envelopes, context = {}) {
    if (!envelopes || envelopes.length === 0) return null;
    const normalized = envelopes
      .map(normalizeChunkEnvelope)
      .filter(Boolean);
    if (!normalized.length) return null;

    const groups = collectChunkGroups(normalized);
    if (!groups.size) return null;

    const completeCandidates = buildCompleteChunkCandidates(groups);
    if (completeCandidates.length) {
      const preferredComplete = selectPreferredChunkCandidate(completeCandidates);
      if (preferredComplete) {
        return preferredComplete;
      }
    }

    const composite = buildCompositeChunkCandidate(groups, context);
    if (composite) {
      return composite;
    }

    console.warn('[WeatherDashboard] Unable to build dashboard payload from chunked data', normalized.map(entry => entry.raw));
    return null;
  }

  function collectChunkGroups(envelopes) {
    const groups = new Map();
    let order = 0;

    for (const env of envelopes) {
      const fingerprint = env.fingerprint;
      const key = fingerprint ? `fp:${fingerprint}` : `legacy:${env.count}`;
      if (!groups.has(key)) {
        order += 1;
        groups.set(key, {
          key,
          fingerprint,
          fingerprintInfo: decodeChunkFingerprint(fingerprint),
          chunkCount: env.count,
          chunkMap: new Map(),
          hasDuplicate: false,
          chunkCountMismatch: false,
          groupOrder: order,
          totalLength: Number.isFinite(env.totalLength) ? env.totalLength : NaN,
          envelopes: []
        });
      }

      const group = groups.get(key);
      group.envelopes.push(env.raw);

      if (group.chunkCount !== env.count) {
        group.chunkCountMismatch = true;
      }

      const chunkInfo = {
        index: env.index,
        data: env.data,
        offset: Number.isFinite(env.offset) ? env.offset : NaN,
        length: Number.isFinite(env.length) ? env.length : NaN,
        totalLength: Number.isFinite(env.totalLength) ? env.totalLength : NaN
      };

      if (group.chunkMap.has(env.index)) {
        group.hasDuplicate = true;
      }
      group.chunkMap.set(env.index, chunkInfo);

      if (!Number.isFinite(group.totalLength) && Number.isFinite(chunkInfo.totalLength)) {
        group.totalLength = chunkInfo.totalLength;
      }
    }

    return groups;
  }

  function buildCompleteChunkCandidates(groups) {
    const candidates = [];

    for (const group of groups.values()) {
      if (!Number.isInteger(group.chunkCount) || group.chunkCount < 1) {
        console.warn('[WeatherDashboard] Invalid chunkCount encountered while grouping dashboard chunks', group.envelopes);
        continue;
      }

      if (group.chunkCountMismatch) {
        console.warn('[WeatherDashboard] Chunk payload counts differ across tiles', group.envelopes);
        continue;
      }

      if (group.hasDuplicate) {
        console.warn(
          `[WeatherDashboard] Duplicate dashboard data chunk index detected${group.fingerprint ? ` for ${group.fingerprint}` : ''}`,
          group.envelopes
        );
        continue;
      }

      const missing = [];
      for (let i = 1; i <= group.chunkCount; i++) {
        if (!group.chunkMap.has(i)) {
          missing.push(i);
        }
      }

      if (missing.length) {
        console.info(`[WeatherDashboard] Missing dashboard data chunk(s)${group.fingerprint ? ` for ${group.fingerprint}` : ''}`, missing);
        continue;
      }

      const buffer = [];
      for (let i = 1; i <= group.chunkCount; i++) {
        const chunk = group.chunkMap.get(i);
        buffer.push(chunk && typeof chunk.data === 'string' ? chunk.data : '');
      }

      const raw = buffer.join('');
      if (!raw) continue;

      try {
        const payload = JSON.parse(raw);
        const metadata = { ...(payload.metadata || {}) };
        metadata.chunkCount = group.chunkCount;
        if (group.fingerprint) metadata.chunkFingerprint = group.fingerprint;

        const layout = resolveChunkLayout(group, groups);
        if (layout && layout.offsets && layout.lengths) {
          metadata.chunkLayout = {
            offsets: layout.offsets.slice(),
            lengths: layout.lengths.slice(),
            totalLength: Number.isFinite(layout.totalLength) ? layout.totalLength : raw.length
          };
        } else if (Number.isFinite(group.totalLength)) {
          metadata.chunkTotalLength = group.totalLength;
        }

        payload.metadata = metadata;

        candidates.push({
          payload,
          raw,
          fingerprint: group.fingerprint,
          fingerprintInfo: group.fingerprintInfo,
          chunkCount: group.chunkCount,
          key: group.key,
          groupOrder: group.groupOrder
        });
      } catch (err) {
        console.warn('[WeatherDashboard] Failed to reassemble chunked payload', err, { key: group.key, chunkCount: group.chunkCount });
      }
    }

    return candidates;
  }

  function buildCompositeChunkCandidate(groups, context = {}) {
    const { lastSuccessfulRawPayload } = context || {};
    if (typeof lastSuccessfulRawPayload !== 'string' || !lastSuccessfulRawPayload.length) return null;

    const groupList = Array.from(groups.values()).filter(group => group.chunkMap && group.chunkMap.size);
    if (!groupList.length) return null;

    const target = selectPreferredChunkGroup(groupList);
    if (!target) return null;

    const layout = resolveChunkLayout(target, groups);
    if (!layout || !Array.isArray(layout.offsets) || !Array.isArray(layout.lengths)) return null;
    if (layout.offsets.length !== target.chunkCount || layout.lengths.length !== target.chunkCount) return null;

    const totalLength = Number.isFinite(layout.totalLength)
      ? layout.totalLength
      : Number.isFinite(target.fingerprintInfo?.length)
        ? target.fingerprintInfo.length
        : layout.lengths.reduce((sum, len) => (Number.isFinite(len) ? sum + len : sum), 0);

    if (!Number.isFinite(totalLength) || totalLength <= 0) return null;

    const bufferLength = Math.max(totalLength, lastSuccessfulRawPayload.length);
    const buffer = new Array(bufferLength).fill(null);

    for (let i = 0; i < lastSuccessfulRawPayload.length && i < buffer.length; i++) {
      buffer[i] = lastSuccessfulRawPayload[i];
    }

    const fallbackByIndex = buildFallbackChunkMap(groupList, target);

    for (let idx = 1; idx <= target.chunkCount; idx++) {
      const offset = layout.offsets[idx - 1];
      const expectedLength = layout.lengths[idx - 1];
      if (!Number.isFinite(offset) || !Number.isFinite(expectedLength) || expectedLength < 0) {
        return null;
      }

      const end = offset + expectedLength;
      if (end > buffer.length) {
        for (let i = buffer.length; i < end; i++) {
          buffer[i] = null;
        }
      }

      let segment = null;
      const chunk = target.chunkMap.get(idx);
      if (chunk && typeof chunk.data === 'string' && chunk.data.length) {
        segment = chunk.data;
      } else {
        const fallback = fallbackByIndex.get(idx);
        if (fallback && typeof fallback.data === 'string' && fallback.data.length === expectedLength) {
          segment = fallback.data;
        }
      }

      if (segment) {
        if (segment.length !== expectedLength) {
          return null;
        }
        for (let i = 0; i < segment.length; i++) {
          buffer[offset + i] = segment[i];
        }
        continue;
      }

      let missing = false;
      for (let pos = offset; pos < end; pos++) {
        if (buffer[pos] == null) {
          missing = true;
          break;
        }
      }
      if (missing) {
        return null;
      }
    }

    if (buffer.some(ch => ch == null)) {
      return null;
    }

    const raw = buffer.join('').slice(0, totalLength);

    try {
      const payload = JSON.parse(raw);
      const metadata = { ...(payload.metadata || {}) };
      metadata.chunkCount = target.chunkCount;
      if (target.fingerprint) metadata.chunkFingerprint = target.fingerprint;
      metadata.chunkLayout = {
        offsets: layout.offsets.slice(),
        lengths: layout.lengths.slice(),
        totalLength: Number.isFinite(layout.totalLength) ? layout.totalLength : raw.length
      };
      payload.metadata = metadata;

      return {
        payload,
        raw,
        fingerprint: target.fingerprint,
        fingerprintInfo: target.fingerprintInfo,
        chunkCount: target.chunkCount,
        key: target.key,
        groupOrder: target.groupOrder,
        composite: true
      };
    } catch (err) {
      console.warn('[WeatherDashboard] Failed to composite dashboard payload from partial chunks', err, { key: target.key, chunkCount: target.chunkCount });
      return null;
    }
  }

  function selectPreferredChunkGroup(groups) {
    if (!groups || !groups.length) return null;
    return groups.reduce((best, group) => {
      if (!best) return group;
      return compareChunkGroupRecency(group, best) > 0 ? group : best;
    }, null);
  }

  function buildFallbackChunkMap(groups, target) {
    const fallback = new Map();
    const ordered = groups
      .filter(group => group !== target)
      .sort((a, b) => compareChunkGroupRecency(b, a));

    for (const group of ordered) {
      if (group.chunkCount !== target.chunkCount) continue;
      for (const [index, chunk] of group.chunkMap.entries()) {
        if (fallback.has(index)) continue;
        if (chunk && typeof chunk.data === 'string') {
          fallback.set(index, { data: chunk.data, source: group });
        }
      }
    }

    return fallback;
  }

  function compareChunkGroupRecency(a, b) {
    if (!a) return -1;
    if (!b) return 1;

    const aInfo = a.fingerprintInfo || {};
    const bInfo = b.fingerprintInfo || {};
    const aHasTs = Number.isFinite(aInfo.timestamp);
    const bHasTs = Number.isFinite(bInfo.timestamp);

    if (aHasTs && bHasTs && aInfo.timestamp !== bInfo.timestamp) {
      return aInfo.timestamp > bInfo.timestamp ? 1 : -1;
    }

    if (aHasTs && !bHasTs) return 1;
    if (!aHasTs && bHasTs) return -1;

    const aSeq = Number.isFinite(aInfo.sequence) ? aInfo.sequence : -Infinity;
    const bSeq = Number.isFinite(bInfo.sequence) ? bInfo.sequence : -Infinity;
    if (aSeq !== bSeq) {
      return aSeq > bSeq ? 1 : -1;
    }

    const aAvailable = a.chunkMap ? a.chunkMap.size : 0;
    const bAvailable = b.chunkMap ? b.chunkMap.size : 0;
    if (aAvailable !== bAvailable) {
      return aAvailable > bAvailable ? 1 : -1;
    }

    if (a.chunkCount !== b.chunkCount) {
      return a.chunkCount > b.chunkCount ? 1 : -1;
    }

    return a.groupOrder > b.groupOrder ? 1 : -1;
  }

  function resolveChunkLayout(target, groups) {
    if (!target || !Number.isInteger(target.chunkCount) || target.chunkCount < 1) return null;

    const count = target.chunkCount;
    const offsets = new Array(count).fill(null);
    const lengths = new Array(count).fill(null);
    let totalLength = Number.isFinite(target.totalLength) ? target.totalLength : NaN;

    function applyGroupLayout(group) {
      if (!group || !Number.isInteger(group.chunkCount) || group.chunkCount !== count) return;
      if (!Number.isFinite(totalLength) && Number.isFinite(group.totalLength)) {
        totalLength = group.totalLength;
      }
      if (!group.chunkMap || typeof group.chunkMap.get !== 'function') return;

      for (let i = 1; i <= count; i++) {
        const chunk = group.chunkMap.get(i);
        if (!chunk) continue;

        if (offsets[i - 1] == null) {
          const offset = toFiniteNumber(chunk.offset);
          if (Number.isFinite(offset)) offsets[i - 1] = offset;
        }

        if (lengths[i - 1] == null) {
          const length = toFiniteNumber(chunk.length);
          if (Number.isFinite(length)) lengths[i - 1] = length;
        }
      }
    }

    applyGroupLayout(target);

    if (offsets.includes(null) || lengths.includes(null) || !Number.isFinite(totalLength)) {
      for (const group of groups.values()) {
        if (group === target) continue;
        applyGroupLayout(group);

        const missingOffsets = offsets.includes(null);
        const missingLengths = lengths.includes(null);
        const hasTotal = Number.isFinite(totalLength);
        if (!missingOffsets && !missingLengths && hasTotal) {
          break;
        }
      }
    }

    if (offsets.includes(null) || lengths.includes(null)) {
      return null;
    }

    const normalizedOffsets = offsets.map(Number);
    const normalizedLengths = lengths.map(Number);

    if (!Number.isFinite(totalLength)) {
      const lastIndex = normalizedOffsets.length - 1;
      if (lastIndex >= 0) {
        const derivedTotal = normalizedOffsets[lastIndex] + normalizedLengths[lastIndex];
        if (Number.isFinite(derivedTotal)) {
          totalLength = derivedTotal;
        }
      }
    }

    if (!Number.isFinite(totalLength)) {
      const maxExtent = normalizedOffsets.reduce((max, offset, idx) => {
        const length = normalizedLengths[idx];
        if (!Number.isFinite(offset) || !Number.isFinite(length)) return max;
        const end = offset + length;
        return Number.isFinite(end) && end > max ? end : max;
      }, -Infinity);
      if (Number.isFinite(maxExtent) && maxExtent >= 0) {
        totalLength = maxExtent;
      }
    }

    if (!Number.isFinite(totalLength)) {
      return null;
    }

    return {
      offsets: normalizedOffsets,
      lengths: normalizedLengths,
      totalLength
    };
  }


  function toFiniteNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : NaN;
  }

  function selectPreferredChunkCandidate(candidates) {
    if (!candidates || !candidates.length) return null;
    return candidates.reduce((best, candidate) => {
      if (!best) return candidate;

      const aInfo = candidate.fingerprintInfo || {};
      const bInfo = best.fingerprintInfo || {};
      const aHasTs = Number.isFinite(aInfo.timestamp);
      const bHasTs = Number.isFinite(bInfo.timestamp);

      if (aHasTs && bHasTs && aInfo.timestamp !== bInfo.timestamp) {
        return aInfo.timestamp > bInfo.timestamp ? candidate : best;
      }

      if (aHasTs && !bHasTs) {
        return candidate;
      }

      if (!aHasTs && bHasTs) {
        return best;
      }

      const aSeq = Number.isFinite(aInfo.sequence) ? aInfo.sequence : -Infinity;
      const bSeq = Number.isFinite(bInfo.sequence) ? bInfo.sequence : -Infinity;
      if (aSeq !== bSeq) {
        return aSeq > bSeq ? candidate : best;
      }

      if (candidate.chunkCount !== best.chunkCount) {
        return candidate.chunkCount > best.chunkCount ? candidate : best;
      }

      return candidate.groupOrder > best.groupOrder ? candidate : best;
    }, null);
  }

  function decodeChunkFingerprint(fingerprint) {
    if (typeof fingerprint !== 'string' || !fingerprint.length) {
      return { raw: fingerprint || '', timestamp: -Infinity, sequence: -Infinity, length: NaN };
    }

    const parts = fingerprint.split('-');
    if (parts.length !== 3) {
      return { raw: fingerprint, timestamp: -Infinity, sequence: -Infinity, length: NaN };
    }

    const [tsPart, seqPart, lenPart] = parts;
    return {
      raw: fingerprint,
      timestamp: parseFingerprintPart(tsPart),
      sequence: parseFingerprintPart(seqPart),
      length: parseFingerprintPart(lenPart)
    };
  }

  function parseFingerprintPart(part) {
    if (typeof part !== 'string' || !part.length) return NaN;
    const normalized = part.trim();
    if (!normalized) return NaN;

    let value = NaN;
    if (/^[0-9a-z]+$/i.test(normalized)) {
      value = parseInt(normalized, 36);
    }

    if (!Number.isFinite(value)) {
      const decimal = Number(normalized);
      value = Number.isFinite(decimal) ? decimal : NaN;
    }

    return value;
  }

  function extractJson(text) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    return text.slice(start, end + 1);
  }

  function getTileText(tile) {
    if (!tile) return '';
    const node = findContentElement(tile);
    if (!node) return '';
    return node.textContent.trim();
  }

  function findContentElement(tile) {
    if (!tile) return null;
    const selectors = ['.tile-primary', '.tile-contents', '.tile-content', '.tile'];
    for (const sel of selectors) {
      const el = typeof tile.querySelector === 'function' ? tile.querySelector(sel) : null;
      if (el) return el;
    }
    return tile;
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

  function byId(id) {
    return document.getElementById(id);
  }

  function debounce(fn, delay) {
    let frame;
    return (...args) => {
      clearTimeout(frame);
      frame = setTimeout(() => fn(...args), delay);
    };
  }
})();
