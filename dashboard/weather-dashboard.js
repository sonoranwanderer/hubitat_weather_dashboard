// weather-dashboard.js
//
// JavaScript presentation layer for the Hubitat dashboard tile.  This script is
// intended to be loaded via the JavaScript Injector driver (tile-0).  It reads the
// JSON payload exposed by the Weather Dashboard virtual device (tile-1, optional
// tile-2/tile-3) and renders an information dense layout inspired by the Ecowitt
// console.

(() => {
  const DISPLAY_TILE_ID = 'tile-0';
  const DATA_TILE_IDS = ['tile-1', 'tile-2', 'tile-3'];
  const CHUNK_NAMESPACE = 'weather-dashboard';
  const CSS_ID = 'weather-dashboard-css';
  const TEMP_RANGE = { min: -40, max: 120 };
  const AMBIENT_ROTATION_DEFAULT_SECONDS = 12;
  const AMBIENT_ROTATION_MIN_SECONDS = 3;
  const INIT_RETRY_LIMIT = 40;
  const INIT_RETRY_DELAY = 250;
  const DATA_REFRESH_INTERVAL = 5000;
  const BASE_WIDTH = 1200;
  const BASE_HEIGHT = 900;

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

  const CARD_TITLES = {
    temperature: 'Outdoor Temperature',
    wind: 'Wind',
    rain: 'Rainfall',
    pressure: 'Barometer',
    solarSun: 'Sun, Solar & UV',
    air: 'Air Quality'
  };

  let ambientRotation = {
    timer: null,
    sensors: [],
    index: 0,
    interval: AMBIENT_ROTATION_DEFAULT_SECONDS * 1000,
    tempUnit: '°F',
    humidityUnit: '%'
  };

  const dataTileObservers = new Map();
  let domObserver = null;
  let scaleObserver = null;
  let scaleResizeHandler = null;
  const placeholderLogged = new Set();
  let pressureMode = 'relative';

  whenDomReady(init);

  function whenDomReady(callback) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', callback, { once: true });
    } else {
      callback();
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
      <div class="wdash-root" style="--wdash-base-width:${BASE_WIDTH}px;--wdash-base-height:${BASE_HEIGHT}px;">
        <div class="wdash-frame">
          <div class="wdash" role="presentation">
            <div class="wdash-grid" data-empty="true"></div>
          </div>
        </div>
      </div>
    `;

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

    applyScale();

    if (!payload) {
      grid.dataset.empty = 'true';
      grid.innerHTML = `<div class="wdash-empty">Waiting for weather data…</div>`;
      clearAmbientRotation();
      toggleSourceTileMask(false);
      return;
    }

    grid.dataset.empty = 'false';
    grid.innerHTML = buildMarkup(payload);
    setupAmbientRotation(payload);
    setupInteractiveComponents(grid);
    toggleSourceTileMask(true);
  }

  function readPayloads() {
    const payloads = [];
    const chunkEnvelopes = [];
    for (const id of DATA_TILE_IDS) {
      const tile = byId(id);
      if (!tile) continue;
      const text = getTileText(tile);
      if (!text) continue;
      if (/please select an attribute/i.test(text)) {
        if (!placeholderLogged.has(id)) {
          placeholderLogged.add(id);
          console.warn(`[WeatherDashboard] ${id} is still showing the Hubitat placeholder text. Confirm the tile template is set to Attribute and the dashboardData attribute is selected.`);
        }
        continue;
      }
      const json = extractJson(text);
      if (!json) continue;
      try {
        const parsed = JSON.parse(json);
        if (isChunkEnvelope(parsed)) {
          chunkEnvelopes.push({ ...parsed, tileId: id });
        } else {
          payloads.push(parsed);
        }
      } catch (err) {
        console.warn('[WeatherDashboard] Failed to parse payload from', id, err, json.slice(0, 1200));
      }
    }
    const assembled = assembleChunkPayload(chunkEnvelopes);
    if (assembled) {
      payloads.push(assembled);
    }
    return payloads;
  }

  function toggleSourceTileMask(hide) {
    for (const id of DATA_TILE_IDS) {
      const tile = byId(id);
      if (!tile) continue;
      tile.classList.toggle('wdash-source-tile', hide);
    }
  }

  function ensureDataTileObservers() {
    for (const id of DATA_TILE_IDS) {
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
    const scale = Math.max(0.1, Math.min(width / BASE_WIDTH, height / BASE_HEIGHT));
    const renderWidth = BASE_WIDTH * scale;
    const renderHeight = BASE_HEIGHT * scale;
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
        buildTemperatureCard(data),
        buildWindCard(data),
        buildAmbientSensorCard(data),
        buildRainCard(data),
        buildPressureCard(data),
        buildSolarSunCard(data),
        buildAirQualityCard(data)
      ].join('')}
    `;
  }

  function buildTemperatureCard(data) {
    const outdoor = data.outdoor || {};
    const temp = toNumber(outdoor.temperatureF);
    const high = toNumber(outdoor.dailyHighF);
    const low = toNumber(outdoor.dailyLowF);
    const feels = toNumber(outdoor.feelsLikeF);
    const dew = toNumber(outdoor.dewPointF);
    const humidity = toNumber(outdoor.humidity);
    const trend = toNumber(outdoor.trendFPerHour);

    const tempColor = colorForTemp(temp);
    const indicator = gaugeIndicator(temp);
    const dewText = formatTemperature(dew);
    const humidityText = formatPercent(humidity, 0);
    const trendText = formatSigned(trend, 2, '°/hr');
    const feelsText = formatTemperature(feels);
    const highText = formatTemperature(high);
    const lowText = formatTemperature(low);

    return `
      <section class="wdash-card wdash-card--temp">
        ${cardHeader(CARD_TITLES.temperature, data)}
        <div class="wdash-temp">
          <div class="wdash-gauge" style="--gauge-indicator:${indicator};--gauge-color-a:${tempColor.colors[0]};--gauge-color-b:${tempColor.colors[1]};--gauge-color-mid:${tempColor.mid};--gauge-band-progress:${tempColor.progress};">
            <div class="wdash-gauge-ring"></div>
            <div class="wdash-gauge-pointer"></div>
            <div class="wdash-gauge-center">
              <div class="wdash-temp-extrema wdash-temp-extrema--high">
                <span class="wdash-temp-extrema-label">High</span>
                <span class="wdash-temp-extrema-value">${highText}</span>
              </div>
              <div class="wdash-gauge-current">
                <span class="wdash-gauge-value">${formatTemperature(temp)}</span>
                <span class="wdash-gauge-label">Current</span>
              </div>
              <div class="wdash-temp-extrema wdash-temp-extrema--low">
                <span class="wdash-temp-extrema-label">Low</span>
                <span class="wdash-temp-extrema-value">${lowText}</span>
              </div>
            </div>
          </div>
          ${buildMetricRow([
            { label: 'Feels Like', value: feelsText },
            { label: 'Dew Point', value: dewText },
            { label: 'Humidity', value: humidityText },
            { label: 'Trend', value: trendText }
          ], 'wdash-temp-details', { variant: 'gauge', columns: 4 })}
        </div>
      </section>
    `;
  }

  function buildWindCard(data) {
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

    const bearingLabel = dirText || (Number.isFinite(dirDegrees) ? degreesToCardinal(dirDegrees) : '--');
    const compass = windCompassSvg(dirDegrees, avgDir);
    const gustText = Number.isFinite(gust) ? `${formatNumber(gust, 1)} mph` : '--';
    const avgSpeedText = Number.isFinite(avgSpeed) ? `${formatNumber(avgSpeed, 1)} mph` : '--';

    const headingParts = [];
    if (bearingLabel && bearingLabel !== '--') headingParts.push(bearingLabel);
    headingParts.push(formatDegrees(dirDegrees));
    const headingValue = headingParts.join(' ').trim();

    return `
      <section class="wdash-card wdash-card--wind">
        ${cardHeader(CARD_TITLES.wind, data)}
        <div class="wdash-wind">
          <div class="wdash-wind-compass" aria-label="Wind direction ${bearingLabel} ${formatDegrees(dirDegrees)}">
            ${compass}
            <div class="wdash-wind-overlay">
              <span class="wdash-wind-bearing">${bearingLabel}</span>
              <span class="wdash-wind-speed">
                <span class="wdash-wind-speed-value">${formatNumber(speed, 1)}</span>
                <span class="wdash-unit">mph</span>
              </span>
              <span class="wdash-wind-heading">${formatDegrees(dirDegrees)}</span>
            </div>
          </div>
          ${buildMetricRow([
            { label: 'Gust', value: gustText },
            { label: `${windowMins} min avg`, value: avgSpeedText, sub: `${avgDirText || '--'} (${formatDegrees(avgDir)})` },
            { label: 'Heading', value: headingValue }
          ], 'wdash-wind-metrics', { variant: 'gauge', columns: 3 })}
        </div>
      </section>
    `;
  }

  function buildAmbientSensorCard(data) {
    const sensors = Array.isArray(data.ambientSensors) ? data.ambientSensors.filter(Boolean) : [];
    const hasSensors = sensors.length > 0;
    const sensor = sensors[0] || {};
    const tempUnit = data.ambientTemperatureUnit || '°F';
    const humidityUnit = data.ambientHumidityUnit || '%';
    const countLabel = hasSensors
      ? (sensors.length > 1 ? `${sensors.length} locations` : (sensor.name || ''))
      : 'No sensors configured';
    const rotationText = hasSensors && sensors.length > 1 ? `Sensor 1 of ${sensors.length}` : '';
    const tempDisplay = formatAmbientValue(sensor.temperatureF, tempUnit, 1);
    const humidityDisplay = formatAmbientValue(sensor.humidity, humidityUnit, 0);
    const nameDisplay = sensor.name || (hasSensors ? '' : 'No sensors configured');

    return `
      <section class="wdash-card wdash-card--ambient${hasSensors ? '' : ' wdash-ambient--empty'}">
        <header class="wdash-card-header">
          <h3>Local Sensors</h3>
          <span class="wdash-updated">${escapeHtml(countLabel)}</span>
        </header>
        <div class="wdash-ambient" data-count="${sensors.length}">
          <div class="wdash-ambient-circles">
            <div class="wdash-ambient-circle wdash-ambient-circle--temp">
              <span class="wdash-ambient-reading wdash-ambient-reading--temp">${escapeHtml(tempDisplay)}</span>
              <span class="wdash-ambient-label">Temperature</span>
            </div>
            <div class="wdash-ambient-circle wdash-ambient-circle--humidity">
              <span class="wdash-ambient-reading wdash-ambient-reading--humidity">${escapeHtml(humidityDisplay)}</span>
              <span class="wdash-ambient-label">Humidity</span>
            </div>
          </div>
          <div class="wdash-ambient-footer">
            <div class="wdash-ambient-name">${escapeHtml(nameDisplay)}</div>
            <div class="wdash-ambient-rotation">${escapeHtml(rotationText)}</div>
          </div>
        </div>
      </section>
    `;
  }

  function buildRainCard(data) {
    const rain = data.rain || {};
    const stats = [
      { label: 'Rate', value: formatRain(rain.rateInPerHour) },
      { label: 'Daily', value: formatRain(rain.dailyIn) },
      { label: 'Weekly', value: formatRain(rain.weeklyIn) },
      { label: 'Monthly', value: formatRain(rain.monthlyIn) }
    ];
    return `
      <section class="wdash-card wdash-card--rain">
        ${cardHeader(CARD_TITLES.rain, data)}
        ${buildMetricRow(stats, 'wdash-rain-stats')}
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
      { label: 'Tendency', value: escapeHtml(trend) },
      { label: 'Rate', value: escapeHtml(formatSigned(rate, 3, 'inHg/hr')) },
      { label: 'Change', value: escapeHtml(formatSigned(change, 3, 'inHg')) }
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
        </div>
        <div class="wdash-pressure-outlook">
          <span class="wdash-outlook-label">${outlook.category || 'Outlook'}</span>
          <span class="wdash-outlook-text">${outlook.summary || 'No forecast available.'}</span>
        </div>
      </section>
    `;
  }

  function buildSolarSunCard(data) {
    const solar = data.solar || {};
    const sun = data.sun || {};
    const uvIndex = toNumber(solar.uvIndex);
    const solarRadiation = toNumber(solar.solarRadiationWm2);
    const lightLux = toNumber(sun.illuminanceLux ?? sun.lightLux ?? solar.illuminanceLux);
    const sunriseText = formatTime(sun.sunrise);
    const sunsetText = formatTime(sun.sunset);
    const progress = sunProgress(sun, data?.metadata?.generatedAt);
    const progressStyle = Number.isFinite(progress) ? ` style="--sun-progress:${progress}"` : '';

    return `
      <section class="wdash-card wdash-card--solar">
        ${cardHeader(CARD_TITLES.solarSun, data)}
        <div class="wdash-solar">
          <div class="wdash-sun-graphic"${progressStyle}>
            <div class="wdash-sun-arc"></div>
            <div class="wdash-sun-horizon"></div>
            <div class="wdash-sun-marker"></div>
          </div>
          <div class="wdash-sun-times">
            <div class="wdash-sun-time">
              <span class="wdash-label">Sunrise</span>
              <span class="wdash-value">${sunriseText}</span>
            </div>
            <div class="wdash-sun-time">
              <span class="wdash-label">Sunset</span>
              <span class="wdash-value">${sunsetText}</span>
            </div>
          </div>
          ${buildMetricRow([
            { label: 'UV Index', value: Number.isFinite(uvIndex) ? formatNumber(uvIndex, 1) : '--' },
            { label: 'Solar', value: Number.isFinite(solarRadiation) ? `${formatNumber(solarRadiation, 0)} W/m²` : '--' },
            { label: 'Illuminance', value: Number.isFinite(lightLux) ? `${formatNumber(lightLux, 0)} lux` : '--' }
          ], 'wdash-solar-metrics')}
        </div>
      </section>
    `;
  }

  function buildAirQualityCard(data) {
    const air = data.airQuality || {};
    const aqi = toNumber(air.aqi);
    const pm25 = toNumber(air.pm25);
    const pm10 = toNumber(air.pm10);
    const co2 = toNumber(air.co2ppm);

    const metrics = [
      { label: 'AQI', value: Number.isFinite(aqi) ? formatNumber(aqi, 0) : '--' },
      { label: 'PM2.5', value: Number.isFinite(pm25) ? `${formatNumber(pm25, 1)} µg/m³` : '--' }
    ];

    if (Number.isFinite(pm10)) {
      metrics.push({ label: 'PM10', value: `${formatNumber(pm10, 1)} µg/m³` });
    }
    if (Number.isFinite(co2)) {
      metrics.push({ label: 'CO₂', value: `${formatNumber(co2, 0)} ppm` });
    }

    return `
      <section class="wdash-card wdash-card--air">
        ${cardHeader(CARD_TITLES.air, data)}
        ${buildMetricRow(metrics, 'wdash-air-metrics')}
      </section>
    `;
  }

  /* ---------- helpers ---------- */

  function setupInteractiveComponents(container) {
    setupPressureToggle(container);
  }

  function setupPressureToggle(container) {
    const card = container.querySelector('.wdash-card--pressure');
    if (!card) return;

    const buttons = card.querySelectorAll('[data-pressure-mode]');
    buttons.forEach(button => {
      button.addEventListener('click', () => {
        const mode = button.dataset.pressureMode === 'absolute' ? 'absolute' : 'relative';
        if (!mode || mode === pressureMode) return;
        pressureMode = mode;
        updatePressureCard(card);
      });
    });

    updatePressureCard(card);
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

  function setupAmbientRotation(data) {
    clearAmbientRotation();
    const container = document.querySelector('#' + DISPLAY_TILE_ID + ' .wdash-ambient');
    if (!container) return;

    const sensors = Array.isArray(data?.ambientSensors) ? data.ambientSensors.filter(Boolean) : [];
    if (!sensors.length) {
      ambientRotation.sensors = [];
    } else {
      ambientRotation.sensors = sensors;
    }
    ambientRotation.index = 0;
    ambientRotation.tempUnit = data?.ambientTemperatureUnit || '°F';
    ambientRotation.humidityUnit = data?.ambientHumidityUnit || '%';

    const secondsRaw = Math.round(toNumber(data?.ambientRotationSeconds));
    const seconds = Math.max(AMBIENT_ROTATION_MIN_SECONDS, Number.isFinite(secondsRaw) ? secondsRaw : AMBIENT_ROTATION_DEFAULT_SECONDS);
    ambientRotation.interval = seconds * 1000;

    updateAmbientDisplay();

    if (ambientRotation.sensors.length > 1) {
      ambientRotation.timer = setInterval(() => {
        if (!ambientRotation.sensors.length) return;
        ambientRotation.index = (ambientRotation.index + 1) % ambientRotation.sensors.length;
        updateAmbientDisplay();
      }, ambientRotation.interval);
    }
  }

  function clearAmbientRotation() {
    if (ambientRotation.timer) {
      clearInterval(ambientRotation.timer);
      ambientRotation.timer = null;
    }
    ambientRotation.sensors = [];
    ambientRotation.index = 0;
  }

  function updateAmbientDisplay() {
    const container = document.querySelector('#' + DISPLAY_TILE_ID + ' .wdash-ambient');
    if (!container) return;

    const sensor = ambientRotation.sensors[ambientRotation.index];
    const tempEl = container.querySelector('.wdash-ambient-reading--temp');
    const humidityEl = container.querySelector('.wdash-ambient-reading--humidity');
    const nameEl = container.querySelector('.wdash-ambient-name');
    const rotationEl = container.querySelector('.wdash-ambient-rotation');

    const card = container.closest('.wdash-card--ambient');

    if (!sensor) {
      if (tempEl) tempEl.textContent = formatAmbientValue(null, ambientRotation.tempUnit, 1);
      if (humidityEl) humidityEl.textContent = formatAmbientValue(null, ambientRotation.humidityUnit, 0);
      if (nameEl) nameEl.textContent = 'No sensors configured';
      if (rotationEl) rotationEl.textContent = '';
      container.classList.add('wdash-ambient--empty');
      if (card) card.classList.add('wdash-ambient--empty');
      return;
    }

    container.classList.remove('wdash-ambient--empty');
    if (card) card.classList.remove('wdash-ambient--empty');
    if (tempEl) tempEl.textContent = formatAmbientValue(sensor.temperatureF, ambientRotation.tempUnit, 1);
    if (humidityEl) humidityEl.textContent = formatAmbientValue(sensor.humidity, ambientRotation.humidityUnit, 0);
    if (nameEl) nameEl.textContent = sensor.name || 'Sensor';
    if (rotationEl) {
      rotationEl.textContent = ambientRotation.sensors.length > 1
        ? `Sensor ${ambientRotation.index + 1} of ${ambientRotation.sensors.length}`
        : '';
    }
  }

  function cardHeader(title, data) {
    const generated = data.metadata?.generatedAt ? formatRelativeTime(data.metadata.generatedAt) : null;
    return `
      <header class="wdash-card-header">
        <h3>${title}</h3>
        <span class="wdash-updated">${generated ? 'Updated ' + generated : ''}</span>
      </header>
    `;
  }

  function windCompassSvg(directionDegrees, averageDegrees) {
    const dir = Number.isFinite(directionDegrees) ? ((directionDegrees % 360) + 360) % 360 : 0;
    const avg = Number.isFinite(averageDegrees) ? ((averageDegrees % 360) + 360) % 360 : null;

    const ticks = [];
    for (let d = 0; d < 360; d += 30) {
      const rad = (d - 90) * Math.PI / 180;
      const inner = d % 90 === 0 ? 38 : 44;
      const outer = 52;
      const x1 = 60 + inner * Math.cos(rad);
      const y1 = 60 + inner * Math.sin(rad);
      const x2 = 60 + outer * Math.cos(rad);
      const y2 = 60 + outer * Math.sin(rad);
      ticks.push(`<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" class="wdash-compass-tick${d % 90 === 0 ? ' wdash-compass-tick--major' : ''}" />`);
    }

    const cardinals = [
      { label: 'N', x: 60, y: 14 },
      { label: 'E', x: 108, y: 64 },
      { label: 'S', x: 60, y: 114 },
      { label: 'W', x: 12, y: 64 }
    ];
    const cardinalMarkup = cardinals
      .map(c => `<text x="${c.x}" y="${c.y}" text-anchor="middle" class="wdash-compass-cardinal">${c.label}</text>`)
      .join('');

    const averageMarkup = avg === null ? '' : `
        <g class="wdash-compass-arrow wdash-compass-arrow--avg" transform="rotate(${avg} 60 60)">
          <path d="M60 10 L68 34 L60 28 L52 34 Z"></path>
        </g>`;

    return `
      <svg viewBox="0 0 120 120" class="wdash-compass-svg" role="presentation">
        <circle cx="60" cy="60" r="54" class="wdash-compass-ring" />
        <circle cx="60" cy="60" r="44" class="wdash-compass-inner" />
        ${ticks.join('')}
        ${cardinalMarkup}
        ${averageMarkup}
        <g class="wdash-compass-arrow wdash-compass-arrow--current" transform="rotate(${dir} 60 60)">
          <path d="M60 6 L73 36 L60 30 L47 36 Z"></path>
        </g>
        <circle cx="60" cy="60" r="6" class="wdash-compass-hub" />
      </svg>
    `;
  }

  function buildMetricRow(items, extraClass = '', options = {}) {
    if (!Array.isArray(items) || !items.length) return '';
    const { variant, columns } = options || {};
    const classes = ['wdash-metric-row', extraClass];
    if (variant) {
      classes.push(`wdash-metric-row--${variant}`);
    }
    const className = classes.filter(Boolean).join(' ');
    const columnValue = Number.isFinite(Number(columns)) ? Number(columns) : null;
    const styleAttr = columnValue ? ` style="--wdash-columns:${columnValue}"` : '';
    return `
      <div class="${className}"${styleAttr}>
        ${items.map(item => `
          <div class="wdash-metric">
            <span class="wdash-metric-label">${escapeHtml(item.label || '')}</span>
            <span class="wdash-metric-value">${item.value != null ? item.value : '--'}</span>
            ${item.sub ? `<span class="wdash-metric-sub">${item.sub}</span>` : ''}
          </div>
        `).join('')}
      </div>
    `;
  }

  function injectCSS() {
    if (document.getElementById(CSS_ID)) return;
    const style = document.createElement('style');
    style.id = CSS_ID;
    style.textContent = `

.wdash-host .tile-title, .wdash-host .tile-primary > .title { display: none !important; }
.wdash-source-tile { opacity: 0 !important; pointer-events: none !important; }
.wdash-root { position: relative; width: 100%; height: 100%; --wdash-base-width: 1200px; --wdash-base-height: 900px; --wdash-scale: 1; --wdash-render-width: var(--wdash-base-width); --wdash-render-height: var(--wdash-base-height); background: rgba(4, 9, 20, 0.85); border-radius: 12px; overflow: hidden; box-sizing: border-box; display: flex; align-items: center; justify-content: center; }
.wdash-frame { position: relative; width: var(--wdash-render-width); height: var(--wdash-render-height); display: flex; align-items: center; justify-content: center; overflow: hidden; }
.wdash { width: var(--wdash-base-width); height: var(--wdash-base-height); font-family: 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif; color: #f4f6ff; background: linear-gradient(145deg, rgba(27,35,58,0.95), rgba(13,18,32,0.95)); backdrop-filter: blur(4px); border-radius: 12px; padding: 18px; box-sizing: border-box; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.05); transform-origin: top left; transform: scale(var(--wdash-scale)); }
.wdash-grid { display: grid; gap: 14px; height: 100%; width: 100%; grid-template-columns: repeat(3, minmax(0, 1fr)); grid-template-rows: 360px 250px 250px; grid-template-areas:
  "temp wind ambient"
  "rain pressure pressure"
  "solar air air";
}
.wdash-grid[data-empty="true"] { display: flex; align-items: center; justify-content: center; }
.wdash-grid > * { min-height: 0; }
.wdash-empty { width: 100%; text-align: center; font-size: 1.1rem; opacity: 0.7; }
.wdash-card { background: linear-gradient(145deg, rgba(27,35,58,0.92), rgba(13,18,32,0.92)); border-radius: 14px; padding: 12px; display: flex; flex-direction: column; gap: 10px; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.05); height: 100%; min-height: 0; }
.wdash-card-header { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.72rem; color: #8ea0c8; }
.wdash-card-header h3 { margin: 0; font-size: 0.82rem; font-weight: 700; color: #c9d8ff; }
.wdash-updated { font-size: 0.68rem; opacity: 0.7; }
.wdash-card--temp { grid-area: temp; }
.wdash-card--wind { grid-area: wind; }
.wdash-card--ambient { grid-area: ambient; }
.wdash-card--rain { grid-area: rain; }
.wdash-card--pressure { grid-area: pressure; }
.wdash-card--solar { grid-area: solar; }
.wdash-card--air { grid-area: air; }
.wdash-temp, .wdash-wind, .wdash-solar, .wdash-pressure { display: flex; flex-direction: column; gap: 10px; flex: 1; }
.wdash-pressure { gap: 10px; }
.wdash-temp { align-items: center; }
.wdash-wind { align-items: center; }
.wdash-gauge, .wdash-wind-compass { position: relative; width: min(100%, 260px); aspect-ratio: 1 / 1; margin: 0 auto; }
.wdash-gauge-ring { position: absolute; inset: 11%; border-radius: 50%; background: conic-gradient(from -90deg, var(--gauge-color-a), var(--gauge-color-mid) calc(var(--gauge-band-progress, 0.5) * 360deg), var(--gauge-color-b) 360deg); mask: radial-gradient(closest-side, transparent calc(100% - 10px), black calc(100% - 8px)); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.1); }
.wdash-gauge-pointer { position: absolute; inset: 11%; display: flex; align-items: flex-start; justify-content: center; transform: rotate(calc(var(--gauge-indicator, 0deg) - 90deg)); transform-origin: 50% 50%; pointer-events: none; }
.wdash-gauge-pointer::after { content: ''; width: 4px; height: 54%; border-radius: 999px; background: linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.85)); box-shadow: 0 6px 16px rgba(0,0,0,0.45); }
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
.wdash-metric { flex: 1 1 0; min-width: 140px; background: rgba(255,255,255,0.05); border-radius: 12px; padding: 6px 8px; display: flex; flex-direction: column; gap: 2px; text-align: center; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.04); }
.wdash-metric-label { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.08em; color: #8ea0c8; }
.wdash-metric-value { font-size: 0.98rem; font-weight: 600; color: #f4f6ff; }
.wdash-metric-sub { font-size: 0.68rem; color: #9badcf; }
.wdash-metric-row--gauge { display: grid; grid-template-columns: repeat(var(--wdash-columns, 3), minmax(0, 1fr)); width: 100%; max-width: 260px; margin: 0 auto; gap: 4px 12px; justify-items: center; align-items: end; }
.wdash-metric-row--gauge .wdash-metric { background: transparent; box-shadow: none; padding: 0; gap: 3px; min-width: 0; align-items: center; }
.wdash-metric-row--gauge .wdash-metric-label { font-size: 0.58rem; letter-spacing: 0.1em; color: #93a5d0; white-space: nowrap; }
.wdash-metric-row--gauge .wdash-metric-value { font-size: 0.92rem; }
.wdash-metric-row--gauge .wdash-metric-sub { font-size: 0.68rem; color: #a6b5d6; }
.wdash-unit { font-size: 0.9rem; margin-left: 2px; opacity: 0.8; }
.wdash-wind-overlay { position: absolute; inset: 24% 20%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; text-align: center; pointer-events: none; text-shadow: 0 2px 8px rgba(0,0,0,0.45); }
.wdash-wind-bearing { font-size: 0.78rem; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: #dbe8ff; }
.wdash-wind-speed { display: inline-flex; align-items: baseline; gap: 4px; font-weight: 700; }
.wdash-wind-speed-value { font-size: 2.1rem; color: #5bd6ff; }
.wdash-wind-heading { font-size: 0.78rem; color: #9badcf; letter-spacing: 0.08em; }
.wdash-wind-compass svg { width: 100%; height: auto; display: block; filter: drop-shadow(0 8px 18px rgba(0,0,0,0.4)); }
.wdash-compass-ring { fill: none; stroke: rgba(255,255,255,0.18); stroke-width: 3; }
.wdash-compass-inner { fill: none; stroke: rgba(255,255,255,0.1); stroke-width: 1.4; stroke-dasharray: 6 8; }
.wdash-compass-tick { stroke: rgba(255,255,255,0.2); stroke-width: 1.4; stroke-linecap: round; }
.wdash-compass-tick--major { stroke-width: 2.2; }
.wdash-compass-cardinal { fill: rgba(255,255,255,0.68); font-size: 12px; font-weight: 700; letter-spacing: 0.08em; }
.wdash-compass-arrow path { transition: fill 0.2s ease, stroke 0.2s ease; stroke-linejoin: round; stroke-linecap: round; }
.wdash-compass-arrow--current path { fill: #4cc3ff; stroke: rgba(76,195,255,0.55); stroke-width: 1.5; }
.wdash-compass-arrow--avg path { fill: transparent; stroke: rgba(208,213,220,0.85); stroke-width: 2; }
.wdash-compass-hub { fill: rgba(12,18,32,0.92); stroke: rgba(255,255,255,0.7); stroke-width: 2; }
.wdash-ambient { display: flex; flex-direction: column; gap: 14px; flex: 1; }
.wdash-ambient-circles { display: flex; gap: 12px; justify-content: center; }
.wdash-ambient-circle { flex: 0 0 130px; width: 130px; aspect-ratio: 1; border-radius: 50%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; color: #fff; font-weight: 600; box-shadow: 0 10px 22px rgba(4,9,20,0.4); text-align: center; padding: 12px; }
.wdash-ambient-circle--temp { background: radial-gradient(circle at 30% 30%, rgba(255,158,89,0.9), rgba(242,91,44,0.65)); }
.wdash-ambient-circle--humidity { background: radial-gradient(circle at 30% 30%, rgba(90,160,255,0.9), rgba(51,96,255,0.6)); }
.wdash-ambient-reading { font-size: 1.8rem; font-weight: 700; }
.wdash-ambient-label { font-size: 0.64rem; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.8; }
.wdash-ambient-footer { display: flex; justify-content: space-between; align-items: baseline; font-size: 0.76rem; color: #c9d8ff; }
.wdash-ambient-name { font-weight: 700; }
.wdash-ambient-rotation { font-size: 0.75rem; color: #8ea0c8; }
.wdash-ambient--empty .wdash-ambient-reading { opacity: 0.6; }
.wdash-rain-stats .wdash-metric, .wdash-air-metrics .wdash-metric, .wdash-solar-metrics .wdash-metric, .wdash-pressure-stats .wdash-metric { min-width: 120px; }
.wdash-pressure-main { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.wdash-pressure-toggle { display: inline-flex; gap: 4px; padding: 4px; border-radius: 999px; background: rgba(255,255,255,0.05); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.04); }
.wdash-pressure-button { border: none; background: transparent; color: #9badcf; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.12em; padding: 5px 12px; border-radius: 999px; cursor: pointer; transition: all 0.2s ease; }
.wdash-pressure-button:hover { color: #f4f6ff; }
.wdash-pressure-button.is-active { background: linear-gradient(140deg, #5ab3ff, #3f8bff); color: #0d1426; box-shadow: 0 8px 16px rgba(74,150,255,0.35); }
.wdash-pressure-reading { font-size: 1.82rem; font-weight: 700; color: #e3edff; min-height: 2.2rem; display: flex; align-items: center; justify-content: center; }
.wdash-pressure-value { display: none; }
.wdash-card--pressure[data-pressure-mode="relative"] .wdash-pressure-value[data-pressure-value="relative"],
.wdash-card--pressure[data-pressure-mode="absolute"] .wdash-pressure-value[data-pressure-value="absolute"] { display: inline-flex; }
.wdash-pressure-stats .wdash-metric-value { font-size: 0.88rem; }
.wdash-pressure-outlook { margin-top: auto; background: rgba(255,255,255,0.06); border-radius: 10px; padding: 8px 10px; font-size: 0.76rem; display: grid; gap: 4px; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.04); }
.wdash-outlook-label { font-weight: 700; color: #ffb95a; text-transform: uppercase; letter-spacing: 0.06em; font-size: 0.75rem; }
.wdash-outlook-text { line-height: 1.35; }
.wdash-solar { display: flex; flex-direction: column; gap: 8px; flex: 1; }
.wdash-sun-graphic { position: relative; width: 100%; aspect-ratio: 2.6 / 1; border-radius: 16px; background: radial-gradient(circle at 50% 115%, rgba(255,194,120,0.18), rgba(255,255,255,0)); overflow: hidden; }
.wdash-sun-arc { position: absolute; inset: 16% 12% 42%; border: 2px solid rgba(255,255,255,0.25); border-bottom: none; border-radius: 100% 100% 0 0 / 100% 100% 0 0; }
.wdash-sun-horizon { position: absolute; left: 12%; right: 12%; bottom: 42%; height: 2px; background: rgba(255,255,255,0.25); }
.wdash-sun-marker { position: absolute; left: 50%; bottom: 42%; width: 16px; height: 16px; border-radius: 50%; background: linear-gradient(180deg, #ffd45a, #ff9445); box-shadow: 0 0 20px rgba(255,200,110,0.6); transform-origin: 50% calc(100% + 6px); transform: rotate(calc((var(--sun-progress, 0.5) * 180deg) - 90deg)) translateY(calc(-50% - 6px)); transition: transform 0.3s ease; }
.wdash-sun-times { display: flex; justify-content: space-between; gap: 10px; text-align: center; }
.wdash-sun-time { flex: 1; display: flex; flex-direction: column; gap: 3px; background: rgba(255,255,255,0.04); border-radius: 10px; padding: 8px 9px; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.03); }
.wdash-sun-time .wdash-label { font-size: 0.68rem; letter-spacing: 0.08em; text-transform: uppercase; color: #8ea0c8; }
.wdash-sun-time .wdash-value { font-size: 1.05rem; font-weight: 600; color: #f4f6ff; }
.wdash-air-metrics .wdash-metric-value { font-size: 1.02rem; }
@media (max-width: 1100px) {
  .wdash-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); grid-template-rows: none; grid-auto-rows: minmax(260px, auto); grid-template-areas:
    "temp wind"
    "ambient ambient"
    "rain pressure"
    "solar pressure"
    "air air";
  }
}
@media (max-width: 900px) {
  .wdash { padding: 14px; }
}
@media (max-width: 720px) {
  .wdash-grid { grid-template-columns: 1fr; grid-template-rows: none; grid-auto-rows: minmax(240px, auto); grid-template-areas:
    "temp"
    "wind"
    "ambient"
    "rain"
    "pressure"
    "solar"
    "air";
  }
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
    if (!sunrise || !sunset || sunset <= sunrise) return null;
    const now = parseDateTime(sun.currentTime) || parseDateTime(referenceTime) || new Date();
    const total = sunset.getTime() - sunrise.getTime();
    if (total <= 0) return null;
    const elapsed = now.getTime() - sunrise.getTime();
    return clamp(elapsed / total, 0, 1);
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
    if (!payload || typeof payload !== 'object') return false;
    if (payload.chunkNamespace !== CHUNK_NAMESPACE) return false;
    if (!Number.isInteger(payload.chunkIndex) || !Number.isInteger(payload.chunkCount)) return false;
    if (payload.chunkIndex < 1 || payload.chunkCount < 1) return false;
    return typeof payload.chunkData === 'string';
  }

  function assembleChunkPayload(envelopes) {
    if (!envelopes || envelopes.length === 0) return null;
    const valid = envelopes.filter(isChunkEnvelope);
    if (!valid.length) return null;

    valid.sort((a, b) => a.chunkIndex - b.chunkIndex);
    const expectedCount = valid[0].chunkCount;
    if (valid.some(env => env.chunkCount !== expectedCount)) {
      console.warn('[WeatherDashboard] Chunk payload counts differ across tiles', valid);
      return null;
    }

    if (expectedCount > valid.length) {
      const missing = [];
      for (let i = 1; i <= expectedCount; i++) {
        if (!valid.some(env => env.chunkIndex === i)) {
          missing.push(i);
        }
      }
      console.warn('[WeatherDashboard] Missing dashboard data chunk(s)', missing);
      return null;
    }

    const buffer = valid.map(env => env.chunkData || '').join('');
    if (!buffer) return null;

    try {
      return JSON.parse(buffer);
    } catch (err) {
      console.warn('[WeatherDashboard] Failed to reassemble chunked payload', err);
      return null;
    }
  }

  function extractJson(text) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    return text.slice(start, end + 1);
  }

  function getTileText(tile) {
    const node = findContentElement(tile);
    if (!node) return '';
    return node.textContent.trim();
  }

  function findContentElement(tile) {
    const selectors = ['.tile-primary', '.tile-contents', '.tile-content', '.tile'];
    for (const sel of selectors) {
      const el = tile.querySelector(sel);
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
