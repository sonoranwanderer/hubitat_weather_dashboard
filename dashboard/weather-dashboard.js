// weather-dashboard.js
//
// JavaScript presentation layer for the Hubitat dashboard tile.  This script is
// intended to be loaded via the JavaScript Injector driver (tile-0).  It reads the
// JSON payload exposed by the Weather Dashboard virtual device (tile-1, optional
// tile-2/tile-3) and renders an information dense layout inspired by the Ecowitt
// console.

(() => {
  const IS_TEST_ENV = typeof window !== 'undefined' && window.__WDASH_TEST_MODE__ === true;
  const DISPLAY_TILE_ID = 'tile-0';
  const CSS_ID = 'weather-dashboard-css';
  const TEMP_RANGE = { min: -40, max: 120 };
  const DEFAULT_AMBIENT_ROTATION_INTERVAL_MS = 5000;
  const MIN_AMBIENT_ROTATION_SECONDS = 5;
  const MAX_AMBIENT_ROTATION_SECONDS = 5;
  // Ambient rotation is currently fixed at five seconds per requirements, so the
  // clamp above keeps any provided interval aligned with the default.
  const DEFAULT_AIR_QUALITY_ROTATION_INTERVAL_MS = 5000;
  const INIT_RETRY_LIMIT = 40;
  const INIT_RETRY_DELAY = 250;
  const DATA_REFRESH_INTERVAL = 5000;
  const DEFAULT_BASE_WIDTH = 1200;
  const DEFAULT_BASE_HEIGHT = 900;
  const BREAKPOINTS = ['desktop', 'tablet', 'mobile'];
  const LAYOUT_STYLE_ID = 'weather-dashboard-layout-style';
  const DEFAULT_TRACK_UNIT = 'px';
  const TILE_MEASURE_TOLERANCE = 1;

  const TEMPERATURE_UNITS = ['F', 'C'];
  const TEMPERATURE_UNIT_STORAGE_KEYS = {
    input: 'wdashTempInputUnit',
    display: 'wdashTempDisplayUnit'
  };

  const temperatureUnitState = {
    input: readStoredTemperatureUnit('input') || 'F',
    display: readStoredTemperatureUnit('display') || 'F',
    metadataInput: null,
    metadataDisplay: null,
    displayOverride: false
  };

  const tileMeasurementState = {
    width: null,
    height: null
  };

  const SHARED_DESKTOP_LAYOUT = {
    columns: 'repeat(2, minmax(0, 1fr))',
    gap: '14px',
    rows: [
      { columns: ['temp-wind', 'ambient'], height: 450 },
      { columns: ['air', 'rain'], height: 140 },
      { columns: ['solar', 'rain'], height: 180 },
      { columns: ['solar', 'pressure'], height: 110 }
    ]
  };

  const DEFAULT_LAYOUT = {
    baseWidth: DEFAULT_BASE_WIDTH,
    baseHeight: DEFAULT_BASE_HEIGHT,
    desktop: { ...SHARED_DESKTOP_LAYOUT },
    tablet: { ...SHARED_DESKTOP_LAYOUT },
    mobile: { ...SHARED_DESKTOP_LAYOUT }
  };

  const DEFAULT_BASE_DIMENSIONS = {
    desktop: { width: DEFAULT_BASE_WIDTH, height: DEFAULT_BASE_HEIGHT },
    tablet: { width: DEFAULT_BASE_WIDTH, height: DEFAULT_BASE_HEIGHT },
    mobile: { width: DEFAULT_BASE_WIDTH, height: DEFAULT_BASE_HEIGHT }
  };

  const DEFAULT_TEMPLATES = compileLayoutTemplates(DEFAULT_LAYOUT, { trackUnit: DEFAULT_TRACK_UNIT });
  const DEFAULT_NORMALIZED_AREAS = {
    desktop: normalizeTemplateAreas(DEFAULT_TEMPLATES.desktop.areas),
    tablet: normalizeTemplateAreas(DEFAULT_TEMPLATES.tablet.areas),
    mobile: normalizeTemplateAreas(DEFAULT_TEMPLATES.mobile.areas)
  };
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
    baseDimensions: {
      desktop: { ...DEFAULT_BASE_DIMENSIONS.desktop },
      tablet: { ...DEFAULT_BASE_DIMENSIONS.tablet },
      mobile: { ...DEFAULT_BASE_DIMENSIONS.mobile }
    },
    columns: { ...DEFAULT_COLUMNS },
    gaps: { ...DEFAULT_GAPS },
    templates: DEFAULT_TEMPLATES,
    normalizedAreas: { ...DEFAULT_NORMALIZED_AREAS },
    trackUnit: DEFAULT_TRACK_UNIT,
    signature: null,
    pendingApply: false,
    lastDiagnostics: null
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

  const SUN_CARD_GEOMETRY = { cx: 100, cy: 100, r: 85, startAngle: 210, endAngle: 330 };
  const SUN_CARD_METRIC_POSITIONS = {
    uv: { left: 35 / 2, top: 28 },
    solar: { left: 100 / 2, top: 45 },
    moon: { left: 165 / 2, top: 28 }
  };

  const AIR_QUALITY_METRIC_ORDER = [
    'aqi',
    'aqi24h',
    'pm25',
    'pm25_24h',
    'pm10',
    'pm10_24h',
    'co2',
    'co2_24h'
  ];

  const KNOWN_PAYLOAD_KEYS = new Set([
    'outdoor',
    'indoor',
    'wind',
    'pressure',
    'rain',
    'solar',
    'lightning',
    'ambientSensors',
    'totalAmbientSensors',
    'ambientRotationSeconds',
    'ambientTemperatureUnit',
    'ambientHumidityUnit',
    'outdoorAirQuality',
    'indoorAirQuality',
    'metadata',
    'layout',
    'outlook24h'
  ]);

  const LIGHTNING_BOLT_ICON = `
    <svg viewBox="0 0 48 48" class="wdash-lightning-bolt-svg" focusable="false" aria-hidden="true">
      <path d="M26.9 3.2L7.6 27h11.7l-3.6 18.3L40.4 21H28.6z" fill="#ffd766" stroke="rgba(0,0,0,0.28)" stroke-width="2" stroke-linejoin="round" />
    </svg>
  `;

  const PRESSURE_OUTLOOK_ICONS = {
    sunny: `
      <svg viewBox="0 0 48 48" class="wdash-pressure-icon-svg" focusable="false" aria-hidden="true">
        <circle cx="24" cy="24" r="10" fill="#ffd766" stroke="#f0b400" stroke-width="2" />
        <g stroke="#f0b400" stroke-width="2" stroke-linecap="round">
          <line x1="24" y1="6" x2="24" y2="0" />
          <line x1="24" y1="48" x2="24" y2="42" />
          <line x1="6" y1="24" x2="0" y2="24" />
          <line x1="48" y1="24" x2="42" y2="24" />
          <line x1="10" y1="10" x2="5" y2="5" />
          <line x1="38" y1="38" x2="43" y2="43" />
          <line x1="10" y1="38" x2="5" y2="43" />
          <line x1="38" y1="10" x2="43" y2="5" />
        </g>
      </svg>
    `,
    partly: `
      <svg viewBox="0 0 48 48" class="wdash-pressure-icon-svg" focusable="false" aria-hidden="true">
        <circle cx="17" cy="19" r="9" fill="#ffd766" stroke="#f0b400" stroke-width="2" />
        <g transform="translate(24 0) scale(1.5 1) translate(-24 0)">
          <path d="M15 30c1.6-3.6 5.2-6 9.3-6 5.7 0 10.3 4.5 10.3 10.1 0 0.3 0 0.7-0.1 1H15c-3.3 0-6-2.6-6-5.8 0-3 2.3-5.5 5.3-5.8" fill="#ffffff" stroke="#d0d6df" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
        </g>
      </svg>
    `,
    cloudy: `
      <svg viewBox="0 0 48 48" class="wdash-pressure-icon-svg" focusable="false" aria-hidden="true">
        <g transform="translate(24 0) scale(1.5 1) translate(-24 0)">
          <path d="M17 34c-4.4 0-8-3.4-8-7.6 0-3.8 2.8-7 6.6-7.5 1.3-5.2 6-9.1 11.6-9.1 6.7 0 12.1 5.3 12.1 11.9 0 0.4 0 0.8-0.1 1.2 3.4 0.8 6 3.9 6 7.5 0 4.2-3.4 7.6-7.7 7.6H17z" fill="#ffffff" stroke="#d0d6df" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
        </g>
      </svg>
    `,
    rainy: `
      <svg viewBox="0 0 48 48" class="wdash-pressure-icon-svg" focusable="false" aria-hidden="true">
        <g transform="translate(24 0) scale(1.5 1) translate(-24 0)">
          <path d="M16 32c-4 0-7.3-3.1-7.3-7 0-3.5 2.6-6.5 6-6.9 1.1-5 5.7-8.7 11-8.7 6.3 0 11.4 4.9 11.4 10.9 0 0.4 0 0.8-0.1 1.1 3.2 0.7 5.6 3.6 5.6 7 0 3.9-3.2 7-7.1 7H16z" fill="#ffffff" stroke="#d0d6df" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
        </g>
        <g stroke="#3ca0ff" stroke-width="2" stroke-linecap="round">
          <line x1="18" y1="36" x2="15" y2="42" />
          <line x1="28" y1="36" x2="25" y2="42" />
          <line x1="38" y1="36" x2="35" y2="42" />
        </g>
      </svg>
    `,
    stormy: `
      <svg viewBox="0 0 48 48" class="wdash-pressure-icon-svg" focusable="false" aria-hidden="true">
        <g transform="translate(24 0) scale(1.5 1) translate(-24 0)">
          <path d="M16 30c-4 0-7.3-3.1-7.3-7 0-3.5 2.6-6.5 6-6.9 1.1-5 5.7-8.7 11-8.7 6.3 0 11.4 4.9 11.4 10.9 0 0.4 0 0.8-0.1 1.1 3.2 0.7 5.6 3.6 5.6 7 0 3.9-3.2 7-7.1 7H16z" fill="#ffffff" stroke="#d0d6df" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
        </g>
        <path d="M27 32l-5 9h4l-1 7 8-10h-4l2-6z" fill="#ffd766" stroke="#f0b400" stroke-width="1.5" stroke-linejoin="round" />
      </svg>
    `
  };

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
    interval: DEFAULT_AMBIENT_ROTATION_INTERVAL_MS,
    tempUnit: `°${getDisplayTemperatureUnit()}`,
    humidityUnit: '%',
    countdownTimer: null,
    nextSwitchAt: null,
    paused: false
  };

  let airQualityRotation = {
    timer: null,
    sources: [], // ['Outdoor', 'Indoor']
    index: 0,
    interval: DEFAULT_AIR_QUALITY_ROTATION_INTERVAL_MS,
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

  const CARD_RENDERERS = [
    { key: 'tempWind', selector: '.wdash-card--temp-wind', build: data => buildTempWindCard(data) },
    { key: 'ambient', selector: '.wdash-card--ambient', build: (data, opts) => buildAmbientSensorCard(data, opts?.ambientSeed) },
    { key: 'lightning', selector: '.wdash-card--lightning', build: data => buildLightningCard(data) },
    { key: 'pressure', selector: '.wdash-card--pressure', build: data => buildPressureCard(data) },
    { key: 'rain', selector: '.wdash-card--rain', build: data => buildRainCard(data) },
    { key: 'solar', selector: '.wdash-card--solar', build: data => buildSolarSunCard(data) },
    { key: 'air', selector: '.wdash-card--air', build: data => buildAirQualityCard(data) }
  ];

  const renderState = {
    mounted: false,
    markupByKey: new Map(),
    order: CARD_RENDERERS.map(card => card.key)
  };

  const dataTileObservers = new Map();
  let domObserver = null;
  let scaleObserver = null;
  let scaleResizeHandler = null;
  let breakpointListenersRegistered = false;
  let tempWindGaugeObserver = null;
  let tempWindGaugeResizeHandler = null;
  let tempWindGaugeHosts = [];
  const tempWindGaugeLastSizes = new WeakMap();
  const tempWindState = { data: null };
  const solarState = { data: null };
  let solarStaticLayoutCache = null;
  let rainDropObserver = null;
  let rainDropResizeHandler = null;
  let rainDropRaf = null;
  let rainDropRafType = null;
  let rainDropLastHeight = null;
  let rainDropLastCard = null;
  const invalidJsonTiles = new Set();
  let lastSourceTileIds = [];
  let maskedTileIds = new Set();
  let pressureMode = 'relative';
  let lastSuccessfulPayload = null;

    if (!IS_TEST_ENV) {
      patchDashboardGlitches();
      whenDomReady(init);
    }

  function whenDomReady(callback) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', callback, { once: true });
    } else {
      callback();
    }
  }

  function patchDashboardGlitches() {
    if (typeof window === 'undefined') return;

    if (!window.__wdashHistoryPatched) {
      const installPatchedHistory = original => {
        if (typeof original !== 'function') return;
        if (window.__wdashHistoryPatched) return;

        const patched = function patchedAddToDashboardHistory(...args) {
          try {
            return original.apply(this, args);
          } catch (err) {
            console.warn('[WeatherDashboard] Suppressed dashboard history error', err);
            return undefined;
          }
        };

        const descriptor = Object.getOwnPropertyDescriptor(window, 'addToDashboardHistory');
        let installed = false;

        if (!descriptor || descriptor.configurable) {
          try {
            Object.defineProperty(window, 'addToDashboardHistory', {
              configurable: true,
              writable: true,
              value: patched
            });
            installed = true;
          } catch (err) {
            // Fall through to assignment attempt below.
          }
        }

        if (!installed) {
          try {
            window.addToDashboardHistory = patched;
            installed = window.addToDashboardHistory === patched;
          } catch (err) {
            console.warn('[WeatherDashboard] Unable to patch dashboard history', err);
          }
        }

        if (installed) {
          patched.__wdashOriginal = original;
          window.__wdashHistoryPatched = true;
        }
      };

      if (typeof window.addToDashboardHistory === 'function') {
        installPatchedHistory(window.addToDashboardHistory);
      } else if (!window.__wdashHistoryPatchedPending) {
        Object.defineProperty(window, 'addToDashboardHistory', {
          configurable: true,
          get() {
            return undefined;
          },
          set(value) {
            if (typeof value === 'function') {
              installPatchedHistory(value);
            } else {
              try {
                Object.defineProperty(window, 'addToDashboardHistory', {
                  configurable: true,
                  writable: true,
                  value: value
                });
              } catch (err) {
                try {
                  window.addToDashboardHistory = value;
                } catch (assignErr) {
                  console.warn('[WeatherDashboard] Unable to store dashboard history handler', assignErr);
                }
              }
            }
          }
        });
        window.__wdashHistoryPatchedPending = true;
      }
    }

    if (!window.__wdashSocketGuard) {
      window.addEventListener('error', event => {
        if (!event) return;
        const message = String(event.message || '');
        const isDashboardValueError = (
          message.includes("Cannot set properties of undefined (setting 'value')") ||
          message.includes('value is not defined') ||
          message.includes("can't access property \"value\"")
        );
        if (isDashboardValueError && event.filename && event.filename.indexOf('app.js') !== -1) {
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

    refreshTemperatureUnitUI();

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
      renderFallbackState();
    }
  }

  function renderFromData() {
    const segments = readPayloads();
    const merged = mergePayloads(segments);
    const payload = merged || lastSuccessfulPayload;
    const grid = document.querySelector('#' + DISPLAY_TILE_ID + ' .wdash-grid');
    if (!grid) return;

    let maskMode = null;

    try {
      applyTemperatureUnitsFromMetadata(payload?.metadata);
      applyLayoutOverrides(payload?.metadata);
      applyScale();

      if (!payload) {
        maskMode = 'show';
        resetDashboardToWaiting(grid);
        stopHubClock();
        teardownTempWindGaugeSizing();
        return;
      }

      maskMode = 'hide';
      lastSuccessfulPayload = payload;

      grid.dataset.empty = 'false';
      const ambientSeed = resolveAmbientSeedState(payload);
      if (ambientSeed && Number.isInteger(ambientSeed.index)) {
        ambientRotation.index = ambientSeed.index;
      }
      const cardMarkupList = buildCardMarkupList(payload, { ambientSeed });
      let cardsChanged = false;

      if (!renderState.mounted) {
        grid.innerHTML = cardMarkupList.map(card => card.markup).join('');
        renderState.mounted = true;
        renderState.markupByKey.clear();
        cardMarkupList.forEach(card => {
          renderState.markupByKey.set(card.key, card.markup);
        });
        cardsChanged = true;
        try {
          const ambientContainer = document.querySelector('#' + DISPLAY_TILE_ID + ' .wdash-ambient');
          if (ambientContainer) initAmbientLastHum(ambientContainer);
        } catch (e) { /* ignore */ }
      } else {
        cardMarkupList.forEach(card => {
          const previousMarkup = renderState.markupByKey.get(card.key) || null;
          if (card.key === 'ambient' || card.key === 'tempWind' || card.key === 'solar') {
            const ensured = ensureCardPresence(grid, card, cardMarkupList);
            if (ensured) {
              renderState.markupByKey.set(card.key, card.markup);
            }
            return;
          }

          if (previousMarkup !== card.markup) {
            replaceCardMarkup(grid, card, cardMarkupList);
            renderState.markupByKey.set(card.key, card.markup);
            cardsChanged = true;
          }
        });
      }

      if (cardsChanged) {
        layoutState.pendingApply = true;
        applyLayoutOverrides(payload?.metadata);
      } else if (layoutState.pendingApply) {
        layoutState.pendingApply = false;
      }

      tempWindState.data = payload;
      updateTempWindCard();
      solarState.data = payload;
      updateSolarSunCard();
      setupAmbientRotation(payload);
      setupAirQualityRotation(payload);
      setupInteractiveComponents(grid);
      setupHubClock(payload);
      // observe ambient container for size changes to keep ring geometry synchronized
      const ambientContainer = document.querySelector('#' + DISPLAY_TILE_ID + ' .wdash-ambient');
      if (ambientContainer && typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => { applyAmbientRingSizing(); applyOutdoorRingSizing(); });
        ro.observe(ambientContainer);
      } else {
        // fallback: window resize
        window.addEventListener('resize', () => { applyAmbientRingSizing(); applyOutdoorRingSizing(); });
      }
    } finally {
      if (maskMode === 'hide') {
        toggleSourceTileMask(true);
      } else if (maskMode === 'show') {
        toggleSourceTileMask(false);
      }
    }
  }

  function renderFallbackState() {
    const grid = document.querySelector('#' + DISPLAY_TILE_ID + ' .wdash-grid');
    if (!grid) return;
    resetDashboardToWaiting(grid);
    stopHubClock();
    teardownTempWindGaugeSizing();
    toggleSourceTileMask(false);
  }

  function resetDashboardToWaiting(grid) {
    grid.dataset.empty = 'true';
    grid.innerHTML = `<div class="wdash-empty">Waiting for weather data…</div>`;
    renderState.mounted = false;
    renderState.markupByKey.clear();
    tempWindState.data = null;
    clearAmbientRotation();
  }

  function readPayloads() {
    const tiles = Array.from(document.querySelectorAll('[id^="tile-"]'));
    const segments = [];
    const sourceIds = [];

    for (const tile of tiles) {
      if (!tile || tile.id === DISPLAY_TILE_ID) continue;
      const text = getTileText(tile);
      if (!text) continue;
      const jsonText = extractJson(text);
      if (!jsonText) {
        noteInvalidJson(tile.id, 'no JSON object found');
        continue;
      }
      try {
        const parsed = JSON.parse(jsonText);
        if (parsed && typeof parsed === 'object') {
          const keys = Object.keys(parsed);
          const recognized = keys.some(key => KNOWN_PAYLOAD_KEYS.has(key) || key === 'segmentIndex' || key === 'segmentSize');
          if (!recognized) {
            noteInvalidJson(tile.id, 'unrecognized JSON payload');
            continue;
          }
          segments.push(parsed);
          sourceIds.push(tile.id);
        } else {
          noteInvalidJson(tile.id, 'parsed payload is not an object');
        }
      } catch (err) {
        const message = err && err.message ? err.message : 'parse error';
        noteInvalidJson(tile.id, message);
      }
    }

    lastSourceTileIds = sourceIds;
    return segments;
  }

  function toggleSourceTileMask(hide) {
    if (hide) {
      const currentIds = new Set(Array.isArray(lastSourceTileIds) ? lastSourceTileIds : []);
      const staleIds = Array.from(maskedTileIds).filter(id => !currentIds.has(id));
      staleIds.forEach(id => {
        const tile = byId(id);
        if (tile) tile.classList.remove('wdash-source-tile');
        maskedTileIds.delete(id);
      });
      currentIds.forEach(id => {
        const tile = byId(id);
        if (!tile) return;
        tile.classList.add('wdash-source-tile');
        maskedTileIds.add(id);
      });
    } else {
      Array.from(maskedTileIds).forEach(id => {
        const tile = byId(id);
        if (tile) tile.classList.remove('wdash-source-tile');
      });
      maskedTileIds.clear();
    }
  }

  function getDisplayTileHostElement() {
    const root = document.querySelector('#' + DISPLAY_TILE_ID + ' .wdash-root');
    const displayTile = byId(DISPLAY_TILE_ID);
    const content = displayTile ? findContentElement(displayTile) : null;
    return content || root?.parentElement || root || displayTile || null;
  }

  function collectMeasurementCandidate(element, role) {
    if (!element) return null;
    const rect = safeGetElementRect(element);
    const rectWidth = Number(rect?.width);
    const rectHeight = Number(rect?.height);
    const clientWidth = Number(element.clientWidth);
    const clientHeight = Number(element.clientHeight);
    const offsetWidth = Number(element.offsetWidth);
    const offsetHeight = Number(element.offsetHeight);
    const width = [rectWidth, clientWidth, offsetWidth].find(value => Number.isFinite(value) && value > 0) || null;
    const height = [rectHeight, clientHeight, offsetHeight].find(value => Number.isFinite(value) && value > 0) || null;
    if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
    return {
      role,
      description: describeElementForDiagnostics(element),
      width,
      height,
      rectWidth: Number.isFinite(rectWidth) ? rectWidth : null,
      rectHeight: Number.isFinite(rectHeight) ? rectHeight : null,
      clientWidth: Number.isFinite(clientWidth) ? clientWidth : null,
      clientHeight: Number.isFinite(clientHeight) ? clientHeight : null,
      offsetWidth: Number.isFinite(offsetWidth) ? offsetWidth : null,
      offsetHeight: Number.isFinite(offsetHeight) ? offsetHeight : null
    };
  }

  function measureDisplayTileBaseDimensions() {
    const displayTile = byId(DISPLAY_TILE_ID);
    const content = displayTile ? findContentElement(displayTile) : null;
    const root = document.querySelector('#' + DISPLAY_TILE_ID + ' .wdash-root');
    const parentHost = root?.parentElement || null;

    const seen = new Set();
    const candidates = [];

    function pushCandidate(element, role) {
      if (!element || seen.has(element)) return;
      seen.add(element);
      const candidate = collectMeasurementCandidate(element, role);
      if (candidate) candidates.push(candidate);
    }

    pushCandidate(displayTile, 'tile');
    pushCandidate(content, 'content');
    pushCandidate(parentHost, 'host-parent');
    pushCandidate(root, 'root');

    if (!candidates.length) return null;

    let width = null;
    let height = null;
    let widthSource = null;
    let heightSource = null;

    for (const candidate of candidates) {
      if (!Number.isFinite(width) || candidate.width < width) {
        width = candidate.width;
        widthSource = candidate;
      }
      if (!Number.isFinite(height) || candidate.height < height) {
        height = candidate.height;
        heightSource = candidate;
      }
    }

    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return null;
    }

    return {
      width,
      height,
      strategy: 'min-candidate',
      candidates,
      widthSource: widthSource
        ? { role: widthSource.role, description: widthSource.description, width: widthSource.width }
        : null,
      heightSource: heightSource
        ? { role: heightSource.role, description: heightSource.description, height: heightSource.height }
        : null
    };
  }

  function resolveMeasuredBaseDimensions(options = {}) {
    const measurement = measureDisplayTileBaseDimensions();
    const prevWidth = tileMeasurementState.width;
    const prevHeight = tileMeasurementState.height;

    let width = Number(measurement?.width);
    let height = Number(measurement?.height);

    const hasWidth = Number.isFinite(width) && width > 0;
    const hasHeight = Number.isFinite(height) && height > 0;

    if (hasWidth) {
      width = Math.max(1, Math.floor(width));
    }

    if (hasHeight) {
      height = Math.max(1, Math.floor(height));
    }

    const nextWidth = hasWidth ? width : prevWidth;
    const nextHeight = hasHeight ? height : prevHeight;

    const widthChanged = hasWidth && (!Number.isFinite(prevWidth) || nextWidth !== prevWidth);
    const heightChanged = hasHeight && (!Number.isFinite(prevHeight) || nextHeight !== prevHeight);
    const changed = widthChanged || heightChanged;

    if (options.commit !== false) {
      if (Number.isFinite(nextWidth)) {
        tileMeasurementState.width = nextWidth;
      }
      if (Number.isFinite(nextHeight)) {
        tileMeasurementState.height = nextHeight;
      }
    }

    if (!Number.isFinite(nextWidth) || !Number.isFinite(nextHeight)) {
      return { width: null, height: null, changed: false, raw: measurement };
    }

    return {
      width: nextWidth,
      height: nextHeight,
      changed,
      raw: measurement,
      widthSource: measurement?.widthSource || null,
      heightSource: measurement?.heightSource || null,
      strategy: measurement?.strategy || null,
      candidates: Array.isArray(measurement?.candidates) ? measurement.candidates : null
    };
  }

  function resetTileMeasurement() {
    tileMeasurementState.width = null;
    tileMeasurementState.height = null;
  }

  function safeGetElementRect(element) {
    if (!element || typeof element.getBoundingClientRect !== 'function') return null;
    try {
      return element.getBoundingClientRect();
    } catch (err) {
      return null;
    }
  }

  function describeElementForDiagnostics(element) {
    if (!element) return '(none)';
    const tag = element.tagName ? element.tagName.toLowerCase() : element.nodeName || 'unknown';
    const idPart = element.id ? `#${element.id}` : '';
    const classPart = typeof element.className === 'string' && element.className.trim()
      ? '.' + element.className.trim().split(/\s+/).join('.')
      : '';
    return `<${tag}${idPart}${classPart}>`;
  }

  function parseDimensionValue(value) {
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
    return null;
  }

  function determineDimensionSource({ sectionValue, fallbackValue, measurementValue }) {
    if (parseDimensionValue(sectionValue) != null) return 'section-override';
    if (parseDimensionValue(fallbackValue) != null) return 'layout-override';
    if (Number.isFinite(measurementValue)) return 'measured';
    return 'default';
  }

  function shouldLogLayoutDiagnostics(options = {}) {
    if (options.force === true) return true;
    if (IS_TEST_ENV) return false;
    const target = typeof window !== 'undefined' ? window : globalThis;
    if (target && target.__WDASH_DEBUG_LAYOUT__ === true) {
      return true;
    }
    return layoutState.forceDiagnostics === true;
  }

  function createPercentDiagnosticsCollector() {
    return {
      rows: [],
      columns: [],
      recordRow(entry) {
        this.rows.push(entry);
      },
      recordColumn(entry) {
        this.columns.push(entry);
      }
    };
  }

  function buildLayoutDiagnosticsContext(options = {}) {
    const host = options.hostElement || getDisplayTileHostElement();
    const hostRect = safeGetElementRect(host);
    const percentCollector = options.percentCollector || null;
    const perBreakpoint = {};
    const baseSources = {};
    if (options.baseDimensions) {
      for (const key of BREAKPOINTS) {
        const dims = options.baseDimensions[key] || {};
        perBreakpoint[key] = {
          width: Number(dims.width) || null,
          height: Number(dims.height) || null
        };
        baseSources[key] = options.baseSourceMap?.[key] || {
          width: 'unknown',
          height: 'unknown'
        };
      }
    }

    const rowCounts = options.rowCounts || {};

    const context = {
      timestamp: new Date().toISOString(),
      host: {
        description: describeElementForDiagnostics(host),
        width: hostRect ? Number(hostRect.width) : null,
        height: hostRect ? Number(hostRect.height) : null
      },
      measurement: {
        raw: options.measurement || null,
        sanitized: {
          width: options.measuredWidth ?? null,
          height: options.measuredHeight ?? null
        },
        strategy: options.measurement?.strategy || null,
        widthSource: options.measurement?.widthSource || null,
        heightSource: options.measurement?.heightSource || null,
        candidates: Array.isArray(options.measurement?.candidates)
          ? options.measurement.candidates.map(entry => ({
              role: entry.role,
              description: entry.description,
              width: Number(entry.width) || null,
              height: Number(entry.height) || null,
              rectWidth: Number(entry.rectWidth) || null,
              rectHeight: Number(entry.rectHeight) || null,
              clientWidth: Number(entry.clientWidth) || null,
              clientHeight: Number(entry.clientHeight) || null,
              offsetWidth: Number(entry.offsetWidth) || null,
              offsetHeight: Number(entry.offsetHeight) || null
            }))
          : null
      },
      base: {
        width: options.baseWidth ?? null,
        height: options.baseHeight ?? null,
        perBreakpoint,
        sources: baseSources,
        activeBreakpoint: options.activeBreakpoint || getActiveBreakpoint()
      },
      trackUnit: options.trackUnit || layoutState.trackUnit,
      trackUnitSource: options.trackUnitSource || 'state',
      gaps: options.gaps || {},
      columns: {
        raw: options.columnsRaw || {},
        applied: options.columnsApplied || {}
      },
      rows: {
        raw: options.rowsRaw || {},
        applied: options.rowsApplied || {},
        counts: rowCounts
      },
      percentTracks: percentCollector
        ? {
            columns: percentCollector.columns.slice(),
            rows: percentCollector.rows.slice()
          }
        : null,
      layoutSignature: layoutState.signature,
      pendingApply: layoutState.pendingApply,
      currentBase: { width: currentBaseWidth, height: currentBaseHeight },
      tileMeasurementState: { ...tileMeasurementState }
    };

    return context;
  }

  function logLayoutDiagnostics(context, options = {}) {
    const payload = context || layoutState.lastDiagnostics || buildLayoutDiagnosticsContext();
    if (!payload) {
      if (typeof console !== 'undefined') {
        console.warn('[WeatherDashboard] No layout diagnostics available');
      }
      return payload;
    }
    if (!shouldLogLayoutDiagnostics(options)) {
      return payload;
    }
    const logger = typeof console !== 'undefined' ? console : null;
    if (!logger) return payload;
    const groupFn = typeof logger.groupCollapsed === 'function'
      ? logger.groupCollapsed.bind(logger)
      : logger.group ? logger.group.bind(logger) : null;
    const groupEndFn = typeof logger.groupEnd === 'function' ? logger.groupEnd.bind(logger) : null;
    const tableFn = typeof logger.table === 'function' ? logger.table.bind(logger) : null;
    const logFn = typeof logger.log === 'function' ? logger.log.bind(logger) : () => {};

    const title = `[WeatherDashboard] Layout diagnostics (${payload.base.activeBreakpoint || 'desktop'})`;
    if (groupFn) {
      groupFn(title);
    } else {
      logFn(title);
    }

    logFn('Host element:', payload.host.description);
    logFn('Host size:', `${payload.host.width ?? 'n/a'} × ${payload.host.height ?? 'n/a'}`);
    logFn('Measurement (raw):', payload.measurement.raw);
    logFn('Measurement (sanitized):', payload.measurement.sanitized);
    if (payload.measurement.strategy) {
      logFn('Measurement strategy:', payload.measurement.strategy);
    }
    if (payload.measurement.widthSource || payload.measurement.heightSource) {
      logFn('Measurement sources:', {
        width: payload.measurement.widthSource,
        height: payload.measurement.heightSource
      });
    }
    if (Array.isArray(payload.measurement.candidates) && payload.measurement.candidates.length) {
      const summary = payload.measurement.candidates.map(entry => ({
        role: entry.role,
        description: entry.description,
        width: entry.width,
        height: entry.height,
        rectWidth: entry.rectWidth,
        rectHeight: entry.rectHeight,
        clientWidth: entry.clientWidth,
        clientHeight: entry.clientHeight,
        offsetWidth: entry.offsetWidth,
        offsetHeight: entry.offsetHeight
      }));
      if (tableFn) {
        tableFn(summary);
      } else {
        logFn('Measurement candidates:', summary);
      }
    }
    logFn('Base dimensions per breakpoint:', payload.base.perBreakpoint);
    logFn('Base sources:', payload.base.sources);
    logFn('Active base size:', {
      width: payload.base.width,
      height: payload.base.height,
      currentBase: payload.currentBase
    });
    logFn('Track unit:', payload.trackUnit, `(source: ${payload.trackUnitSource})`);
    logFn('Gaps:', payload.gaps);
    logFn('Layout signature:', payload.layoutSignature);
    logFn('Pending apply:', payload.pendingApply);

    if (payload.percentTracks && payload.percentTracks.columns.length) {
      for (const entry of payload.percentTracks.columns) {
        logFn(`Percent columns (${entry.breakpoint}) raw:`, entry.raw);
        const rows = entry.percents.map((percent, index) => ({
          track: index + 1,
          percent,
          pixels: Number(entry.pixels[index].toFixed(3))
        }));
        if (tableFn) {
          tableFn(rows);
        } else {
          logFn('Columns:', rows);
        }
        logFn('Column context:', {
          available: entry.available,
          baseWidth: entry.baseWidth,
          columnGap: entry.columnGap,
          horizontalPadding: entry.horizontalPadding,
          totalPercent: entry.totalPercent,
          requestedPixels: entry.requestedPixels,
          scaledPixels: entry.scaledPixels,
          finalPixels: entry.finalPixels,
          remainder: entry.remainder,
          scale: entry.scale
        });
      }
    }

    if (payload.percentTracks && payload.percentTracks.rows.length) {
      for (const entry of payload.percentTracks.rows) {
        logFn(`Percent rows (${entry.breakpoint}) raw:`, entry.raw);
        const rows = entry.percents.map((percent, index) => ({
          row: index + 1,
          percent,
          pixels: Number(entry.pixels[index].toFixed(3))
        }));
        if (tableFn) {
          tableFn(rows);
        } else {
          logFn('Rows:', rows);
        }
        logFn('Row context:', {
          available: entry.available,
          baseHeight: entry.baseHeight,
          rowGap: entry.rowGap,
          verticalPadding: entry.verticalPadding,
          totalPercent: entry.totalPercent,
          requestedPixels: entry.requestedPixels,
          scaledPixels: entry.scaledPixels,
          finalPixels: entry.finalPixels,
          remainder: entry.remainder,
          scale: entry.scale
        });
      }
    }

    if (groupEndFn) {
      groupEndFn();
    }

    return payload;
  }

  function applyLayoutOverrides(metadata) {
    const root = document.querySelector('#' + DISPLAY_TILE_ID + ' .wdash-root');
    const dash = document.querySelector('#' + DISPLAY_TILE_ID + ' .wdash');
    if (!root || !dash) {
      layoutState.pendingApply = true;
      return;
    }

    const hostElement = getDisplayTileHostElement();
    const rawLayout = metadata ? (metadata.layout != null ? metadata.layout : metadata.layoutOverride) : null;
    const override = rawLayout ? extractLayoutOverride(rawLayout) : null;
    const overrideLayout = isPlainObject(override) ? override : null;
    const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

    const hasRowConfig = value => Array.isArray(value) || Array.isArray(value?.rows);
    const sanitizeSectionObject = section => (isPlainObject(section) ? section : null);

    const overrideSectionValues = {};
    const overrideSectionObjects = {};
    for (const key of BREAKPOINTS) {
      const value = overrideLayout && hasOwn(overrideLayout, key) ? overrideLayout[key] : undefined;
      overrideSectionValues[key] = value;
      overrideSectionObjects[key] = sanitizeSectionObject(value);
    }

    const measurement = resolveMeasuredBaseDimensions();
    const measuredWidth = sanitizeDimension(measurement.width, DEFAULT_BASE_WIDTH);
    const measuredHeight = sanitizeDimension(measurement.height, DEFAULT_BASE_HEIGHT);

    const trackUnitToken = (
      overrideLayout?.trackUnit
        ?? overrideLayout?.unit
        ?? overrideLayout?.units
        ?? overrideLayout?.dimensionUnit
        ?? null
    );
    const trackUnit = normalizeTrackUnit(trackUnitToken != null ? trackUnitToken : layoutState.trackUnit);
    const trackUnitSource = trackUnitToken != null ? 'layout-override' : 'state';

    const layoutForCompile = {};
    let inheritedRows = null;
    for (const key of BREAKPOINTS) {
      const overrideValue = overrideSectionValues[key];
      const overrideObject = overrideSectionObjects[key];
      const sectionDefined = Boolean(overrideLayout && hasOwn(overrideLayout, key));
      const explicitRowsKey = Boolean(overrideObject && Object.prototype.hasOwnProperty.call(overrideObject, 'rows'));

      if (hasRowConfig(overrideValue)) {
        inheritedRows = overrideValue;
        layoutForCompile[key] = overrideValue;
        continue;
      }

      if (!sectionDefined && inheritedRows) {
        layoutForCompile[key] = inheritedRows;
        continue;
      }

      if (sectionDefined && !explicitRowsKey && inheritedRows) {
        layoutForCompile[key] = inheritedRows;
        continue;
      }

      const defaultSection = DEFAULT_LAYOUT[key] || DEFAULT_LAYOUT.desktop;
      const defaultRows = hasRowConfig(defaultSection) ? defaultSection : DEFAULT_LAYOUT.desktop;
      inheritedRows = defaultRows;
      layoutForCompile[key] = defaultRows;
    }
    const compiled = compileLayoutTemplates(layoutForCompile, { trackUnit });
    const normalizedAreas = {
      desktop: normalizeTemplateAreas(compiled.desktop.areas),
      tablet: normalizeTemplateAreas(compiled.tablet.areas),
      mobile: normalizeTemplateAreas(compiled.mobile.areas)
    };

    const desktopSection = overrideSectionObjects.desktop;
    const tabletSection = overrideSectionObjects.tablet;
    const mobileSection = overrideSectionObjects.mobile;
    const hasDesktopOverride = Boolean(overrideLayout && hasOwn(overrideLayout, 'desktop'));
    const hasTabletOverride = Boolean(overrideLayout && hasOwn(overrideLayout, 'tablet'));
    const hasMobileOverride = Boolean(overrideLayout && hasOwn(overrideLayout, 'mobile'));

    const desktopColumnsRaw = sanitizeColumns(desktopSection?.columns, DEFAULT_COLUMNS.desktop, trackUnit);
    const tabletColumnsRaw = sanitizeColumns(
      tabletSection?.columns,
      hasTabletOverride ? desktopColumnsRaw : hasDesktopOverride ? desktopColumnsRaw : DEFAULT_COLUMNS.tablet,
      trackUnit
    );
    const mobileColumnsRaw = sanitizeColumns(
      mobileSection?.columns,
      hasMobileOverride
        ? tabletColumnsRaw
        : hasTabletOverride || hasDesktopOverride
          ? tabletColumnsRaw
          : DEFAULT_COLUMNS.mobile,
      trackUnit
    );

    const desktopGap = sanitizeGap(desktopSection?.gap, DEFAULT_GAPS.desktop);
    const tabletGap = sanitizeGap(
      tabletSection?.gap,
      hasTabletOverride ? desktopGap : hasDesktopOverride ? desktopGap : DEFAULT_GAPS.tablet
    );
    const mobileGap = sanitizeGap(
      mobileSection?.gap,
      hasMobileOverride
        ? tabletGap
        : hasTabletOverride || hasDesktopOverride
          ? tabletGap
          : DEFAULT_GAPS.mobile
    );
    const gaps = {
      desktop: desktopGap,
      tablet: tabletGap,
      mobile: mobileGap
    };

    const fallbackWidth = sanitizeDimension(overrideLayout?.baseWidth, measuredWidth);
    const fallbackHeight = sanitizeDimension(overrideLayout?.baseHeight, measuredHeight);
    const desktopWidth = sanitizeDimension(desktopSection?.baseWidth, fallbackWidth);
    const desktopHeight = sanitizeDimension(desktopSection?.baseHeight, fallbackHeight);
    const tabletWidth = sanitizeDimension(tabletSection?.baseWidth, desktopWidth);
    const tabletHeight = sanitizeDimension(tabletSection?.baseHeight, desktopHeight);
    const mobileWidth = sanitizeDimension(mobileSection?.baseWidth, tabletWidth);
    const mobileHeight = sanitizeDimension(mobileSection?.baseHeight, tabletHeight);

    const baseDimensions = {
      desktop: { width: desktopWidth, height: desktopHeight },
      tablet: { width: tabletWidth, height: tabletHeight },
      mobile: { width: mobileWidth, height: mobileHeight }
    };

    const desktopBaseSource = {
      width: determineDimensionSource({
        sectionValue: desktopSection?.baseWidth,
        fallbackValue: overrideLayout?.baseWidth,
        measurementValue: measurement.width
      }),
      height: determineDimensionSource({
        sectionValue: desktopSection?.baseHeight,
        fallbackValue: overrideLayout?.baseHeight,
        measurementValue: measurement.height
      })
    };

    const tabletBaseSource = {
      width: parseDimensionValue(tabletSection?.baseWidth) != null
        ? 'section-override'
        : `inherit-${desktopBaseSource.width}`,
      height: parseDimensionValue(tabletSection?.baseHeight) != null
        ? 'section-override'
        : `inherit-${desktopBaseSource.height}`
    };

    const mobileBaseSource = {
      width: parseDimensionValue(mobileSection?.baseWidth) != null
        ? 'section-override'
        : `inherit-${tabletBaseSource.width}`,
      height: parseDimensionValue(mobileSection?.baseHeight) != null
        ? 'section-override'
        : `inherit-${tabletBaseSource.height}`
    };

    const baseSourceMap = {
      desktop: desktopBaseSource,
      tablet: tabletBaseSource,
      mobile: mobileBaseSource
    };

    const baseWidth = desktopWidth;
    const baseHeight = desktopHeight;

    let desktopColumns = desktopColumnsRaw;
    let tabletColumns = tabletColumnsRaw;
    let mobileColumns = mobileColumnsRaw;

    let desktopRows = compiled.desktop.rows;
    let tabletRows = compiled.tablet.rows;
    let mobileRows = compiled.mobile.rows;

    const percentCollector = trackUnit === 'percent' ? createPercentDiagnosticsCollector() : null;

    if (trackUnit === 'percent') {
      const adjustedDesktopColumns = adjustPercentColumnTracks(
        desktopColumns,
        baseDimensions.desktop.width,
        desktopGap,
        desktopGap,
        percentCollector && { collector: percentCollector, breakpoint: 'desktop' }
      );
      if (adjustedDesktopColumns) desktopColumns = adjustedDesktopColumns;

      const adjustedTabletColumns = adjustPercentColumnTracks(
        tabletColumns,
        baseDimensions.tablet.width,
        tabletGap,
        tabletGap,
        percentCollector && { collector: percentCollector, breakpoint: 'tablet' }
      );
      if (adjustedTabletColumns) tabletColumns = adjustedTabletColumns;

      const adjustedMobileColumns = adjustPercentColumnTracks(
        mobileColumns,
        baseDimensions.mobile.width,
        mobileGap,
        mobileGap,
        percentCollector && { collector: percentCollector, breakpoint: 'mobile' }
      );
      if (adjustedMobileColumns) mobileColumns = adjustedMobileColumns;

      const adjustedDesktopRows = adjustPercentRowTracks(
        desktopRows,
        compiled.desktop.rowCount,
        baseDimensions.desktop.height,
        desktopGap,
        desktopGap,
        percentCollector && { collector: percentCollector, breakpoint: 'desktop' }
      );
      if (adjustedDesktopRows) desktopRows = adjustedDesktopRows;

      const adjustedTabletRows = adjustPercentRowTracks(
        tabletRows,
        compiled.tablet.rowCount,
        baseDimensions.tablet.height,
        tabletGap,
        tabletGap,
        percentCollector && { collector: percentCollector, breakpoint: 'tablet' }
      );
      if (adjustedTabletRows) tabletRows = adjustedTabletRows;

      const adjustedMobileRows = adjustPercentRowTracks(
        mobileRows,
        compiled.mobile.rowCount,
        baseDimensions.mobile.height,
        mobileGap,
        mobileGap,
        percentCollector && { collector: percentCollector, breakpoint: 'mobile' }
      );
      if (adjustedMobileRows) mobileRows = adjustedMobileRows;
    }

    const columns = {
      desktop: desktopColumns,
      tablet: tabletColumns,
      mobile: mobileColumns
    };

    const finalTemplates = {
      desktop: { ...compiled.desktop, rows: desktopRows },
      tablet: { ...compiled.tablet, rows: tabletRows },
      mobile: { ...compiled.mobile, rows: mobileRows }
    };

    const signature = JSON.stringify({
      trackUnit,
      baseDimensions,
      columns,
      gaps,
      templates: {
        desktop: { rows: finalTemplates.desktop.rows, areas: finalTemplates.desktop.areas },
        tablet: { rows: finalTemplates.tablet.rows, areas: finalTemplates.tablet.areas },
        mobile: { rows: finalTemplates.mobile.rows, areas: finalTemplates.mobile.areas }
      }
    });

    layoutState.normalizedAreas = normalizedAreas;
    const changed = layoutState.signature !== signature;
    if (changed) {
      layoutState.signature = signature;
      layoutState.baseWidth = baseWidth;
      layoutState.baseHeight = baseHeight;
      layoutState.baseDimensions = baseDimensions;
      layoutState.columns = columns;
      layoutState.gaps = gaps;
      layoutState.templates = finalTemplates;
      layoutState.trackUnit = trackUnit;
      layoutState.pendingApply = true;
    }

    if (!changed && !layoutState.pendingApply) return;

    const activeBase = getActiveBaseDimensions(baseDimensions);
    currentBaseWidth = activeBase.width;
    currentBaseHeight = activeBase.height;

    root.style.setProperty('--wdash-base-width', `${currentBaseWidth}px`);
    root.style.setProperty('--wdash-base-height', `${currentBaseHeight}px`);

    dash.style.setProperty('--wdash-grid-columns-desktop', columns.desktop);
    dash.style.setProperty('--wdash-grid-columns-tablet', columns.tablet);
    dash.style.setProperty('--wdash-grid-columns-mobile', columns.mobile);
    dash.style.setProperty('--wdash-grid-rows-desktop', finalTemplates.desktop.rows);
    dash.style.setProperty('--wdash-grid-rows-tablet', finalTemplates.tablet.rows);
    dash.style.setProperty('--wdash-grid-rows-mobile', finalTemplates.mobile.rows);
    dash.style.setProperty('--wdash-grid-areas-desktop', finalTemplates.desktop.areas);
    dash.style.setProperty('--wdash-grid-areas-tablet', finalTemplates.tablet.areas);
    dash.style.setProperty('--wdash-grid-areas-mobile', finalTemplates.mobile.areas);
    dash.style.setProperty('--wdash-grid-gap-desktop', gaps.desktop);
    dash.style.setProperty('--wdash-grid-gap-tablet', gaps.tablet);
    dash.style.setProperty('--wdash-grid-gap-mobile', gaps.mobile);
    dash.style.setProperty('--wdash-frame-gap-desktop', gaps.desktop);
    dash.style.setProperty('--wdash-frame-gap-tablet', gaps.tablet);
    dash.style.setProperty('--wdash-frame-gap-mobile', gaps.mobile);

    applyLayoutStyle({
      baseWidth,
      baseHeight,
      baseDimensions,
      columns,
      gaps,
      templates: finalTemplates
    });

    applyScale(root);

    const gridEl = dash.querySelector('.wdash-grid');
    if (gridEl) {
      layoutState.pendingApply = false;
    } else {
      layoutState.pendingApply = true;
    }

    const diagnosticsContext = buildLayoutDiagnosticsContext({
      hostElement,
      measurement,
      measuredWidth,
      measuredHeight,
      baseWidth,
      baseHeight,
      baseDimensions,
      baseSourceMap,
      trackUnit,
      trackUnitSource,
      gaps,
      columnsRaw: {
        desktop: desktopColumnsRaw,
        tablet: tabletColumnsRaw,
        mobile: mobileColumnsRaw
      },
      columnsApplied: columns,
      rowsRaw: {
        desktop: compiled.desktop.rows,
        tablet: compiled.tablet.rows,
        mobile: compiled.mobile.rows
      },
      rowsApplied: {
        desktop: finalTemplates.desktop.rows,
        tablet: finalTemplates.tablet.rows,
        mobile: finalTemplates.mobile.rows
      },
      rowCounts: {
        desktop: compiled.desktop.rowCount,
        tablet: compiled.tablet.rowCount,
        mobile: compiled.mobile.rowCount
      },
      percentCollector,
      activeBreakpoint: getActiveBreakpoint()
    });

    layoutState.lastDiagnostics = diagnosticsContext;
    logLayoutDiagnostics(diagnosticsContext);

    const hasLightningArea = templateHasArea(finalTemplates.desktop, 'lightning')
      || templateHasArea(finalTemplates.tablet, 'lightning')
      || templateHasArea(finalTemplates.mobile, 'lightning');
    if (hasLightningArea) {
      dash.dataset.layoutHasLightning = 'true';
    } else if (dash.dataset.layoutHasLightning) {
      delete dash.dataset.layoutHasLightning;
    }
  }

  function ensureDataTileObservers() {
    const tiles = Array.from(document.querySelectorAll('[id^="tile-"]'));
    const seen = new Set();
    let needsRender = false;

    for (const tile of tiles) {
      const id = tile?.id;
      if (!id || id === DISPLAY_TILE_ID) continue;
      seen.add(id);
      const existing = dataTileObservers.get(id);
      if (existing && existing.tile === tile) continue;
      if (existing) {
        existing.observer.disconnect();
      }
      const observer = new MutationObserver(debounce(safeRenderFromData, 150));
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

  function setupScaling(displayTile, content) {
    const root = content.querySelector('.wdash-root');
    if (!root) return;
    applyScale(root);
    if (!scaleResizeHandler) {
      scaleResizeHandler = () => applyScale();
      window.addEventListener('resize', scaleResizeHandler);
    }
    setupBreakpointListeners();
    if (typeof ResizeObserver !== 'function') return;
    if (scaleObserver) {
      scaleObserver.disconnect();
    }
    scaleObserver = new ResizeObserver(() => {
      const measurement = resolveMeasuredBaseDimensions();
      if (measurement.changed) {
        layoutState.pendingApply = true;
        applyLayoutOverrides(lastSuccessfulPayload?.metadata);
      }
      applyScale(root);
    });
    scaleObserver.observe(displayTile);
  }

  function setupBreakpointListeners() {
    if (breakpointListenersRegistered) return;
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const handler = () => applyScale();
    const queries = ['(max-width: 720px)', '(max-width: 1100px)'];
    let attached = false;
    for (const query of queries) {
      let mql = null;
      try {
        mql = window.matchMedia(query);
      } catch (err) {
        mql = null;
      }
      if (!mql) continue;
      if (typeof mql.addEventListener === 'function') {
        mql.addEventListener('change', handler);
        attached = true;
      } else if (typeof mql.addListener === 'function') {
        mql.addListener(handler);
        attached = true;
      }
    }
    if (attached) {
      breakpointListenersRegistered = true;
    }
  }

  function normalizeDimensionEntry(entry, fallback) {
    const fallbackWidth = Number(fallback?.width) || DEFAULT_BASE_WIDTH;
    const fallbackHeight = Number(fallback?.height) || DEFAULT_BASE_HEIGHT;
    return {
      width: Number(entry?.width) || fallbackWidth,
      height: Number(entry?.height) || fallbackHeight
    };
  }

  function getActiveBreakpoint() {
    const grid = document.querySelector('#' + DISPLAY_TILE_ID + ' .wdash-grid');
    if (grid && typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
      try {
        const computed = window.getComputedStyle(grid);
        const areasValue = computed.getPropertyValue('grid-template-areas');
        const normalized = normalizeTemplateAreas(areasValue);
        if (normalized && normalized !== 'none') {
          const lookup = layoutState.normalizedAreas || DEFAULT_NORMALIZED_AREAS;
          const matches = [];
          if (normalized === lookup.mobile) matches.push('mobile');
          if (normalized === lookup.tablet) matches.push('tablet');
          if (normalized === lookup.desktop) matches.push('desktop');
          if (matches.length === 1) {
            return matches[0];
          }
        }
      } catch (err) {
        /* ignore */
      }
    }
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return 'desktop';
    }
    if (window.matchMedia('(max-width: 720px)').matches) {
      return 'mobile';
    }
    if (window.matchMedia('(max-width: 1100px)').matches) {
      return 'tablet';
    }
    return 'desktop';
  }

  function getActiveBaseDimensions(dimensionsOverride) {
    const source = dimensionsOverride || layoutState.baseDimensions || DEFAULT_BASE_DIMENSIONS;
    const desktop = normalizeDimensionEntry(source.desktop, DEFAULT_BASE_DIMENSIONS.desktop);
    const tablet = normalizeDimensionEntry(source.tablet, desktop);
    const mobile = normalizeDimensionEntry(source.mobile, tablet);
    const breakpoint = getActiveBreakpoint();
    if (breakpoint === 'mobile') return mobile;
    if (breakpoint === 'tablet') return tablet;
    return desktop;
  }

  function applyScale(rootEl) {
    const root = rootEl || document.querySelector('#' + DISPLAY_TILE_ID + ' .wdash-root');
    if (!root) return;
    const rect = root.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    if (!width || !height) return;
    const activeBase = getActiveBaseDimensions();
    const baseWidth = Math.max(1, Number(activeBase?.width) || Number(currentBaseWidth) || DEFAULT_BASE_WIDTH);
    const baseHeight = Math.max(1, Number(activeBase?.height) || Number(currentBaseHeight) || DEFAULT_BASE_HEIGHT);
    currentBaseWidth = baseWidth;
    currentBaseHeight = baseHeight;
    root.style.setProperty('--wdash-base-width', `${baseWidth}px`);
    root.style.setProperty('--wdash-base-height', `${baseHeight}px`);
    const rawScale = Math.min(width / baseWidth, height / baseHeight);
    const scale = Math.max(0.1, Math.min(rawScale, 1));
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

    const result = {};
    const ambientSensors = [];
    const ambientMeta = {
      total: null,
      rotation: null,
      tempUnit: null,
      humidityUnit: null
    };
    let layout = null;

    for (const segment of payloads) {
      if (!segment || typeof segment !== 'object') continue;

      if (Array.isArray(segment.ambientSensors)) {
        const total = Number(segment.totalAmbientSensors);
        if (Number.isFinite(total)) ambientMeta.total = total;
        if (segment.ambientRotationSeconds != null) ambientMeta.rotation = segment.ambientRotationSeconds;
        if (segment.ambientTemperatureUnit != null) ambientMeta.tempUnit = segment.ambientTemperatureUnit;
        if (segment.ambientHumidityUnit != null) ambientMeta.humidityUnit = segment.ambientHumidityUnit;

        segment.ambientSensors.forEach(sensor => {
          if (sensor && typeof sensor === 'object') {
            ambientSensors.push({ ...sensor });
          }
        });
      }

      for (const [key, value] of Object.entries(segment)) {
        if (
          key === 'ambientSensors' ||
          key === 'totalAmbientSensors' ||
          key === 'ambientRotationSeconds' ||
          key === 'ambientTemperatureUnit' ||
          key === 'ambientHumidityUnit' ||
          key === 'segmentIndex' ||
          key === 'segmentSize'
        ) {
          continue;
        }

        if (key === 'metadata' && isPlainObject(value)) {
          result.metadata = deepMerge(result.metadata || {}, value);
        } else if (key === 'layout' && isPlainObject(value)) {
          layout = layout ? deepMerge(layout, value) : { ...value };
        } else if (key === 'outlook24h' && isPlainObject(value)) {
          result.outlook24h = value;
        } else if (KNOWN_PAYLOAD_KEYS.has(key)) {
          result[key] = value;
        }
      }
    }

    if (ambientSensors.length) {
      ambientSensors.sort((a, b) => {
        const aOrdinal = Number(a?.ordinal);
        const bOrdinal = Number(b?.ordinal);
        if (Number.isFinite(aOrdinal) && Number.isFinite(bOrdinal)) {
          return aOrdinal - bOrdinal;
        }
        return 0;
      });
      result.ambientSensors = ambientSensors.map(sensor => ({ ...sensor }));
    }

    if (ambientMeta.rotation != null) result.ambientRotationSeconds = ambientMeta.rotation;
    if (ambientMeta.tempUnit != null) result.ambientTemperatureUnit = ambientMeta.tempUnit;
    if (ambientMeta.humidityUnit != null) result.ambientHumidityUnit = ambientMeta.humidityUnit;
    if (Number.isFinite(ambientMeta.total)) result.totalAmbientSensors = ambientMeta.total;

    if (layout) {
      result.metadata = result.metadata || {};
      result.metadata.layout = layout;
    }

    return Object.keys(result).length ? result : null;
  }

  function resolveAmbientSensors(data) {
    const sensors = Array.isArray(data?.ambientSensors) ? data.ambientSensors.filter(Boolean) : [];
    if (sensors.length) return sensors;

    const indoor = data?.indoor;
    if (!indoor || typeof indoor !== 'object') return sensors;

    const hasTemp = Number.isFinite(toNumber(indoor.temperatureF)) || Number.isFinite(toNumber(indoor.temperatureC));
    const hasHumidity = Number.isFinite(toNumber(indoor.humidity));
    if (!hasTemp && !hasHumidity) return sensors;

    const fallback = { ...indoor };
    const rawName = fallback.name != null ? String(fallback.name) : '';
    const trimmedName = rawName.trim();
    fallback.name = trimmedName.length ? trimmedName : 'Indoor';

    return [fallback];
  }

  function resolveAmbientSeedState(data) {
    const sensors = resolveAmbientSensors(data);
    if (!sensors.length) return null;

    const normalizedSensors = sensors.map((sensor, index) => ({ sensor, index }));
    const desiredKeys = [];

    const previousSensor = Array.isArray(ambientRotation.sensors)
      ? ambientRotation.sensors[ambientRotation.index] || null
      : null;
    if (previousSensor) {
      const prevKey = getAmbientSensorKey(previousSensor, ambientRotation.index);
      if (prevKey) desiredKeys.push(prevKey);
      if (previousSensor.name != null) {
        const prevNameKey = getAmbientNameKey(previousSensor.name);
        if (prevNameKey) desiredKeys.push(prevNameKey);
      }
    }

    if (ambientLastDisplayedHumidity.key) {
      desiredKeys.push(ambientLastDisplayedHumidity.key);
    }

    let index = Number.isInteger(ambientRotation.index) ? ambientRotation.index : 0;
    if (index < 0) index = 0;
    if (index >= normalizedSensors.length) index = normalizedSensors.length - 1;

    if (desiredKeys.length) {
      const keySet = new Set(desiredKeys.filter(Boolean).map(key => String(key).trim()).filter(Boolean));
      const match = normalizedSensors.find(item => {
        const key = getAmbientSensorKey(item.sensor, item.index);
        if (key && keySet.has(key)) return true;
        if (item.sensor && item.sensor.name != null) {
          const nameKey = getAmbientNameKey(item.sensor.name);
          if (nameKey && keySet.has(nameKey)) return true;
        }
        return false;
      });
      if (match) {
        index = match.index;
      }
    }

    const active = normalizedSensors[index] || normalizedSensors[0];
    const sensorKey = getAmbientSensorKey(active.sensor, active.index);
    let humidity = Number.isFinite(active.sensor?.humidity) ? active.sensor.humidity : null;
    if (!Number.isFinite(humidity)) {
      const cached = lookupAmbientCachedHumidity(active.sensor, sensorKey, active.sensor?.name);
      if (Number.isFinite(cached)) humidity = cached;
    }

    return {
      index: active.index,
      sensorKey: sensorKey || null,
      humidity: Number.isFinite(humidity) ? humidity : null
    };
  }

    function buildCardMarkupList(data, options) {
      const opts = options && typeof options === 'object' ? options : {};
      return CARD_RENDERERS.map(card => ({
        key: card.key,
        selector: card.selector,
        markup: card.build(data, opts)
      }));
    }

    function createElementFromMarkup(markup) {
      if (typeof markup !== 'string' || !markup.trim().length) return null;
      const template = document.createElement('div');
      template.innerHTML = markup.trim();
      return template.firstElementChild || null;
    }

    function ensureCardPresence(grid, card, cardMarkupList) {
      if (!grid || !card) return null;
      let existing = grid.querySelector(card.selector);
      if (existing) return existing;

      const element = createElementFromMarkup(card.markup);
      if (!element) return null;

      const insertionIndex = renderState.order.indexOf(card.key);
      let anchor = null;
      for (let idx = insertionIndex + 1; idx < renderState.order.length; idx += 1) {
        const nextKey = renderState.order[idx];
        const nextCard = cardMarkupList.find(item => item.key === nextKey);
        if (!nextCard) continue;
        const node = grid.querySelector(nextCard.selector);
        if (node) {
          anchor = node;
          break;
        }
      }

      if (anchor) {
        grid.insertBefore(element, anchor);
      } else {
        grid.appendChild(element);
      }

      return element;
    }

    function replaceCardMarkup(grid, card, cardMarkupList) {
      const existing = ensureCardPresence(grid, card, cardMarkupList);
      if (!existing) return;
      const replacement = createElementFromMarkup(card.markup);
      if (!replacement) return;
      existing.replaceWith(replacement);
    }

  function buildTempWindCard(data) {
    const outdoor = data.outdoor || {};
    const tempPair = resolveTemperaturePair(outdoor.temperatureF, outdoor.temperatureC);
    const highPair = resolveTemperaturePair(outdoor.dailyHighF, outdoor.dailyHighC);
    const lowPair = resolveTemperaturePair(outdoor.dailyLowF, outdoor.dailyLowC);
    const feelsPair = resolveTemperaturePair(outdoor.feelsLikeF, outdoor.feelsLikeC);
    const dewPair = resolveTemperaturePair(outdoor.dewPointF, outdoor.dewPointC);
    const humidity = toNumber(outdoor.humidity);
    const trendPair = resolveTemperatureDelta(outdoor.trendFPerHour, outdoor.trendCPerHour);

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

    const tempF = tempPair.f;
    const tempColor = colorForTemp(tempF);
    const indicator = gaugeIndicator(tempF);
    const dewText = formatTemperature(dewPair.f);
    const humidityText = formatPercent(humidity, 0);
    const trendSuffix = `°${getDisplayTemperatureUnit()}/hr`;
    const trendText = formatSigned(convertTemperatureDelta(trendPair.f, 'F', getDisplayTemperatureUnit()), 1, trendSuffix);
    const feelsText = formatTemperature(feelsPair.f);
    const highText = formatTemperature(highPair.f);
    const lowText = formatTemperature(lowPair.f);
    const gustText = Number.isFinite(gust) ? `${formatNumber(gust, 1)} mph` : '--';
    const avgSpeedText = Number.isFinite(avgSpeed) ? `${formatNumber(avgSpeed, 1)} mph` : '--';
    const avgCombinedText = `${avgDirText || '--'} ${avgSpeedText}`;
    const dailyMaxGustText = Number.isFinite(dailyMaxGust) ? `${formatNumber(dailyMaxGust, 1)} mph` : '--';

    const mainTempText = formatTemperature(tempF);
    const currentDisplayUnit = getDisplayTemperatureUnit();
    const indicatorAltUnit = getOppositeTemperatureUnit(currentDisplayUnit);
    const indicatorLabelUnit = describeTemperatureUnit(indicatorAltUnit) || indicatorAltUnit;
    const indicatorLabel = indicatorLabelUnit
      ? `Switch temperature display to ${indicatorLabelUnit}`
      : 'Switch temperature display';

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
      <section class="wdash-card wdash-card--temp-wind">
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
                  <span class="wdash-gauge-value">
                    <span class="wdash-gauge-value-number">${mainTempText}</span>
                  </span>
                  <button type="button" class="wdash-temp-unit-indicator wdash-temp-unit-indicator--gauge" data-temp-unit-indicator="true" aria-label="${escapeHtml(indicatorLabel)}" title="${escapeHtml(indicatorLabel)}">${escapeHtml(currentDisplayUnit)}</button>
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

  function buildAmbientSensorCard(data, seedOptions) {
    const sensors = resolveAmbientSensors(data);
    const hasSensors = sensors.length > 0;
    const seed = seedOptions && typeof seedOptions === 'object' ? seedOptions : null;
    let index = hasSensors ? 0 : -1;
    if (hasSensors && seed && Number.isInteger(seed.index)) {
      index = Math.max(0, Math.min(sensors.length - 1, seed.index));
    }
    const sensor = index >= 0 ? sensors[index] || {} : {};
    const tempPair = resolveTemperaturePair(sensor.temperatureF, sensor.temperatureC);
    const humidityUnit = data.ambientHumidityUnit || '%';
    const sensorName = typeof sensor.name === 'string' ? sensor.name.trim() : '';
    const nameDisplay = hasSensors
      ? (sensorName.length ? sensorName : 'Ambient Sensor')
      : 'Ambient Sensors';
    const rotationText = hasSensors
      ? (sensors.length > 1 ? `Sensor ${index + 1} of ${sensors.length}` : '')
      : 'No sensors configured';
    const tempDisplay = formatTemperature(tempPair.f, { includeUnit: true });
    const humiditySource = Number.isFinite(sensor.humidity)
      ? sensor.humidity
      : (seed && Number.isFinite(seed.humidity) ? seed.humidity : null);
    const humidityDisplay = formatAmbientValue(humiditySource, humidityUnit, 0);
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
    const nextDisabledAttr = sensors.length > 1 ? '' : ' disabled';
    const nextLabel = sensors.length > 1 ? 'Show next ambient sensor' : 'Ambient sensor rotation unavailable';

    const sensorKey = getAmbientSensorKey(sensor, index >= 0 ? index : 0) || (seed && seed.sensorKey) || '';
    const keyAttr = sensorKey ? ` data-active-sensor-key="${escapeHtml(sensorKey)}"` : '';

    const humidityCircumference = Math.round(2 * Math.PI * AMBIENT_RING.r);
    let humidityValue = null;
    if (seed && Number.isFinite(seed.humidity)) {
      humidityValue = clamp(seed.humidity, 0, 100);
    } else {
      const cachedHumidity = lookupAmbientCachedHumidity(sensor, sensorKey, nameDisplay);
      if (Number.isFinite(cachedHumidity)) humidityValue = clamp(cachedHumidity, 0, 100);
    }
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
          <div class="wdash-ambient-header-meta">
            <span class="wdash-ambient-rotation">${escapeHtml(rotationText)}</span>
            ${batterySlot}
          </div>
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
              <button type="button" class="wdash-ambient-next" aria-label="${escapeHtml(nextLabel)}" title="${escapeHtml(nextLabel)}"${nextDisabledAttr}>
                <svg class="wdash-ambient-next-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M9 6l8 6-8 6V6z" fill="currentColor" />
                </svg>
              </button>
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
            <svg viewBox="0 0 120 160" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Rain rate visualization">
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
    const headerSummary = (() => {
      const source = outlook.shortSummary || outlook.summary || outlook.text;
      const limited = truncateText(source, 40);
      return limited || '';
    })();
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
        ${cardHeader(
          CARD_TITLES.pressure,
          data,
          headerSummary || null,
          { fallbackToRelative: !headerSummary }
        )}
        <div class="wdash-pressure">
          <div class="wdash-pressure-main">
            <div class="wdash-pressure-band">
              <div class="wdash-pressure-band-cell">
                <div class="wdash-pressure-toggle" role="group" aria-label="Barometer mode">
                  <button type="button" class="wdash-pressure-button${mode === 'relative' ? ' is-active' : ''}" data-pressure-mode="relative" aria-pressed="${mode === 'relative'}" aria-label="Relative">Rel</button>
                  <button type="button" class="wdash-pressure-button${mode === 'absolute' ? ' is-active' : ''}" data-pressure-mode="absolute" aria-pressed="${mode === 'absolute'}" aria-label="Absolute">Abs</button>
                </div>
              </div>
              <div class="wdash-pressure-band-cell">
                <div class="wdash-pressure-reading-wrap">
                  <div class="wdash-pressure-reading">
                    <span class="wdash-pressure-value" data-pressure-value="relative">${relative}</span>
                    <span class="wdash-pressure-value" data-pressure-value="absolute">${absolute}</span>
                  </div>
                </div>
              </div>
              <div class="wdash-pressure-band-cell">
                ${buildPressureOutlookBadge(outlook)}
              </div>
            </div>
            ${buildMetricRow(stats, 'wdash-pressure-stats')}
          </div>
        </div>
      </section>
    `;
  }

  function buildPressureOutlookBadge(outlook) {
    const iconKey = typeof outlook?.iconKey === 'string' ? outlook.iconKey.trim().toLowerCase() : '';
    const iconLabel = (() => {
      const raw = outlook?.iconLabel || outlook?.category || outlook?.label;
      if (raw == null) return '';
      const str = typeof raw === 'string' ? raw : String(raw);
      return str.trim();
    })();
    const summary = (() => {
      const raw = outlook?.summary || outlook?.text;
      if (raw == null) return '';
      const str = typeof raw === 'string' ? raw : String(raw);
      return str.trim();
    })();
    const titleParts = [];
    if (iconLabel) titleParts.push(iconLabel);
    if (summary) titleParts.push(summary);
    const title = titleParts.join(' — ');
    const svg = iconKey ? PRESSURE_OUTLOOK_ICONS[iconKey] : null;
    if (svg) {
      const ariaLabel = escapeHtml(title || iconLabel || 'Barometer outlook');
      const dataAttr = iconKey ? ` data-outlook-key="${escapeHtml(iconKey)}"` : '';
      return `
        <span class="wdash-pressure-outlook-icon" role="img" aria-label="${ariaLabel}"${dataAttr}>
          ${svg}
        </span>
      `;
    }
    const fallbackText = iconLabel || summary || 'Outlook';
    return `<span class="wdash-pressure-outlook-label">${escapeHtml(fallbackText)}</span>`;
  }

  function getSolarStaticLayout() {
    if (solarStaticLayoutCache) return solarStaticLayoutCache;
    const arc = SUN_CARD_GEOMETRY;
    const startPoint = getPointOnArc(arc, 0);
    const endPoint = getPointOnArc(arc, 1);
    solarStaticLayoutCache = {
      arcPath: `M ${startPoint.x} ${startPoint.y} A ${arc.r} ${arc.r} 0 0 1 ${endPoint.x} ${endPoint.y}`,
      uvStyle: `left: ${SUN_CARD_METRIC_POSITIONS.uv.left}%; top: ${SUN_CARD_METRIC_POSITIONS.uv.top}%;`,
      solarStyle: `left: ${SUN_CARD_METRIC_POSITIONS.solar.left}%; top: ${SUN_CARD_METRIC_POSITIONS.solar.top}%;`,
      moonStyle: `left: ${SUN_CARD_METRIC_POSITIONS.moon.left}%; top: ${SUN_CARD_METRIC_POSITIONS.moon.top}%;`,
      sunriseStyle: `left: ${startPoint.x / 2}%; top: ${startPoint.y}%`,
      sunsetStyle: `left: ${endPoint.x / 2}%; top: ${endPoint.y}%`
    };
    return solarStaticLayoutCache;
  }

  function resolveSolarSunViewModel(data) {
    const solar = data?.solar || {};
    const moon = solar.moon || {};
    const uvIndex = toNumber(solar.uvIndex);
    const solarRadiation = toNumber(solar.solarRadiationWm2);
    const uvIndexDisplay = Number.isFinite(uvIndex) ? formatNumber(uvIndex, 1) : null;
    const uvDangerRaw = (() => {
      const raw = solar.uvDanger;
      if (raw == null) return null;
      const text = typeof raw === 'string' ? raw : String(raw);
      const trimmed = text.trim();
      return trimmed ? trimmed : null;
    })();
    const hasUvDanger = Boolean(uvDangerRaw);
    const dayUvColor = sanitizeHexColor(solar.uvColor);
    const now = parseDateTime(data?.metadata?.generatedAt);
    const progress = sunProgress(solar, now);
    const isDay = Number.isFinite(progress) && progress >= 0 && progress <= 1;
    const uvDangerTint = hasUvDanger ? (isDay ? (dayUvColor || null) : 'transparent') : null;
    const sunPoint = getPointOnArc(SUN_CARD_GEOMETRY, progress);
    const layout = getSolarStaticLayout();

    let illuminationPercent = toNumber(moon.illuminationPercent);
    if (!Number.isFinite(illuminationPercent)) {
      const fraction = toNumber(moon.illuminationFraction);
      if (Number.isFinite(fraction)) illuminationPercent = fraction * 100;
    }
    const illuminationText = Number.isFinite(illuminationPercent) ? formatPercent(illuminationPercent, 0) : '--';

    const moonPhaseKey = normalizeMoonPhaseKey(moon) || DEFAULT_MOON_PHASE_KEY;
    const moonPhaseName = moon.phase || 'Unknown';
    const moonHemisphere = (moon.hemisphere || '').toLowerCase() === 'southern' ? 'southern' : 'northern';
    const moonAriaParts = [];
    if (moonPhaseName && moonPhaseName !== 'Unknown') moonAriaParts.push(moonPhaseName);
    if (Number.isFinite(illuminationPercent)) {
      moonAriaParts.push(`${illuminationPercent.toFixed(0)}% illuminated`);
    }
    const moonAriaLabel = moonAriaParts.length ? `Moon phase: ${moonAriaParts.join(', ')}` : 'Moon phase unavailable';

    const stationReportedAt = data?.metadata?.weatherStationTime || data?.metadata?.generatedAt;
    const stationLabel = stationReportedAt ? formatHubDateTime(stationReportedAt) : null;
    const stationZoneLabel = (() => {
      const zone = data?.metadata?.weatherStationTimezone;
      if (!zone) return '';
      const text = typeof zone === 'string' ? zone.trim() : String(zone);
      return text;
    })();

    return {
      layout,
      showUvMetric: Boolean(uvIndexDisplay || hasUvDanger),
      uvValueDisplay: (() => {
        if (uvIndexDisplay) return uvIndexDisplay;
        if (hasUvDanger) return uvDangerRaw;
        return '';
      })(),
      uvValueColor: uvIndexDisplay ? null : uvDangerTint,
      showUvSubvalue: Boolean(uvIndexDisplay && hasUvDanger),
      uvSubvalueDisplay: uvIndexDisplay && hasUvDanger ? uvDangerRaw : '',
      uvSubvalueColor: uvIndexDisplay && hasUvDanger ? uvDangerTint : null,
      solarDisplay: Number.isFinite(solarRadiation) ? formatNumber(solarRadiation, 0) : '',
      showSolarMetric: Number.isFinite(solarRadiation),
      solarUnit: 'W/m²',
      moonPhaseKey,
      moonPhaseName,
      moonHemisphere,
      moonAriaLabel,
      illuminationText,
      sunriseText: formatTime(solar.sunrise),
      sunsetText: formatTime(solar.sunset),
      sunPoint,
      isDay,
      arcPath: layout.arcPath,
      stationLabel,
      stationZoneLabel,
      stationReportedAt
    };
  }

  function resolveSunMarkerState(view) {
    if (!view) return null;
    const point = view.sunPoint || {};
    const formatCoord = (value, fallback) => {
      const base = Number.isFinite(fallback) ? fallback : 0;
      const chosen = Number.isFinite(value) ? value : base;
      return String(Math.round(chosen * 1000) / 1000);
    };
    const cx = formatCoord(point.x, SUN_CARD_GEOMETRY.cx);
    const cy = formatCoord(point.y, SUN_CARD_GEOMETRY.cy);
    const className = `wdash-sun-marker ${view.isDay ? 'is-day' : 'is-night'}`;
    const markup = `
      <g class="${className}">
        <circle class="wdash-sun-marker-glow" r="18" cx="${cx}" cy="${cy}" fill="url(#wdash-sun-glow-gradient)" />
        <circle class="wdash-sun-marker-core" r="8" cx="${cx}" cy="${cy}" fill="url(#wdash-sun-gradient)" />
      </g>
    `.trim();
    return { className, cx, cy, markup };
  }

  function buildSunMarkerMarkup(view) {
    const state = resolveSunMarkerState(view);
    return state ? state.markup : '';
  }

  function createSunMarkerElement(state) {
    if (!state) return null;
    const NS = 'http://www.w3.org/2000/svg';
    const group = document.createElementNS(NS, 'g');
    group.setAttribute('class', state.className);

    const glow = document.createElementNS(NS, 'circle');
    glow.setAttribute('class', 'wdash-sun-marker-glow');
    glow.setAttribute('r', '18');
    glow.setAttribute('cx', state.cx);
    glow.setAttribute('cy', state.cy);
    glow.setAttribute('fill', 'url(#wdash-sun-glow-gradient)');

    const core = document.createElementNS(NS, 'circle');
    core.setAttribute('class', 'wdash-sun-marker-core');
    core.setAttribute('r', '8');
    core.setAttribute('cx', state.cx);
    core.setAttribute('cy', state.cy);
    core.setAttribute('fill', 'url(#wdash-sun-gradient)');

    group.appendChild(glow);
    group.appendChild(core);
    return group;
  }

  function buildSolarSunCard(data) {
    const view = resolveSolarSunViewModel(data);
    const layout = view.layout;
    const moonIconClass = `wdash-moon-icon${view.moonHemisphere === 'southern' ? ' is-southern' : ''}`;
    const markerMarkup = buildSunMarkerMarkup(view);
    const uvValueStyleAttr = view.uvValueColor ? ` style='color: ${escapeHtml(view.uvValueColor)};'` : '';
    const uvSubvalueStyleAttr = view.showUvSubvalue && view.uvSubvalueColor ? ` style='color: ${escapeHtml(view.uvSubvalueColor)};'` : '';
    const uvSubvalueContent = view.showUvSubvalue ? escapeHtml(view.uvSubvalueDisplay) : '';
    const solarValueHtml = view.showSolarMetric
      ? `${escapeHtml(view.solarDisplay)} <span class="wdash-sun-metric-unit">${escapeHtml(view.solarUnit)}</span>`
      : '';

    return `
      <section class="wdash-card wdash-card--solar">
        ${cardHeader(
          CARD_TITLES.sunMoon,
          data,
          view.stationLabel,
          {
            fallbackToRelative: false,
            clock: {
              mode: 'datetime',
              source: view.stationReportedAt,
              timezoneLabel: view.stationZoneLabel
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
                <radialGradient id="wdash-sun-glow-gradient" cx="50%" cy="50%" r="37.5%">
                  <stop offset="0%" stop-color="#ffd45a" stop-opacity="0.8" />
                  <stop offset="55%" stop-color="#ffb347" stop-opacity="0.45" />
                  <stop offset="100%" stop-color="#ff9445" stop-opacity="0" />
                </radialGradient>
              </defs>
              <path class="wdash-sun-arc" d="${view.arcPath}" />
              ${markerMarkup}
            </svg>
            <!-- Metric Labels (HTML) -->
            <div class="wdash-sun-html-metric wdash-sun-html-metric--uv" style="${layout.uvStyle}"${view.showUvMetric ? '' : ' hidden'}>
              <div class="wdash-sun-metric-label">UV Index</div>
              <div class="wdash-sun-metric-value"${uvValueStyleAttr}>${escapeHtml(view.uvValueDisplay)}</div>
              <div class="wdash-sun-metric-subvalue"${view.showUvSubvalue ? '' : ' hidden'}${uvSubvalueStyleAttr}>${uvSubvalueContent}</div>
            </div>
            <div class="wdash-sun-html-metric wdash-sun-html-metric--solar" style="${layout.solarStyle}"${view.showSolarMetric ? '' : ' hidden'}>
              <div class="wdash-sun-metric-label">Solar</div>
              <div class="wdash-sun-metric-value">${solarValueHtml}</div>
            </div>
            <div class="wdash-sun-html-metric wdash-sun-html-metric--moon" style="${layout.moonStyle}">
              <div class="${moonIconClass}" data-phase="${escapeHtml(view.moonPhaseKey)}" role="img" aria-label="${escapeHtml(view.moonAriaLabel)}"></div>
              <div class="wdash-moon-label">
                <div class="wdash-moon-phase-name">${escapeHtml(view.moonPhaseName)}</div>
                <div class="wdash-moon-illumination">${escapeHtml(view.illuminationText)}</div>
              </div>
            </div>
            <!-- Time Labels (HTML) -->
            <div class="wdash-sun-time wdash-sun-time--rise" style="${layout.sunriseStyle}">
              <span class="wdash-value">${escapeHtml(view.sunriseText)}</span>
            </div>
            <div class="wdash-sun-time wdash-sun-time--set" style="${layout.sunsetStyle}">
              <span class="wdash-value">${escapeHtml(view.sunsetText)}</span>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  function resolveAirQualitySources(data) {
    const sources = [];
    if (hasAirQualityData(data?.outdoorAirQuality, 'Outdoor')) sources.push('Outdoor');
    if (hasAirQualityData(data?.indoorAirQuality, 'Indoor')) sources.push('Indoor');
    return sources;
  }

  function hasAirQualityData(air, type) {
    if (!air || typeof air !== 'object') return false;
    const keys = ['aqi', 'aqi_avg_24h', 'pm25', 'pm25_avg_24h'];
    if (type === 'Indoor') {
      keys.push('pm10', 'pm10_avg_24h', 'carbonDioxide', 'carbonDioxide_avg_24h');
    }
    return keys.some(key => Number.isFinite(toNumber(air[key])));
  }

  function buildAirQualityCard(data) {
    const availableSources = resolveAirQualitySources(data);
    const rotationSource = airQualityRotation.sources[airQualityRotation.index];
    const currentSource = availableSources.includes(rotationSource)
      ? rotationSource
      : (availableSources[0] || '');
    const airData = currentSource === 'Indoor'
      ? data?.indoorAirQuality
      : currentSource === 'Outdoor'
        ? data?.outdoorAirQuality
        : null;

    const metricsBySource = {};
    for (const source of availableSources) {
      const sourceData = source === 'Indoor' ? data?.indoorAirQuality : data?.outdoorAirQuality;
      metricsBySource[source] = buildAirQualityMetrics(sourceData, source);
    }

    let metricsMarkup = '';
    if (!availableSources.length) {
      metricsMarkup = '<div class="wdash-air-empty">No Data Available</div>';
    } else {
      const baseMetrics = metricsBySource[currentSource]
        || buildAirQualityMetrics(airData, currentSource);
      const spansAllColumns = airQualitySpansAllColumns();
      const normalizedMetrics = spansAllColumns
        ? harmonizeAirQualityMetrics(baseMetrics, metricsBySource)
        : baseMetrics;
      const gridLayout = determineAirMetricGrid(normalizedMetrics);
      const metrics = padAirQualityMetrics(normalizedMetrics, {
        columns: gridLayout.columns,
        maxRows: gridLayout.rows
      });
      metricsMarkup = buildMetricRow(metrics, 'wdash-air-metrics', {
        variant: 'compact',
        columns: gridLayout.columns
      });
    }

    const batteryLabel = currentSource ? `${currentSource} air quality sensor` : '';
    const batterySlot = currentSource
      ? buildBatterySlot(toNumber(airData?.battery), {
          orientation: 'landscape',
          className: 'wdash-air-battery',
          label: batteryLabel,
          titlePrefix: `${batteryLabel} battery`
        })
      : '';
    const headerSourceMarkup = currentSource
      ? `<span class="wdash-air-source">${escapeHtml(currentSource)}</span>`
      : '';
    const headerHtml = `
      <header class="wdash-card-header wdash-card-header--air">
        <div class="wdash-card-header-main">
          <h3>${escapeHtml(CARD_TITLES.air)}</h3>
          ${headerSourceMarkup}
        </div>
        <div class="wdash-air-header-meta">
          ${batterySlot}
        </div>
      </header>
    `;
    const sourceAttr = currentSource ? currentSource.toLowerCase() : 'none';

    return `
      <section class="wdash-card wdash-card--air" data-aq-source="${escapeHtml(sourceAttr)}">
        ${headerHtml}
        ${metricsMarkup}
      </section>
    `;
  }

  function buildAirQualityMetrics(air, type) {
    const metrics = [];
    const pushMetric = (key, label, value, extra = {}) => {
      metrics.push({ key, label, value, ...extra });
    };

    if (!air) {
      pushMetric('aqi', 'AQI', '--');
      return metrics;
    }

    const aqi = toNumber(air.aqi);
    const pm25 = toNumber(air.pm25);
    const aqi24h = toNumber(air.aqi_avg_24h);
    const pm25_24h = toNumber(air.pm25_avg_24h);

    if (Number.isFinite(aqi)) {
      pushMetric('aqi', 'AQI', formatNumber(aqi, 0), { color: air.aqiColor });
    }
    if (Number.isFinite(aqi24h)) {
      pushMetric('aqi24h', 'AQI 24h AVE', formatNumber(aqi24h, 0), { color: air.aqiColor_avg_24h });
    }
    if (Number.isFinite(pm25)) {
      pushMetric('pm25', 'PM2.5', `${formatNumber(pm25, 1)} µg/m³`);
    }
    if (Number.isFinite(pm25_24h)) {
      pushMetric('pm25_24h', 'PM2.5 24h AVE', `${formatNumber(pm25_24h, 1)} µg/m³`);
    }

    if (type === 'Indoor') {
      const pm10 = toNumber(air.pm10);
      const pm10_24h = toNumber(air.pm10_avg_24h);
      const co2 = toNumber(air.carbonDioxide);
      const co2_24h = toNumber(air.carbonDioxide_avg_24h);

      if (Number.isFinite(pm10)) {
        pushMetric('pm10', 'PM10', `${formatNumber(pm10, 1)} µg/m³`);
      }
      if (Number.isFinite(pm10_24h)) {
        pushMetric('pm10_24h', 'PM10 24h AVE', `${formatNumber(pm10_24h, 1)} µg/m³`);
      }
      if (Number.isFinite(co2)) {
        pushMetric('co2', 'CO₂', `${formatNumber(co2, 0)} ppm`);
      }
      if (Number.isFinite(co2_24h)) {
        pushMetric('co2_24h', 'CO₂ 24h AVE', `${formatNumber(co2_24h, 0)} ppm`);
      }
    }

    if (!metrics.length) {
      pushMetric('aqi', 'AQI', '--');
    }

    return metrics;
  }

  function padAirQualityMetrics(metrics, options = {}) {
    const list = Array.isArray(metrics) ? metrics.slice() : [];
    const columns = Number.isFinite(options.columns) ? Math.max(1, Number(options.columns)) : 4;
    const maxRows = Number.isFinite(options.maxRows) ? Math.max(1, Number(options.maxRows)) : 2;

    const desiredRows = Math.max(1, Math.ceil(list.length / columns));
    const rows = Math.min(desiredRows, maxRows);
    const totalSlots = rows * columns;

    if (list.length >= totalSlots) {
      return list;
    }

    while (list.length < totalSlots) {
      list.push({ label: '', value: '', placeholder: true });
    }

    return list;
  }

  function harmonizeAirQualityMetrics(currentMetrics, metricsBySource) {
    const metricSets = [];
    const map = metricsBySource && typeof metricsBySource === 'object' ? metricsBySource : {};
    for (const value of Object.values(map)) {
      if (Array.isArray(value) && value.length) {
        metricSets.push(value);
      }
    }

    if (Array.isArray(currentMetrics) && currentMetrics.length) {
      const isIncluded = metricSets.some(set => set === currentMetrics);
      if (!isIncluded) {
        metricSets.push(currentMetrics);
      }
    }

    if (metricSets.length < 2) {
      return Array.isArray(currentMetrics) ? currentMetrics.slice() : [];
    }

    const keyOrder = computeAirMetricKeyOrder(metricSets);
    if (!keyOrder.length) {
      return Array.isArray(currentMetrics) ? currentMetrics.slice() : [];
    }

    return alignAirMetricsToOrder(currentMetrics, keyOrder);
  }

  function computeAirMetricKeyOrder(metricSets) {
    const sets = Array.isArray(metricSets) ? metricSets : [];
    const order = [];
    const seen = new Set();
    const addKey = key => {
      if (!key || seen.has(key)) return;
      seen.add(key);
      order.push(key);
    };

    const hasKey = (set, key) => set.some(metric => getAirMetricKey(metric) === key);

    for (const key of AIR_QUALITY_METRIC_ORDER) {
      if (sets.some(set => hasKey(set, key))) {
        addKey(key);
      }
    }

    for (const set of sets) {
      for (const metric of set) {
        addKey(getAirMetricKey(metric));
      }
    }

    return order;
  }

  function alignAirMetricsToOrder(metrics, keyOrder) {
    const list = Array.isArray(metrics) ? metrics : [];
    const keys = Array.isArray(keyOrder) ? keyOrder : [];
    if (!keys.length) return list.slice();

    const metricByKey = new Map();
    for (const metric of list) {
      const key = getAirMetricKey(metric);
      if (!key || metricByKey.has(key)) continue;
      metricByKey.set(key, metric);
    }

    return keys.map(key => {
      const metric = metricByKey.get(key);
      if (metric) return metric;
      return { key, label: '', value: '', placeholder: true };
    });
  }

  function getAirMetricKey(metric) {
    if (!metric || typeof metric !== 'object') return null;
    if (typeof metric.key === 'string' && metric.key.trim()) {
      return metric.key.trim();
    }
    if (typeof metric.label === 'string' && metric.label.trim()) {
      const normalized = metric.label
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-+|-+$/g, '');
      return normalized || null;
    }
    return null;
  }

  function determineAirMetricGrid(metrics) {
    const metricCount = Array.isArray(metrics) ? metrics.length : 0;
    const safeCount = Math.max(1, Number(metricCount) || 0);
    const spansAllColumns = airQualitySpansAllColumns();
    const maxRowsAllowed = spansAllColumns ? 1 : 2;
    const maxColumns = spansAllColumns ? Math.max(1, safeCount) : Math.min(4, Math.max(1, safeCount));
    let bestColumns = maxColumns;
    let bestRows = Math.min(maxRowsAllowed, Math.max(1, Math.ceil(safeCount / maxColumns)));
    let bestPlaceholders = Infinity;

    for (let columns = maxColumns; columns >= 1; columns -= 1) {
      const rows = Math.max(1, Math.ceil(safeCount / columns));
      if (rows > maxRowsAllowed) continue;
      const placeholders = rows * columns - safeCount;
      if (
        placeholders < bestPlaceholders
        || (placeholders === bestPlaceholders && rows < bestRows)
        || (placeholders === bestPlaceholders && rows === bestRows && columns > bestColumns)
      ) {
        bestColumns = columns;
        bestRows = rows;
        bestPlaceholders = placeholders;
      }
    }

    if (!Number.isFinite(bestPlaceholders)) {
      bestColumns = maxColumns;
      bestRows = Math.min(maxRowsAllowed, Math.max(1, Math.ceil(safeCount / maxColumns)));
    }

    return { columns: bestColumns, rows: bestRows };
  }

  function airQualitySpansAllColumns() {
    const templates = layoutState?.templates || DEFAULT_TEMPLATES;
    const breakpoints = ['desktop', 'tablet', 'mobile'];
    for (const key of breakpoints) {
      const template = templates?.[key] || DEFAULT_TEMPLATES[key];
      if (templateHasFullRowOfArea(template, 'air')) {
        return true;
      }
    }
    return false;
  }

  function templateHasFullRowOfArea(compiledTemplate, areaName) {
    if (!compiledTemplate || typeof compiledTemplate.areas !== 'string' || !areaName) {
      return false;
    }
    const normalizedArea = normalizeAreaToken(areaName);
    if (!normalizedArea) return false;
    const lines = compiledTemplate.areas
      .split(/\n+/)
      .map(line => line.replace(/["']/g, ' ').trim())
      .filter(Boolean);
    for (const line of lines) {
      const tokens = line
        .split(/\s+/)
        .map(token => normalizeAreaToken(token))
        .filter(Boolean);
      if (!tokens.length) continue;
      if (tokens.every(token => token === normalizedArea)) {
        return true;
      }
    }
    return false;
  }

  /* ---------- helpers ---------- */

  function setupInteractiveComponents(container) {
    setupPressureToggle(container);
    setupAmbientControls(container);
    setupTempWindGaugeSizing(container);
    setupTemperatureUnitIndicator(container);
    // ensure ambient ring sizing is applied on setup
    applyAmbientRingSizing();
    // also size outdoor gauge/compass
    applyOutdoorRingSizing();
  }

  function setupTemperatureUnitIndicator(container) {
    if (!container) return;
    const indicator = container.querySelector('[data-temp-unit-indicator="true"]');
    if (!indicator) return;
    if (indicator.dataset.tempUnitListenerBound === 'true') {
      syncTemperatureUnitIndicators();
      return;
    }

    indicator.addEventListener('click', handleTemperatureIndicatorClick);
    indicator.dataset.tempUnitListenerBound = 'true';
    syncTemperatureUnitIndicators();
  }

  function handleTemperatureIndicatorClick(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    const next = getOppositeTemperatureUnit(getDisplayTemperatureUnit());
    setTemperatureDisplayUnit(next);
  }

  function refreshTemperatureUnitUI() {
    syncTemperatureUnitIndicators();
  }

  function syncTemperatureUnitIndicators() {
    const buttons = document.querySelectorAll('#' + DISPLAY_TILE_ID + ' [data-temp-unit-indicator="true"]');
    if (!buttons.length) return;
    const current = getDisplayTemperatureUnit();
    const next = getOppositeTemperatureUnit(current);
    const label = `Switch temperature display to ${describeTemperatureUnit(next)}`;

    buttons.forEach(button => {
      button.textContent = current;
      if (label) {
        button.setAttribute('aria-label', label);
        button.setAttribute('title', label);
      } else {
        button.removeAttribute('aria-label');
        button.removeAttribute('title');
      }
    });
  }

  function applyTemperatureUnitsFromMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object') return;

    const unitsSource = isPlainObject(metadata.temperatureUnits) ? metadata.temperatureUnits : null;
    const inputCandidate = unitsSource?.input ?? unitsSource?.source ?? unitsSource?.sensor ?? metadata.temperatureInputUnit;
    const displayCandidate = unitsSource?.display ?? unitsSource?.default ?? unitsSource?.output ?? metadata.temperatureDisplayUnit;

    const normalizedInput = normalizeTemperatureUnit(inputCandidate);
    const normalizedDisplay = normalizeTemperatureUnit(displayCandidate);

    let changed = false;

    if (normalizedInput) {
      temperatureUnitState.metadataInput = normalizedInput;
      if (normalizedInput !== temperatureUnitState.input) {
        temperatureUnitState.input = normalizedInput;
        persistTemperatureUnit('input', normalizedInput);
        changed = true;
      }
    }

    if (normalizedDisplay) {
      const previousMetadataDisplay = temperatureUnitState.metadataDisplay;
      const metadataChanged = normalizedDisplay !== previousMetadataDisplay;
      temperatureUnitState.metadataDisplay = normalizedDisplay;
      if (metadataChanged) {
        temperatureUnitState.displayOverride = false;
      }
      const overrideActive = temperatureUnitState.displayOverride === true;
      if ((!overrideActive || metadataChanged) && normalizedDisplay !== temperatureUnitState.display) {
        temperatureUnitState.display = normalizedDisplay;
        persistTemperatureUnit('display', normalizedDisplay);
        changed = true;
      }
    }

    if (changed) {
      refreshTemperatureUnitUI();
    }
  }

  function setTemperatureInputUnit(unit) {
    const normalized = normalizeTemperatureUnit(unit);
    if (!normalized || normalized === temperatureUnitState.input) {
      refreshTemperatureUnitUI();
      return;
    }
    temperatureUnitState.input = normalized;
    persistTemperatureUnit('input', normalized);
    refreshTemperatureUnitUI();
    if (!IS_TEST_ENV) {
      safeRenderFromData();
    }
  }

  function setTemperatureDisplayUnit(unit) {
    const normalized = normalizeTemperatureUnit(unit);
    if (!normalized) {
      refreshTemperatureUnitUI();
      return;
    }

    if (normalized === temperatureUnitState.display) {
      const metadataDefault = temperatureUnitState.metadataDisplay;
      temperatureUnitState.displayOverride = metadataDefault ? normalized !== metadataDefault : temperatureUnitState.displayOverride;
      refreshTemperatureUnitUI();
      return;
    }

    const metadataDefault = temperatureUnitState.metadataDisplay;
    temperatureUnitState.display = normalized;
    temperatureUnitState.displayOverride = metadataDefault ? normalized !== metadataDefault : true;
    persistTemperatureUnit('display', normalized);
    refreshTemperatureUnitUI();
    if (!IS_TEST_ENV) {
      safeRenderFromData();
    }
  }

  function getInputTemperatureUnit() {
    const normalized = normalizeTemperatureUnit(temperatureUnitState.input);
    return normalized || 'F';
  }

  function getDisplayTemperatureUnit() {
    const normalized = normalizeTemperatureUnit(temperatureUnitState.display);
    return normalized || 'F';
  }

  function getOppositeTemperatureUnit(unit) {
    return normalizeTemperatureUnit(unit) === 'C' ? 'F' : 'C';
  }

  function normalizeTemperatureUnit(value) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toUpperCase();
    return TEMPERATURE_UNITS.includes(normalized) ? normalized : null;
  }

  function describeTemperatureUnit(unit) {
    const normalized = normalizeTemperatureUnit(unit);
    if (normalized === 'C') return 'Celsius';
    if (normalized === 'F') return 'Fahrenheit';
    return '';
  }

  function readStoredTemperatureUnit(type) {
    const key = TEMPERATURE_UNIT_STORAGE_KEYS[type];
    if (!key) return null;
    try {
      if (typeof window === 'undefined' || !window.localStorage) return null;
    } catch (e) {
      return null;
    }
    try {
      const stored = window.localStorage.getItem(key);
      return normalizeTemperatureUnit(stored);
    } catch (err) {
      return null;
    }
  }

  function persistTemperatureUnit(type, unit) {
    const key = TEMPERATURE_UNIT_STORAGE_KEYS[type];
    const normalized = normalizeTemperatureUnit(unit);
    if (!key || !normalized) return;
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;
    } catch (e) {
      return;
    }
    try {
      window.localStorage.setItem(key, normalized);
    } catch (err) { /* ignore */ }
  }

  function resolveTemperaturePair(valueF, valueC) {
    const preferred = getInputTemperatureUnit();
    const f = toNumber(valueF);
    const c = toNumber(valueC);

    if (preferred === 'C') {
      if (Number.isFinite(c)) {
        return { f: celsiusToFahrenheit(c), c };
      }
      if (Number.isFinite(f)) {
        return { f, c: fahrenheitToCelsius(f) };
      }
    } else {
      if (Number.isFinite(f)) {
        return { f, c: fahrenheitToCelsius(f) };
      }
      if (Number.isFinite(c)) {
        return { f: celsiusToFahrenheit(c), c };
      }
    }

    if (Number.isFinite(f)) {
      return { f, c: Number.isFinite(c) ? c : fahrenheitToCelsius(f) };
    }
    if (Number.isFinite(c)) {
      return { f: celsiusToFahrenheit(c), c };
    }

    return { f: NaN, c: NaN };
  }

  function resolveTemperatureDelta(valueF, valueC) {
    const preferred = getInputTemperatureUnit();
    const f = toNumber(valueF);
    const c = toNumber(valueC);

    if (preferred === 'C') {
      if (Number.isFinite(c)) {
        return { f: celsiusDeltaToFahrenheit(c), c };
      }
      if (Number.isFinite(f)) {
        return { f, c: fahrenheitDeltaToCelsius(f) };
      }
    } else {
      if (Number.isFinite(f)) {
        return { f, c: fahrenheitDeltaToCelsius(f) };
      }
      if (Number.isFinite(c)) {
        return { f: celsiusDeltaToFahrenheit(c), c };
      }
    }

    if (Number.isFinite(f)) {
      return { f, c: fahrenheitDeltaToCelsius(f) };
    }
    if (Number.isFinite(c)) {
      return { f: celsiusDeltaToFahrenheit(c), c };
    }

    return { f: NaN, c: NaN };
  }

  function convertTemperatureValue(value, fromUnit, toUnit) {
    if (!Number.isFinite(value)) return NaN;
    const from = normalizeTemperatureUnit(fromUnit) || 'F';
    const to = normalizeTemperatureUnit(toUnit) || 'F';
    if (from === to) return value;
    if (from === 'F') {
      return fahrenheitToCelsius(value);
    }
    return celsiusToFahrenheit(value);
  }

  function convertTemperatureDelta(value, fromUnit, toUnit) {
    if (!Number.isFinite(value)) return NaN;
    const from = normalizeTemperatureUnit(fromUnit) || 'F';
    const to = normalizeTemperatureUnit(toUnit) || 'F';
    if (from === to) return value;
    if (from === 'F') {
      return fahrenheitDeltaToCelsius(value);
    }
    return celsiusDeltaToFahrenheit(value);
  }

  function fahrenheitToCelsius(value) {
    return (value - 32) * (5 / 9);
  }

  function celsiusToFahrenheit(value) {
    return (value * (9 / 5)) + 32;
  }

  function fahrenheitDeltaToCelsius(value) {
    return value * (5 / 9);
  }

  function celsiusDeltaToFahrenheit(value) {
    return value * (9 / 5);
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
    if (tempWindGaugeHosts.length) {
      tempWindGaugeHosts.forEach(host => {
        const gauge = host?.querySelector?.('.wdash-gauge, .wdash-wind-compass');
        if (gauge?.style) {
          gauge.style.removeProperty('width');
          gauge.style.removeProperty('height');
        }
        tempWindGaugeLastSizes.delete(host);
      });
      tempWindGaugeHosts = [];
    }
  }

  function setupTempWindGaugeSizing(container) {
    const card = container.querySelector('.wdash-card--temp-wind');
    if (!card) {
      teardownTempWindGaugeSizing();
      return;
    }
    const hosts = Array.from(card.querySelectorAll('.wdash-temp, .wdash-wind'));
    if (!hosts.length) {
      teardownTempWindGaugeSizing();
      return;
    }

    const hostsChanged =
      hosts.length !== tempWindGaugeHosts.length
      || hosts.some((host, index) => tempWindGaugeHosts[index] !== host);

    if (hostsChanged) {
      teardownTempWindGaugeSizing();
      tempWindGaugeHosts = hosts;
    } else {
      tempWindGaugeHosts = hosts;
    }

    hosts.forEach(host => applyTempWindGaugeSize(host));

    if (!hostsChanged && tempWindGaugeObserver) {
      return;
    }

    if (typeof ResizeObserver === 'function') {
      tempWindGaugeObserver = new ResizeObserver(entries => {
        entries.forEach(entry => {
          applyTempWindGaugeSize(entry.target);
        });
      });
      hosts.forEach(host => tempWindGaugeObserver.observe(host));
    } else if (!tempWindGaugeResizeHandler) {
      tempWindGaugeResizeHandler = () => {
        tempWindGaugeHosts.forEach(host => applyTempWindGaugeSize(host));
      };
      window.addEventListener('resize', tempWindGaugeResizeHandler);
    }
  }

  function applyTempWindGaugeSize(host) {
    if (!host) return;

    const gauge = host.querySelector('.wdash-gauge, .wdash-wind-compass');
    if (!gauge) return;

    const measured = typeof host.getBoundingClientRect === 'function'
      ? host.getBoundingClientRect()
      : null;
    const width = measured?.width ?? host.clientWidth ?? 0;
    const height = measured?.height ?? host.clientHeight ?? 0;
    const hostSize = Math.min(width, height);

    if (!Number.isFinite(hostSize) || hostSize <= 0) {
      if (gauge.style) {
        gauge.style.removeProperty('width');
        gauge.style.removeProperty('height');
      }
      tempWindGaugeLastSizes.delete(host);
      return;
    }

    const normalized = Math.max(0, Math.round(hostSize * 10) / 10);
    const previous = tempWindGaugeLastSizes.get(host);

    if (Number.isFinite(previous) && Math.abs(previous - normalized) <= 0.5) {
      return;
    }

    if (gauge.style) {
      gauge.style.width = `${normalized}px`;
      gauge.style.height = `${normalized}px`;
    }

    tempWindGaugeLastSizes.set(host, normalized);
  }

  function updateTempWindCard() {
    const card = document.querySelector('#' + DISPLAY_TILE_ID + ' .wdash-card--temp-wind');
    if (!card) return;

    const data = tempWindState.data;
    const outdoor = data?.outdoor || {};
    const wind = data?.wind || {};
    const avg = wind.average || {};

    const tempPair = resolveTemperaturePair(outdoor.temperatureF, outdoor.temperatureC);
    const highPair = resolveTemperaturePair(outdoor.dailyHighF, outdoor.dailyHighC);
    const lowPair = resolveTemperaturePair(outdoor.dailyLowF, outdoor.dailyLowC);
    const feelsPair = resolveTemperaturePair(outdoor.feelsLikeF, outdoor.feelsLikeC);
    const dewPair = resolveTemperaturePair(outdoor.dewPointF, outdoor.dewPointC);
    const humidity = toNumber(outdoor.humidity);
    const trendPair = resolveTemperatureDelta(outdoor.trendFPerHour, outdoor.trendCPerHour);
    const batteryLevel = toNumber(outdoor.battery);

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
    const headingText = Number.isFinite(dirDegrees) ? formatDegrees(dirDegrees) : '--°';
    const gustText = Number.isFinite(gust) ? `${formatNumber(gust, 1)} mph` : '--';
    const avgSpeedText = Number.isFinite(avgSpeed) ? `${formatNumber(avgSpeed, 1)} mph` : '--';
    const avgCombinedText = `${avgDirText || '--'} ${avgSpeedText}`.trim();
    const dailyMaxGustText = Number.isFinite(dailyMaxGust) ? `${formatNumber(dailyMaxGust, 1)} mph` : '--';

    const tempF = tempPair.f;
    const tempColor = colorForTemp(tempF);
    const gaugeIndicatorValue = gaugeIndicator(tempF);
    const gauge = card.querySelector('.wdash-gauge');
    if (gauge && gauge.style) {
      gauge.style.setProperty('--gauge-indicator', gaugeIndicatorValue);
      if (Array.isArray(tempColor.colors)) {
        if (tempColor.colors[0]) gauge.style.setProperty('--gauge-color-a', tempColor.colors[0]);
        if (tempColor.colors[1]) gauge.style.setProperty('--gauge-color-b', tempColor.colors[1]);
      }
      if (tempColor.mid) gauge.style.setProperty('--gauge-color-mid', tempColor.mid);
      if (tempColor.progress != null) {
        gauge.style.setProperty('--gauge-band-progress', String(tempColor.progress));
      }
    }

    const gaugeValueEl = card.querySelector('.wdash-gauge-value-number');
    if (gaugeValueEl) gaugeValueEl.textContent = formatTemperature(tempF);
    setTextContent(card.querySelector('.wdash-temp-extrema--high .wdash-temp-extrema-value'), formatTemperature(highPair.f));
    setTextContent(card.querySelector('.wdash-temp-extrema--low .wdash-temp-extrema-value'), formatTemperature(lowPair.f));

    const indicatorButton = card.querySelector('[data-temp-unit-indicator="true"]');
    if (indicatorButton) {
      const currentUnit = getDisplayTemperatureUnit();
      const altUnit = getOppositeTemperatureUnit(currentUnit);
      const labelUnit = describeTemperatureUnit(altUnit) || altUnit;
      const label = labelUnit ? `Switch temperature display to ${labelUnit}` : 'Switch temperature display';
      if (indicatorButton.textContent !== currentUnit) indicatorButton.textContent = currentUnit;
      indicatorButton.setAttribute('aria-label', label);
      indicatorButton.setAttribute('title', label);
    }

    const detailValues = [
      formatTemperature(feelsPair.f),
      formatTemperature(dewPair.f),
      formatPercent(humidity, 0),
      formatSigned(convertTemperatureDelta(trendPair.f, 'F', getDisplayTemperatureUnit()), 1, `°${getDisplayTemperatureUnit()}/hr`),
      avgCombinedText,
      dailyMaxGustText
    ];
    const detailNodes = card.querySelectorAll('.wdash-temp-wind-details .wdash-metric-value');
    detailNodes.forEach((node, index) => {
      setTextContent(node, detailValues[index] != null ? detailValues[index] : '--');
    });

    const generatedAt = data?.metadata?.generatedAt;
    const stationReportedAt = data?.metadata?.weatherStationTime || generatedAt;
    const stationLabel = stationReportedAt ? formatHubClock(stationReportedAt, { includeSeconds: false }) : null;
    const updatedLabel = stationLabel ? `Updated ${stationLabel}` : '';
    setTextContent(card.querySelector('.wdash-updated-line--primary'), updatedLabel);

    const battery = card.querySelector('.wdash-temp-wind-battery');
    if (battery) {
      updateBatterySlot(battery, batteryLevel, {
        orientation: 'landscape',
        label: 'Outdoor sensor',
        titlePrefix: 'Outdoor sensor battery'
      });
    }

    const compass = card.querySelector('.wdash-wind-compass');
    const normalizedBearing = bearingLabel || '--';
    const ariaHeading = headingText || '--°';
    if (compass) {
      compass.setAttribute('aria-label', `Wind direction ${normalizedBearing} ${ariaHeading}`.trim());
    }
    setTextContent(card.querySelector('.wdash-wind-bearing'), normalizedBearing);
    const headingEl = card.querySelector('.wdash-wind-heading');
    if (headingEl) {
      const text = headingText ? ` ${headingText}` : ' --°';
      if (headingEl.textContent !== text) headingEl.textContent = text;
    }
    setTextContent(card.querySelector('.wdash-wind-speed-value'), Number.isFinite(speed) ? formatNumber(speed, 1) : '--');
    setTextContent(card.querySelector('.wdash-wind-gust-value'), gustText);

    if (compass) {
      const currentArrow = compass.querySelector('.wdash-compass-arrow--current');
      if (currentArrow && currentArrow.style) {
        const normalized = normalizeDegrees(dirDegrees);
        currentArrow.style.transform = `rotate(${normalized}deg)`;
      }
      const avgArrow = Number.isFinite(avgDir) ? ensureCompassAverageArrow(compass) : compass.querySelector('.wdash-compass-arrow--avg');
      if (avgArrow && avgArrow.style) {
        if (Number.isFinite(avgDir)) {
          avgArrow.style.display = '';
          avgArrow.style.transform = `rotate(${normalizeDegrees(avgDir)}deg)`;
        } else {
          avgArrow.style.display = 'none';
        }
      } else if (!Number.isFinite(avgDir)) {
        const existingAvg = compass.querySelector('.wdash-compass-arrow--avg');
        if (existingAvg && existingAvg.style) existingAvg.style.display = 'none';
      }
    }

    const detailsHeader = card.querySelector('.wdash-temp-wind-details');
    if (detailsHeader) {
      if (Number.isFinite(windowMins)) {
        detailsHeader.dataset.window = String(windowMins);
      } else if (detailsHeader.dataset) {
        delete detailsHeader.dataset.window;
      }
    }
  }

  function updateSolarSunCard() {
    const card = document.querySelector('#' + DISPLAY_TILE_ID + ' .wdash-card--solar');
    if (!card || !solarState.data) return;

    const data = solarState.data;
    const view = resolveSolarSunViewModel(data);

    const headerMarkup = cardHeader(
      CARD_TITLES.sunMoon,
      data,
      view.stationLabel,
      {
        fallbackToRelative: false,
        clock: {
          mode: 'datetime',
          source: view.stationReportedAt,
          timezoneLabel: view.stationZoneLabel
        }
      }
    );
    const currentHeader = card.querySelector('.wdash-card-header');
    if (currentHeader) {
      if (currentHeader.dataset.wdashMarkup !== headerMarkup) {
        const nextHeader = createElementFromMarkup(headerMarkup);
        if (nextHeader) {
          nextHeader.dataset.wdashMarkup = headerMarkup;
          currentHeader.replaceWith(nextHeader);
        }
      } else {
        currentHeader.dataset.wdashMarkup = headerMarkup;
      }
    } else {
      const nextHeader = createElementFromMarkup(headerMarkup);
      if (nextHeader) {
        nextHeader.dataset.wdashMarkup = headerMarkup;
        card.prepend(nextHeader);
      }
    }

    const arcPath = card.querySelector('.wdash-sun-arc');
    if (arcPath && view.arcPath) {
      arcPath.setAttribute('d', view.arcPath);
    }

    const markerState = resolveSunMarkerState(view);
    if (markerState && card.dataset.wdashSunMarker !== markerState.markup) {
      const svg = card.querySelector('.wdash-sun-svg');
      if (svg) {
        const nextMarker = createSunMarkerElement(markerState);
        if (nextMarker) {
          const existing = svg.querySelector('.wdash-sun-marker');
          if (existing) {
            existing.replaceWith(nextMarker);
          } else {
            const arcSibling = svg.querySelector('.wdash-sun-arc');
            if (arcSibling && arcSibling.parentNode) {
              arcSibling.parentNode.insertBefore(nextMarker, arcSibling.nextSibling);
            } else {
              svg.appendChild(nextMarker);
            }
          }
          card.dataset.wdashSunMarker = markerState.markup;
        }
      }
    }

    const uvMetric = card.querySelector('.wdash-sun-html-metric--uv');
    if (uvMetric) {
      uvMetric.hidden = !view.showUvMetric;
      const uvValue = uvMetric.querySelector('.wdash-sun-metric-value');
      if (uvValue) {
        setTextContent(uvValue, view.showUvMetric ? view.uvValueDisplay : '');
        if (view.showUvMetric && view.uvValueColor) {
          uvValue.style.color = view.uvValueColor;
        } else {
          uvValue.style.removeProperty('color');
        }
      }
      const uvDanger = uvMetric.querySelector('.wdash-sun-metric-subvalue');
      if (uvDanger) {
        uvDanger.hidden = !view.showUvSubvalue;
        if (view.showUvSubvalue) {
          setTextContent(uvDanger, view.uvSubvalueDisplay);
          if (view.uvSubvalueColor) {
            uvDanger.style.color = view.uvSubvalueColor;
          } else {
            uvDanger.style.removeProperty('color');
          }
        } else {
          setTextContent(uvDanger, '');
          uvDanger.style.removeProperty('color');
        }
      }
    }

    const solarMetricContainer = card.querySelector('.wdash-sun-html-metric--solar');
    if (solarMetricContainer) {
      solarMetricContainer.hidden = !view.showSolarMetric;
      const solarMetric = solarMetricContainer.querySelector('.wdash-sun-metric-value');
      if (solarMetric) {
        if (view.showSolarMetric) {
          const html = `${escapeHtml(view.solarDisplay)} <span class="wdash-sun-metric-unit">${escapeHtml(view.solarUnit)}</span>`;
          if (solarMetric.innerHTML !== html) {
            solarMetric.innerHTML = html;
          }
        } else if (solarMetric.innerHTML !== '') {
          solarMetric.innerHTML = '';
        }
      }
    }

    const moonMetric = card.querySelector('.wdash-sun-html-metric--moon');
    if (moonMetric) {
      const icon = moonMetric.querySelector('.wdash-moon-icon');
      if (icon) {
        icon.classList.toggle('is-southern', view.moonHemisphere === 'southern');
        if (view.moonPhaseKey) {
          icon.setAttribute('data-phase', view.moonPhaseKey);
        } else {
          icon.removeAttribute('data-phase');
        }
        icon.setAttribute('aria-label', view.moonAriaLabel);
      }
      setTextContent(moonMetric.querySelector('.wdash-moon-phase-name'), view.moonPhaseName);
      setTextContent(moonMetric.querySelector('.wdash-moon-illumination'), view.illuminationText);
    }

    setTextContent(card.querySelector('.wdash-sun-time--rise .wdash-value'), view.sunriseText);
    setTextContent(card.querySelector('.wdash-sun-time--set .wdash-value'), view.sunsetText);
  }

  function ensureCompassAverageArrow(compass) {
    if (!compass) return null;
    let avgArrow = compass.querySelector('.wdash-compass-arrow--avg');
    if (avgArrow) return avgArrow;
    const svg = compass.querySelector('svg');
    if (!svg) return null;
    const currentArrow = svg.querySelector('.wdash-compass-arrow--current');
    if (!currentArrow) return null;
    const clone = currentArrow.cloneNode(true);
    clone.classList.remove('wdash-compass-arrow--current');
    clone.classList.add('wdash-compass-arrow--avg');
    const path = clone.querySelector('.wdash-compass-current');
    if (path) {
      path.classList.remove('wdash-compass-current');
      path.classList.add('wdash-compass-avg');
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'rgba(208,213,220,0.95)');
      path.setAttribute('stroke-width', '1.0');
    }
    svg.appendChild(clone);
    return clone;
  }

  function normalizeDegrees(value) {
    if (!Number.isFinite(value)) return 0;
    let normalized = value % 360;
    if (normalized < 0) normalized += 360;
    return normalized;
  }

  function setTextContent(element, value) {
    if (!element) return;
    const text = value == null ? '' : String(value);
    if (element.textContent !== text) {
      element.textContent = text;
    }
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
    const timerButton = container.querySelector('.wdash-ambient-timer');
    if (timerButton) {
      if (timerButton.dataset.ambientListenerBound !== 'true') {
        timerButton.addEventListener('click', handleAmbientToggleClick);
        timerButton.dataset.ambientListenerBound = 'true';
      }
    }

    const nextButton = container.querySelector('.wdash-ambient-next');
    if (nextButton) {
      if (nextButton.dataset.ambientListenerBound !== 'true') {
        nextButton.addEventListener('click', handleAmbientNextClick);
        nextButton.dataset.ambientListenerBound = 'true';
      }
    }

    updateAmbientTimerDisplay();
    updateAmbientNextButton();
  }

  function handleAmbientToggleClick() {
    if (ambientRotation.sensors.length <= 1) return;
    toggleAmbientRotationPause();
  }

  function handleAmbientNextClick(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    if (ambientRotation.sensors.length <= 1) return;

    advanceAmbientSensor();
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

  function scheduleAmbientRotation(delayMs) {
    resetAmbientTimerState();

    if (ambientRotation.paused || ambientRotation.sensors.length <= 1) {
      ambientRotation.nextSwitchAt = null;
      clearAmbientCountdownTimer();
      updateAmbientTimerDisplay();
      return;
    }

    const now = Date.now();
    let delay = Number(delayMs);
    if (!Number.isFinite(delay) || delay <= 0) {
      delay = ambientRotation.interval;
    } else {
      delay = Math.min(delay, ambientRotation.interval);
    }

    ambientRotation.nextSwitchAt = now + delay;
    ambientRotation.timer = setTimeout(() => {
      ambientRotation.timer = null;
      advanceAmbientSensor();
    }, delay);

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

  function updateAmbientNextButton() {
    const button = document.querySelector('#' + DISPLAY_TILE_ID + ' .wdash-ambient-next');
    if (!button) return;

    const disabled = ambientRotation.sensors.length <= 1;
    if (button.disabled !== disabled) {
      button.disabled = disabled;
    }

    const label = ambientRotation.sensors.length > 1
      ? 'Show next ambient sensor'
      : 'Ambient sensor rotation unavailable';
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
  }

  function resolveAmbientRotationIntervalMs(data) {
    const rawSeconds = data?.ambientRotationSeconds;
    if (rawSeconds == null) return DEFAULT_AMBIENT_ROTATION_INTERVAL_MS;

    const seconds = Number(rawSeconds);
    if (!Number.isFinite(seconds)) return DEFAULT_AMBIENT_ROTATION_INTERVAL_MS;

    const clamped = Math.min(
      MAX_AMBIENT_ROTATION_SECONDS,
      Math.max(MIN_AMBIENT_ROTATION_SECONDS, seconds)
    );
    return Math.round(clamped * 1000);
  }

  function setupAmbientRotation(data) {
    const container = document.querySelector('#' + DISPLAY_TILE_ID + ' .wdash-ambient');
    if (!container) return;

    const now = Date.now();
    const prevInterval = ambientRotation.interval;
    const prevNextSwitchAt = Number.isFinite(ambientRotation.nextSwitchAt) ? ambientRotation.nextSwitchAt : null;
    const prevSensorCount = Array.isArray(ambientRotation.sensors) ? ambientRotation.sensors.length : 0;
    let remaining = null;
    if (!ambientRotation.paused && prevSensorCount > 1 && prevNextSwitchAt != null) {
      remaining = prevNextSwitchAt - now;
    }

    const sensors = resolveAmbientSensors(data);
    ambientRotation.sensors = sensors;
    ambientRotation.tempUnit = `°${getDisplayTemperatureUnit()}`;
    ambientRotation.humidityUnit = data?.ambientHumidityUnit || '%';
    ambientRotation.interval = resolveAmbientRotationIntervalMs(data);

    if (ambientRotation.index >= ambientRotation.sensors.length) {
      ambientRotation.index = ambientRotation.sensors.length ? ambientRotation.sensors.length - 1 : 0;
    }

    resetAmbientTimerState();
    ambientRotation.nextSwitchAt = null;

    const hasMultipleSensors = ambientRotation.sensors.length > 1;
    const canAutoRotate = hasMultipleSensors && !ambientRotation.paused;
    const intervalChanged = ambientRotation.interval !== prevInterval;
    if (Number.isFinite(remaining)) {
      remaining = intervalChanged ? Math.min(Math.max(remaining, 0), ambientRotation.interval) : Math.max(remaining, 0);
    }

    if (canAutoRotate && Number.isFinite(remaining) && remaining <= 0) {
      advanceAmbientSensor();
      updateAmbientTimerDisplay();
      return;
    }

    updateAmbientDisplay();

    if (!hasMultipleSensors) {
      ambientRotation.index = 0;
      clearAmbientCountdownTimer();
    } else if (canAutoRotate) {
      scheduleAmbientRotation(remaining);
    } else {
      clearAmbientCountdownTimer();
    }

    updateAmbientTimerDisplay();
  }

  function clearAmbientRotation() {
    stopAmbientRotationTimer();
    ambientRotation.sensors = [];
    ambientRotation.index = 0;
    ambientRotation.paused = false;
    updateAmbientTimerDisplay();
    updateAmbientNextButton();
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
    const batteryEl = scope.querySelector('.wdash-ambient-battery');

    if (!sensor) {
      if (tempEl) tempEl.textContent = formatTemperature(null, { includeUnit: true });
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
      updateAmbientTimerDisplay();
      updateAmbientNextButton();
      return;
    }

    container.classList.remove('wdash-ambient--empty');
    if (card) card.classList.remove('wdash-ambient--empty');
    const sensorName = sensor && typeof sensor.name === 'string' ? sensor.name.trim() : '';
    const tempPair = resolveTemperaturePair(sensor.temperatureF, sensor.temperatureC);
    if (tempEl) tempEl.textContent = formatTemperature(tempPair.f, { includeUnit: true });
    if (humidityEl) humidityEl.textContent = formatAmbientValue(sensor.humidity, ambientRotation.humidityUnit, 0);
    if (nameEl) nameEl.textContent = sensorName.length ? sensorName : 'Ambient Sensor';
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
    updateAmbientNextButton();

    // Draw rings for temperature and humidity using inline SVG for better compatibility
    try {
      const tempFill = container.querySelector('.wdash-ambient-circle--temp .wdash-ambient-svg .wdash-ambient-fill');
      const tempTrack = container.querySelector('.wdash-ambient-circle--temp .wdash-ambient-svg .wdash-ambient-track');
      const humFill = container.querySelector('.wdash-ambient-circle--humidity .wdash-ambient-svg .wdash-ambient-fill');
      const humTrack = container.querySelector('.wdash-ambient-circle--humidity .wdash-ambient-svg .wdash-ambient-track');

      // Temperature: set stroke color to a blended mid color from the temperature band
      if (tempFill && tempTrack) {
        const tempColors = colorForTemp(tempPair.f);
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
        let prevHum = NaN;
        if (sensorKey && ambientLastHumidity.has(sensorKey)) {
          prevHum = ambientLastHumidity.get(sensorKey);
        }
        if (!Number.isFinite(prevHum)) {
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
        }
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
    airQualityRotation.interval = DEFAULT_AIR_QUALITY_ROTATION_INTERVAL_MS;
    const sources = resolveAirQualitySources(data);
    airQualityRotation.sources = sources;

    if (airQualityRotation.index >= sources.length) {
      airQualityRotation.index = 0;
    }

    if (sources.length > 1) {
      scheduleAirQualityRotation();
    } else {
      stopAirQualityRotationTimer();
      if (!sources.length) {
        airQualityRotation.index = 0;
      }
    }
  }

  function scheduleAirQualityRotation() {
    if (airQualityRotation.sources.length <= 1) {
      stopAirQualityRotationTimer();
      return;
    }
    if (airQualityRotation.timer) clearTimeout(airQualityRotation.timer);
    airQualityRotation.timer = setTimeout(() => {
      airQualityRotation.timer = null;
      airQualityRotation.index = (airQualityRotation.index + 1) % airQualityRotation.sources.length;
      updateAirQualityCard();
      scheduleAirQualityRotation();
    }, airQualityRotation.interval);
  }

  function stopAirQualityRotationTimer() {
    if (airQualityRotation.timer) {
      clearTimeout(airQualityRotation.timer);
      airQualityRotation.timer = null;
    }
  }

  function clearAirQualityRotation() {
    stopAirQualityRotationTimer();
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

  function compileLayoutTemplates(layoutConfig, options = {}) {
    const breakpoints = ['desktop', 'tablet', 'mobile'];
    const trackUnit = normalizeTrackUnit(options.trackUnit ?? layoutConfig?.trackUnit);
    const result = {};
    for (const key of breakpoints) {
      const section = layoutConfig && layoutConfig[key];
      const rows = Array.isArray(section)
        ? section
        : Array.isArray(section?.rows)
          ? section.rows
          : [];
      result[key] = compileGridTemplate(rows, trackUnit);
    }
    return result;
  }

  function applyLayoutStyle(config) {
    if (!config || typeof document === 'undefined') return;
    const styleText = buildLayoutStyleText(config);
    if (!styleText) return;
    let styleEl = document.getElementById(LAYOUT_STYLE_ID);
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = LAYOUT_STYLE_ID;
      document.head.appendChild(styleEl);
    }
    if (styleEl.textContent !== styleText) {
      styleEl.textContent = styleText;
    }
  }

  function buildLayoutStyleText(config) {
    if (!config) return '';
    const baseWidth = Number(config.baseWidth) || DEFAULT_BASE_WIDTH;
    const baseHeight = Number(config.baseHeight) || DEFAULT_BASE_HEIGHT;
    const columns = config.columns || {};
    const gaps = config.gaps || {};
    const templates = config.templates || {};

    const desktopTemplate = templates.desktop || DEFAULT_TEMPLATES.desktop;
    const tabletTemplate = templates.tablet || DEFAULT_TEMPLATES.tablet;
    const mobileTemplate = templates.mobile || DEFAULT_TEMPLATES.mobile;

    const desktopColumns = columns.desktop || DEFAULT_COLUMNS.desktop;
    const tabletColumns = columns.tablet || DEFAULT_COLUMNS.tablet;
    const mobileColumns = columns.mobile || DEFAULT_COLUMNS.mobile;

    const desktopGap = gaps.desktop || DEFAULT_GAPS.desktop;
    const tabletGap = gaps.tablet || DEFAULT_GAPS.tablet;
    const mobileGap = gaps.mobile || DEFAULT_GAPS.mobile;

    const desktopRows = desktopTemplate.rows || DEFAULT_TEMPLATES.desktop.rows;
    const tabletRows = tabletTemplate.rows || DEFAULT_TEMPLATES.tablet.rows;
    const mobileRows = mobileTemplate.rows || DEFAULT_TEMPLATES.mobile.rows;

    const desktopAreas = desktopTemplate.areas || DEFAULT_TEMPLATES.desktop.areas;
    const tabletAreas = tabletTemplate.areas || DEFAULT_TEMPLATES.tablet.areas;
    const mobileAreas = mobileTemplate.areas || DEFAULT_TEMPLATES.mobile.areas;

    const rootSelector = `#${DISPLAY_TILE_ID} .wdash-root`;
    const gridSelector = `#${DISPLAY_TILE_ID} .wdash-grid`;

    return [
      `${rootSelector} { --wdash-base-width:${baseWidth}px; --wdash-base-height:${baseHeight}px; }`,
      `${gridSelector} { grid-template-columns:${desktopColumns}; grid-template-rows:${desktopRows}; grid-template-areas:${desktopAreas}; gap:${desktopGap}; }`,
      `@media (max-width:1100px) { ${gridSelector} { grid-template-columns:${tabletColumns}; grid-template-rows:${tabletRows}; grid-template-areas:${tabletAreas}; gap:${tabletGap}; } }`,
      `@media (max-width:720px) { ${gridSelector} { grid-template-columns:${mobileColumns}; grid-template-rows:${mobileRows}; grid-template-areas:${mobileAreas}; gap:${mobileGap}; } }`
    ].join('\n');
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

  function normalizeTemplateAreas(value) {
    if (value == null) return '';
    const str = typeof value === 'string' ? value : String(value);
    const trimmed = str.trim();
    if (!trimmed) return '';
    if (trimmed.toLowerCase() === 'none') return 'none';
    return trimmed
      .replace(/["']/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeAreaToken(value) {
    if (value == null) return null;
    if (value === '.') return '.';
    if (typeof value !== 'string') return null;
    let token = value
      .trim()
      .replace(/[\u2018\u2019\u201a\u201b\u2032\u2035]/g, "'")
      .replace(/[\u201c\u201d\u201e\u201f\u2033\u2036]/g, '"');
    if (!token) return null;
    if (token === '.') return '.';
    token = token.replace(/^['"`]+|['"`]+$/g, '');
    token = token.replace(/['"`]/g, '');
    token = token.replace(/\s+/g, '-');
    token = token.trim();
    if (!token) return null;
    return token;
  }

  function normalizeTrackUnit(value) {
    if (typeof value !== 'string') return DEFAULT_TRACK_UNIT;
    const token = value.trim().toLowerCase();
    if (!token) return DEFAULT_TRACK_UNIT;
    if (token === '%' || token === 'percent' || token === 'percentage' || token === 'percents') {
      return 'percent';
    }
    if (token === 'px' || token === 'pixel' || token === 'pixels') {
      return 'px';
    }
    return DEFAULT_TRACK_UNIT;
  }

  function compileGridTemplate(layout, trackUnit = DEFAULT_TRACK_UNIT) {
    if (!Array.isArray(layout)) {
      return { areas: '"."', rows: 'repeat(1, minmax(0, 1fr))', rowCount: 1 };
    }
    const areaLines = [];
    const rowTracks = [];
    let rowCount = 0;
    for (const entry of layout) {
      const repeat = Math.max(1, Number(entry?.repeat) || 1);
      const columns = Array.isArray(entry?.columns)
        ? entry.columns
            .map(normalizeAreaToken)
            .filter(col => typeof col === 'string' && col.length)
        : [];
      if (!columns.length) continue;
      const track = normalizeTrackSize(entry?.height ?? entry?.rowHeight ?? entry?.size, trackUnit);
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

  function normalizeTrackSize(value, trackUnit = DEFAULT_TRACK_UNIT) {
    const defaultTrack = 'minmax(0, 1fr)';
    if (value == null) return defaultTrack;
    if (typeof value === 'number' && Number.isFinite(value)) {
      const safe = Math.max(0, value);
      return trackUnit === 'percent' ? `${safe}%` : `${safe}px`;
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

  function sanitizeColumns(value, fallback, trackUnit = DEFAULT_TRACK_UNIT) {
    if (Array.isArray(value)) {
      const tracks = value
        .map(item => normalizeTrackSize(item, trackUnit))
        .filter(Boolean);
      if (tracks.length) {
        return tracks.join(' ');
      }
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length) return trimmed.replace(/\s+/g, ' ');
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

  function resolvePercentPixelDistribution(percents, totalPercent, available) {
    if (!Array.isArray(percents) || !percents.length) {
      return {
        values: [],
        requestedSum: 0,
        scaledSum: 0,
        finalSum: 0,
        remainder: Math.max(0, Number(available) || 0),
        scale: 1
      };
    }

    const safeAvailable = Number.isFinite(available) && available > 0 ? available : 0;
    const requestedValues = percents.map(percent => (percent / totalPercent) * safeAvailable);
    const requestedSum = requestedValues.reduce((sum, value) => sum + value, 0);

    let scale = 1;
    if (safeAvailable > 0 && requestedSum > safeAvailable) {
      scale = safeAvailable / requestedSum;
    }

    const scaledValues = requestedValues.map(value => value * scale);
    const result = [];
    let running = 0;

    for (let i = 0; i < scaledValues.length; i += 1) {
      const remaining = safeAvailable - running;
      let next = Math.max(0, scaledValues[i]);
      if (remaining <= 0) {
        next = 0;
      } else if (i === scaledValues.length - 1) {
        next = remaining;
      } else if (next > remaining) {
        next = remaining;
      }
      result.push(next);
      running += next;
    }

    const finalSum = result.reduce((sum, value) => sum + value, 0);
    const scaledSum = scaledValues.reduce((sum, value) => sum + value, 0);
    const remainder = Math.max(0, safeAvailable - finalSum);

    return {
      values: result,
      requestedSum,
      scaledSum,
      finalSum,
      remainder,
      scale
    };
  }

  function adjustPercentRowTracks(rowsValue, rowCount, baseHeight, gapValue, frameGapValue, options = {}) {
    if (typeof rowsValue !== 'string' || !rowsValue.trim()) return null;
    if (!Number.isFinite(baseHeight) || baseHeight <= 0) return null;
    if (!Number.isFinite(rowCount) || rowCount <= 0) return null;

    const percents = extractPercentTracks(rowsValue);
    if (!percents || percents.length !== rowCount) return null;

    const rowGap = parseGapAxisPixels(gapValue, 'row');
    const verticalPadding = parsePaddingAxisTotal(frameGapValue, 'vertical');
    if (rowGap == null || verticalPadding == null) return null;

    const totalPercent = percents.reduce((sum, value) => sum + value, 0);
    if (!Number.isFinite(totalPercent) || totalPercent <= 0) return null;

    const available = baseHeight - verticalPadding - rowGap * Math.max(0, rowCount - 1);
    if (!Number.isFinite(available) || available <= 0) return null;

    const distribution = resolvePercentPixelDistribution(percents, totalPercent, available);
    const pixelValues = distribution.values;

    if (options && options.collector && typeof options.collector.recordRow === 'function') {
      options.collector.recordRow({
        breakpoint: options.breakpoint || 'desktop',
        raw: rowsValue,
        percents: percents.slice(),
        pixels: pixelValues.slice(),
        available,
        baseHeight,
        rowGap,
        verticalPadding,
        totalPercent,
        rowCount,
        requestedPixels: distribution.requestedSum,
        scaledPixels: distribution.scaledSum,
        finalPixels: distribution.finalSum,
        remainder: distribution.remainder,
        scale: distribution.scale
      });
    }

    return pixelValues.map(formatPixelTrack).join(' ');
  }

  function adjustPercentColumnTracks(columnsValue, baseWidth, gapValue, frameGapValue, options = {}) {
    if (typeof columnsValue !== 'string' || !columnsValue.trim()) return null;
    if (!Number.isFinite(baseWidth) || baseWidth <= 0) return null;

    const percents = extractPercentTracks(columnsValue);
    if (!percents || !percents.length) return null;

    const columnGap = parseGapAxisPixels(gapValue, 'column');
    const horizontalPadding = parsePaddingAxisTotal(frameGapValue, 'horizontal');
    if (columnGap == null || horizontalPadding == null) return null;

    const totalPercent = percents.reduce((sum, value) => sum + value, 0);
    if (!Number.isFinite(totalPercent) || totalPercent <= 0) return null;

    const columnCount = percents.length;
    const available = baseWidth - horizontalPadding - columnGap * Math.max(0, columnCount - 1);
    if (!Number.isFinite(available) || available <= 0) return null;

    const distribution = resolvePercentPixelDistribution(percents, totalPercent, available);
    const pixelValues = distribution.values;

    if (options && options.collector && typeof options.collector.recordColumn === 'function') {
      options.collector.recordColumn({
        breakpoint: options.breakpoint || 'desktop',
        raw: columnsValue,
        percents: percents.slice(),
        pixels: pixelValues.slice(),
        available,
        baseWidth,
        columnGap,
        horizontalPadding,
        totalPercent,
        columnCount,
        requestedPixels: distribution.requestedSum,
        scaledPixels: distribution.scaledSum,
        finalPixels: distribution.finalSum,
        remainder: distribution.remainder,
        scale: distribution.scale
      });
    }

    return pixelValues.map(formatPixelTrack).join(' ');
  }

  function extractPercentTracks(value) {
    if (typeof value !== 'string') return null;
    const tokens = value
      .trim()
      .replace(/\s+/g, ' ')
      .split(' ')
      .filter(Boolean);
    if (!tokens.length) return null;
    const percents = tokens.map(token => {
      const match = token.match(/^(-?\d+(?:\.\d+)?)%$/);
      if (!match) return null;
      const numeric = Number(match[1]);
      return Number.isFinite(numeric) ? Math.max(0, numeric) : null;
    });
    if (percents.some(value => value == null)) return null;
    return percents;
  }

  function parseGapAxisPixels(value, axis) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    const tokens = trimmed.split(/\s+/);
    if (!tokens.length) return null;
    const index = axis === 'column' && tokens.length > 1 ? 1 : 0;
    const token = tokens[index];
    return parsePixelToken(token);
  }

  function parsePaddingAxisTotal(value, axis) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    const tokens = trimmed.split(/\s+/);
    if (!tokens.length) return null;
    let components;
    if (tokens.length === 1) {
      const parsed = parsePixelToken(tokens[0]);
      if (parsed == null) return null;
      components = [parsed, parsed, parsed, parsed];
    } else if (tokens.length === 2) {
      const vertical = parsePixelToken(tokens[0]);
      const horizontal = parsePixelToken(tokens[1]);
      if (vertical == null || horizontal == null) return null;
      components = [vertical, horizontal, vertical, horizontal];
    } else if (tokens.length === 3) {
      const top = parsePixelToken(tokens[0]);
      const horizontal = parsePixelToken(tokens[1]);
      const bottom = parsePixelToken(tokens[2]);
      if (top == null || horizontal == null || bottom == null) return null;
      components = [top, horizontal, bottom, horizontal];
    } else {
      const top = parsePixelToken(tokens[0]);
      const right = parsePixelToken(tokens[1]);
      const bottom = parsePixelToken(tokens[2]);
      const left = parsePixelToken(tokens[3]);
      if (top == null || right == null || bottom == null || left == null) return null;
      components = [top, right, bottom, left];
    }
    if (axis === 'vertical') {
      return components[0] + components[2];
    }
    return components[1] + components[3];
  }

  function parsePixelToken(token) {
    if (typeof token !== 'string') return null;
    const match = token.match(/^(-?\d+(?:\.\d+)?)px$/i);
    if (!match) return null;
    const numeric = Number(match[1]);
    if (!Number.isFinite(numeric)) return null;
    return Math.max(0, numeric);
  }

  function formatPixelTrack(value) {
    if (!Number.isFinite(value) || value < 0) return '0px';
    const rounded = Number(value.toFixed(4));
    return `${rounded}px`;
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
.wdash-frame { position: relative; width: var(--wdash-render-width); height: var(--wdash-render-height); overflow: hidden; box-sizing: border-box; }
.wdash-temp-unit-indicator:focus-visible { outline: 2px solid rgba(90,170,255,0.9); outline-offset: 2px; }
  .wdash { width: var(--wdash-base-width); height: var(--wdash-base-height); font-family: 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif; color: #f4f6ff; background: linear-gradient(145deg, rgba(27,35,58,0.95), rgba(13,18,32,0.95)); backdrop-filter: blur(4px); border-radius: 12px; --wdash-frame-gap-desktop: 14px; --wdash-frame-gap-tablet: 14px; --wdash-frame-gap-mobile: 14px; --wdash-frame-gap: var(--wdash-frame-gap-desktop); padding: var(--wdash-frame-gap, 18px); box-sizing: border-box; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.05); transform-origin: top left; transform: scale(var(--wdash-scale)); }
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
.wdash-card-header--ambient { width: 100%; align-items: center; }
.wdash-card-header--ambient .wdash-ambient-name { margin: 0; }
.wdash-ambient-header-meta { margin-left: auto; display: inline-flex; align-items: center; gap: 10px; }
.wdash-card-header--ambient .wdash-ambient-rotation { margin: 0; text-align: right; min-width: 0; }
.wdash-card-header--air { align-items: center; gap: 10px; }
.wdash-card-header--air .wdash-card-header-main { flex-direction: row; align-items: baseline; gap: 8px; }
.wdash-card--solar .wdash-card-header { position: relative; z-index: 2; background: transparent; }
.wdash-air-header-meta { margin-left: auto; display: inline-flex; align-items: center; gap: 8px; }
.wdash-air-source { font-size: 0.62rem; letter-spacing: 0.08em; text-transform: uppercase; color: #9badcf; }
.wdash-air-battery { display: inline-flex; align-items: center; }
.wdash-card-header--temp-wind { align-items: center; gap: 10px; position: relative; z-index: 2; padding-bottom: 10px; margin-bottom: 0; background: transparent; }
.wdash-card-header--temp-wind .wdash-card-header-main { align-items: flex-start; text-align: left; }
.wdash-temp-wind-header-meta { margin-left: auto; display: inline-flex; align-items: center; gap: 8px; }
.wdash-temp-wind-battery { display: inline-flex; align-items: center; }
.wdash-updated { display: inline-flex; flex-direction: column; align-items: flex-end; gap: 2px; font-size: 0.68rem; opacity: 0.7; text-align: right; }
.wdash-updated-line { white-space: nowrap; line-height: 1.2; }
.wdash-updated-line--secondary { font-size: 0.62rem; opacity: 0.65; }
.wdash-clock-time { font-family: 'SFMono-Regular', 'Roboto Mono', 'Menlo', 'Courier New', monospace; font-variant-numeric: tabular-nums; letter-spacing: 0.02em; }
.wdash-card--temp-wind { grid-area: temp-wind; gap: 6px; padding-block: 5px; --temp-wind-gauge-center-inset: 26%; --temp-wind-compass-block-inset: 24%; --temp-wind-compass-inline-inset: 20%; position: relative; }
.wdash-card--temp-wind .wdash-gauge, .wdash-card--temp-wind .wdash-wind-compass { width: 100%; height: 100%; max-width: none; max-height: none; }
.wdash-card--temp-wind .wdash-metric-row--gauge { max-width: 100%; }
.wdash-card--temp-wind .wdash-temp-wind-main { padding-block: 2px; position: relative; z-index: 1; }
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
.wdash-card--air { grid-area: air; gap: 8px; }
.wdash-temp, .wdash-wind, .wdash-solar, .wdash-pressure { display: flex; flex-direction: column; gap: 10px; flex: 1; }
.wdash-card--temp-wind .wdash-temp, .wdash-card--temp-wind .wdash-wind { align-items: stretch; justify-content: center; min-width: 0; min-height: 0; }
.wdash-pressure { gap: 10px; }
.wdash-temp-wind-main { display: flex; gap: 14px; flex: 1; align-items: stretch; min-height: 0; }
.wdash-temp-wind-main > .wdash-temp, .wdash-temp-wind-main > .wdash-wind { flex: 1; min-width: 0; min-height: 0; }
.wdash-temp-wind-details { display: flex; justify-content: space-between; gap: 12px; }
.wdash-temp { align-items: center; }
.wdash-wind { align-items: center; }
.wdash-gauge, .wdash-wind-compass { position: relative; width: 100%; height: 100%; margin: 0 auto; }
  .wdash-gauge-svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.wdash-gauge-center { position: absolute; inset: var(--temp-wind-gauge-center-inset, 26%); border-radius: 50%; background: rgba(5,10,20,0.85); display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 12px 10px; gap: 6px; text-align: center; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.04); }
.wdash-gauge-current { position: relative; display: flex; align-items: center; justify-content: center; width: 100%; }
.wdash-gauge-value { font-size: 2.32rem; font-weight: 800; letter-spacing: -0.02em; display: block; width: 100%; text-align: center; }
.wdash-gauge-value-number { display: block; text-align: center; }
.wdash-temp-unit-indicator { background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.24); border-radius: 50%; color: #f5f9ff; font-size: 0.78rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; width: 36px; height: 36px; cursor: pointer; transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease; line-height: 1; display: inline-flex; align-items: center; justify-content: center; }
.wdash-temp-unit-indicator--gauge { position: absolute; top: 50%; right: -20px; transform: translate(0, -50%); }
.wdash-temp-unit-indicator:hover { background: rgba(255,255,255,0.16); border-color: rgba(255,255,255,0.35); }
.wdash-temp-unit-indicator:active { background: rgba(77,167,255,0.28); border-color: rgba(77,167,255,0.6); }
.wdash-gauge-label { font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.12em; color: #9badcf; }
.wdash-temp-extrema { display: flex; flex-direction: column; align-items: center; gap: 1px; }
.wdash-temp-extrema-label { font-size: 0.6rem; letter-spacing: 0.12em; text-transform: uppercase; color: #8ea0c8; }
.wdash-temp-extrema-value { font-size: 0.95rem; font-weight: 600; color: #dce8ff; }
.wdash-temp-extrema--high .wdash-temp-extrema-value { color: #ffb95a; }
.wdash-temp-extrema--low .wdash-temp-extrema-value { color: #7cc5ff; }
.wdash-metric-row { display: flex; flex-wrap: wrap; gap: 10px; width: 100%; }
.wdash-metric-row--compact { display: grid; grid-template-columns: repeat(var(--wdash-columns, 4), minmax(0, 1fr)); gap: 4px 8px; align-content: start; }
.wdash-metric { flex: 1 1 auto; min-width: 0; background: transparent; border-radius: 12px; padding: 6px 8px; display: flex; flex-direction: column; gap: 2px; text-align: center; box-shadow: none; }
.wdash-metric--tinted { box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08); }
.wdash-metric-row--layout-fill { flex-wrap: nowrap; }
.wdash-metric-row--layout-fill .wdash-metric { flex-grow: 0; flex-shrink: 1; flex-basis: auto; }
.wdash-metric-label { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.08em; color: #8ea0c8; }
.wdash-metric-value { font-size: 0.98rem; font-weight: 600; color: #f4f6ff; white-space: nowrap; }
.wdash-metric--tinted .wdash-metric-label { color: #f4f6ff; opacity: 0.9; }
.wdash-metric-sub { font-size: 0.68rem; color: #9badcf; }
.wdash-metric-row--gauge { display: grid; grid-template-columns: repeat(var(--wdash-columns, 3), minmax(0, 1fr)); width: 100%; max-width: 100%; margin: 0 auto; gap: 4px 12px; justify-items: center; align-items: end; }
.wdash-metric-row--gauge .wdash-metric { background: transparent; box-shadow: none; padding: 0; gap: 3px; min-width: 0; align-items: center; }
.wdash-metric-row--gauge .wdash-metric-label { font-size: 0.58rem; letter-spacing: 0.1em; color: #93a5d0; white-space: nowrap; }
.wdash-metric-row--gauge .wdash-metric-value { font-size: 0.92rem; }
.wdash-metric-row--gauge .wdash-metric-sub { font-size: 0.68rem; color: #a6b5d6; }
.wdash-unit { font-size: 0.9rem; margin-left: 2px; opacity: 0.8; }
.wdash-wind-overlay { position: absolute; inset: var(--temp-wind-compass-block-inset, 24%) var(--temp-wind-compass-inline-inset, 20%); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; text-align: center; pointer-events: none; text-shadow: 0 2px 8px rgba(0,0,0,0.45); }
.wdash-wind-bearing-line { display: inline-flex; align-items: baseline; gap: 4px; font-weight: 700; }
.wdash-wind-bearing { font-size: 0.78rem; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: #dbe8ff; }
.wdash-wind-speed { display: inline-flex; align-items: baseline; gap: 4px; font-weight: 700; }
.wdash-wind-speed-value { font-size: 2.1rem; color: #5bd6ff; }
.wdash-wind-heading { font-size: 0.78rem; color: #9badcf; letter-spacing: 0.08em; }
  .wdash-wind-compass svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; filter: drop-shadow(0 8px 18px rgba(0,0,0,0.4)); }
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
.wdash-ambient-circle > .wdash-ambient-label { position: relative; z-index: 2; }
.wdash-ambient-reading { font-size: 1.8rem; font-weight: 700; }
.wdash-ambient-label { font-size: 0.64rem; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.8; }
.wdash-ambient-circle--temp { background: transparent; }
.wdash-ambient-circle--humidity { background: transparent; }
.wdash-ambient-next { --wdash-next-color: #4da7ff; position: absolute; top: 92px; left: -36px; width: 40px; height: 40px; border: none; padding: 0; border-radius: 50%; background: transparent; color: var(--wdash-next-color); display: grid; place-items: center; cursor: pointer; filter: drop-shadow(0 8px 16px rgba(0,0,0,0.45)); transition: transform 0.2s ease, filter 0.2s ease, color 0.2s ease; }
.wdash-ambient-next:hover:not(:disabled) { transform: translateY(-1px); filter: drop-shadow(0 16px 26px rgba(0,0,0,0.55)); }
.wdash-ambient-next:active:not(:disabled) { transform: translateY(1px); filter: drop-shadow(0 10px 18px rgba(0,0,0,0.45)); }
.wdash-ambient-next:disabled { cursor: not-allowed; opacity: 0.55; filter: drop-shadow(0 8px 16px rgba(0,0,0,0.35)); }
.wdash-ambient-next-icon { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.wdash-ambient-timer { --wdash-timer-color: #29d88b; position: absolute; top: 92px; right: -36px; width: 40px; height: 40px; border: none; padding: 0; border-radius: 50%; background: transparent; color: var(--wdash-timer-color); display: grid; place-items: center; cursor: pointer; filter: drop-shadow(0 8px 16px rgba(0,0,0,0.45)); transition: transform 0.2s ease, filter 0.2s ease, color 0.2s ease; }
.wdash-ambient-timer:hover:not(:disabled) { transform: translateY(-1px); filter: drop-shadow(0 16px 26px rgba(0,0,0,0.55)); }
.wdash-ambient-timer:active:not(:disabled) { transform: translateY(1px); filter: drop-shadow(0 10px 18px rgba(0,0,0,0.45)); }
.wdash-ambient-timer.is-paused { --wdash-timer-color: #ff6b63; }
.wdash-ambient-timer:disabled { cursor: not-allowed; opacity: 0.55; filter: drop-shadow(0 8px 16px rgba(0,0,0,0.35)); }
.wdash-ambient-timer-icon { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.wdash-ambient-timer-countdown { position: relative; z-index: 1; font-size: 0.76rem; font-weight: 700; letter-spacing: 0.02em; color: #f5f9ff; text-shadow: 0 2px 6px rgba(0,0,0,0.5); }
.wdash-ambient-name { font-weight: 700; }
.wdash-ambient-rotation { font-size: 0.75rem; color: #8ea0c8; }
.wdash-ambient-rotation:empty { display: none; }
.wdash-ambient--empty .wdash-ambient-reading { opacity: 0.6; }
.wdash-rain-main { display: grid; grid-template-columns: minmax(0, 0.85fr) 1fr 1fr; gap: 18px; align-items: stretch; flex: 1; height: 100%; }
.wdash-rain-col { min-height: 0; }
.wdash-rain-col--drop { display: flex; align-items: center; justify-content: center; }
.wdash-rain-col--drop svg { width: auto; height: var(--wdash-rain-drop-height, 80%); max-width: 100%; max-height: var(--wdash-rain-drop-height, 80%); display: block; filter: drop-shadow(0 6px 12px rgba(0,0,0,0.3)); overflow: visible; }
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
.wdash-pressure-main { display: flex; flex-direction: column; gap: 16px; align-items: stretch; }
.wdash-pressure-band { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: center; justify-items: center; gap: 12px; }
.wdash-pressure-band-cell { display: flex; align-items: center; justify-content: center; text-align: center; }
.wdash-pressure-reading-wrap { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.wdash-pressure-toggle { display: inline-flex; gap: 4px; padding: 4px; border-radius: 999px; background: rgba(255,255,255,0.05); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.04); }
.wdash-pressure-button { border: none; background: transparent; color: #9badcf; font-size: 0.7rem; font-weight: 600; text-transform: none; letter-spacing: 0.08em; padding: 4px 10px; border-radius: 999px; cursor: pointer; transition: all 0.2s ease; }
.wdash-pressure-button:hover { color: #f4f6ff; }
.wdash-pressure-button.is-active { background: linear-gradient(140deg, #5ab3ff, #3f8bff); color: #0d1426; box-shadow: 0 8px 16px rgba(74,150,255,0.35); }
.wdash-pressure-reading { font-size: 1.82rem; font-weight: 700; color: #e3edff; min-height: 2.2rem; display: flex; align-items: center; justify-content: center; }
.wdash-pressure-outlook-icon { width: 48px; height: 48px; display: inline-flex; align-items: center; justify-content: center; border-radius: 12px; overflow: visible; }
.wdash-pressure-outlook-icon svg { width: 100%; height: 100%; display: block; overflow: visible; }
.wdash-pressure-icon-svg { width: 100%; height: 100%; }
.wdash-pressure-outlook-label { font-weight: 700; color: #ffb95a; text-transform: uppercase; letter-spacing: 0.06em; font-size: 0.75rem; white-space: nowrap; display: inline-flex; align-items: center; justify-content: center; padding: 4px 10px; border-radius: 999px; background: rgba(255,255,255,0.06); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08); }
.wdash-temp-wind-footer { position: relative; }
.wdash-temp-wind-footer .wdash-temp-wind-details { position: relative; z-index: 1; }
.wdash-pressure-value { display: none; }
.wdash-card--pressure[data-pressure-mode="relative"] .wdash-pressure-value[data-pressure-value="relative"],
.wdash-card--pressure[data-pressure-mode="absolute"] .wdash-pressure-value[data-pressure-value="absolute"] { display: inline-flex; }
.wdash-pressure-stats .wdash-metric-value { font-size: 0.88rem; }
.wdash-solar { display: flex; flex-direction: column; gap: 6px; flex: 1; }
.wdash-sun-graphic { position: relative; width: 100%; aspect-ratio: 2.6 / 1; border-radius: 16px; background: transparent; overflow: hidden; }
.wdash-card--solar .wdash-sun-graphic { margin-top: -20px; }
.wdash-sun-arc { position: absolute; inset: 16% 12% 42%; border: 2px solid rgba(255,255,255,0.25); border-bottom: none; border-radius: 100% 100% 0 0 / 100% 100% 0 0; }
.wdash-sun-horizon { position: absolute; left: 12%; right: 12%; bottom: 42%; height: 2px; background: rgba(255,255,255,0.25); }
.wdash-sun-svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.wdash-sun-svg .wdash-sun-arc { fill: none; stroke: rgba(255,255,255,0.25); stroke-width: 2.5; vector-effect: non-scaling-stroke; }
.wdash-sun-svg .wdash-sun-marker { transition: opacity 0.3s ease; }
.wdash-sun-svg .wdash-sun-marker.is-night { opacity: 0; }
.wdash-sun-svg .wdash-sun-marker-core { filter: none; }
.wdash-sun-svg .wdash-sun-marker-glow { opacity: 0.85; }
.wdash-sun-html-metric { position: absolute; display: flex; flex-direction: column; align-items: center; gap: 2px; transform: translate(-50%, -50%); text-align: center; }
.wdash-sun-metric-label { font-size: 0.8rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #8ea0c8; }
.wdash-sun-metric-value { font-size: 0.8rem; font-weight: 600; color: #f4f6ff; }
.wdash-sun-metric-subvalue { font-size: 0.75rem; font-weight: 600; margin-top: 0.15rem; color: #f4f6ff; }
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
.wdash-sun-time { position: absolute; font-size: 0.8rem; font-weight: 600; color: #c9d8ff; transform: translate(-50%, -100%); line-height: 1; white-space: nowrap; }
.wdash-sun-time--rise { /* Positioned by inline style */ }
.wdash-sun-time--set { /* Positioned by inline style */ }
.wdash-metric-row--compact .wdash-metric { flex: unset; min-height: 0; width: 100%; height: 100%; padding: 4px 6px; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 2px 6px; text-align: left; }
.wdash-metric-row--compact .wdash-metric-label { font-size: 0.56rem; letter-spacing: 0.12em; align-self: center; }
.wdash-metric-row--compact .wdash-metric-value { font-size: 0.96rem; justify-self: end; align-self: center; }
.wdash-metric-row--compact .wdash-metric-sub { grid-column: 1 / -1; justify-self: start; }
.wdash-air-metrics { grid-auto-rows: auto; }
.wdash-air-metrics .wdash-metric-label { white-space: normal; line-height: 1.3; overflow-wrap: anywhere; }
.wdash-air-metrics .wdash-metric-value { font-size: 1rem; white-space: nowrap; text-align: right; }
.wdash-air-metrics .wdash-metric--placeholder { visibility: hidden; pointer-events: none; }
.wdash-air-empty { flex: 1 1 auto; display: flex; align-items: center; justify-content: center; min-height: 72px; padding: 14px; border-radius: 10px; background: rgba(255,255,255,0.04); font-size: 0.86rem; letter-spacing: 0.08em; text-transform: uppercase; color: #9badcf; opacity: 0.8; text-align: center; }
@media (max-width: 1100px) {
  .wdash-grid { gap: var(--wdash-grid-gap-tablet, ${DEFAULT_GAPS.tablet}); grid-template-columns: var(--wdash-grid-columns-tablet, ${DEFAULT_COLUMNS.tablet}); grid-template-rows: var(--wdash-grid-rows-tablet, ${DEFAULT_TEMPLATES.tablet.rows}); grid-template-areas: var(--wdash-grid-areas-tablet, ${DEFAULT_TEMPLATES.tablet.areas}); }
  .wdash { --wdash-frame-gap: var(--wdash-frame-gap-tablet, var(--wdash-frame-gap-desktop, 18px)); }
}
@media (max-width: 720px) {
  .wdash-grid { gap: var(--wdash-grid-gap-mobile, ${DEFAULT_GAPS.mobile}); grid-template-columns: var(--wdash-grid-columns-mobile, ${DEFAULT_COLUMNS.mobile}); grid-template-rows: var(--wdash-grid-rows-mobile, ${DEFAULT_TEMPLATES.mobile.rows}); grid-template-areas: var(--wdash-grid-areas-mobile, ${DEFAULT_TEMPLATES.mobile.areas}); }
  .wdash { --wdash-frame-gap: var(--wdash-frame-gap-mobile, var(--wdash-frame-gap-tablet, var(--wdash-frame-gap-desktop, 18px))); }
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

  function truncateText(value, maxLength) {
    if (value == null) return '';
    const str = typeof value === 'string' ? value : String(value);
    const trimmed = str.trim();
    if (!trimmed) return '';
    if (!Number.isFinite(maxLength) || maxLength <= 0 || trimmed.length <= maxLength) {
      return trimmed;
    }
    const slice = trimmed.slice(0, Math.max(0, maxLength - 1)).trim();
    return slice ? `${slice}…` : trimmed.slice(0, maxLength);
  }

  function formatTemperature(value, options = {}) {
    const decimalsInput = Number(options.decimals);
    const decimals = Number.isFinite(decimalsInput) ? decimalsInput : 1;
    const includeUnit = options.includeUnit === true;
    const sourceUnit = normalizeTemperatureUnit(options.sourceUnit) || 'F';
    const targetUnit = normalizeTemperatureUnit(options.unit) || getDisplayTemperatureUnit();
    const numeric = toNumber(value);
    if (!Number.isFinite(numeric)) {
      return includeUnit ? `--°${targetUnit}` : '--°';
    }
    const converted = convertTemperatureValue(numeric, sourceUnit, targetUnit);
    if (!Number.isFinite(converted)) {
      return includeUnit ? `--°${targetUnit}` : '--°';
    }
    const suffix = includeUnit ? `°${targetUnit}` : '°';
    return `${converted.toFixed(decimals)}${suffix}`;
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

  function extractJson(text) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    return text.slice(start, end + 1);
  }

  function noteInvalidJson(tileId, reason) {
    if (!tileId || tileId === DISPLAY_TILE_ID) return;
    if (invalidJsonTiles.has(tileId)) return;
    const suffix = reason ? ` (${reason})` : '';
    console.info(`[WeatherDashboard] Ignoring non-JSON content from ${tileId}${suffix}`);
    invalidJsonTiles.add(tileId);
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

  if (!IS_TEST_ENV && typeof window !== 'undefined') {
    window.weatherDashboard = window.weatherDashboard || {};
    window.weatherDashboard.logLayoutDiagnostics = () => logLayoutDiagnostics(null, { force: true });
    window.weatherDashboard.captureLayoutDiagnostics = () => layoutState.lastDiagnostics;
  }

  if (IS_TEST_ENV) {
    const target = typeof window !== 'undefined' ? window : globalThis;
    target.__WDASH_TEST_HOOKS__ = target.__WDASH_TEST_HOOKS__ || {};
    Object.assign(target.__WDASH_TEST_HOOKS__, {
      updateTempWindCard,
      tempWindState,
      applyLayoutOverrides,
      layoutState,
      resolveMeasuredBaseDimensions,
      measureDisplayTileBaseDimensions,
      resetTileMeasurement,
      logLayoutDiagnostics,
      buildLayoutDiagnosticsContext,
      applyTemperatureUnitsFromMetadata,
      setTemperatureDisplayUnit,
      setTemperatureInputUnit,
      getDisplayTemperatureUnit,
      getInputTemperatureUnit
    });
  }
})();
