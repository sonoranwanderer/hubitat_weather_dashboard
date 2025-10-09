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
    humidity: 'Humidity',
    rain: 'Rainfall',
    pressure: 'Barometer',
    solar: 'Solar & UV',
    air: 'Air Quality',
    sun: 'Sun & Light',
    outlook: '24 Hour Outlook'
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
      <div class="wdash-row wdash-row--top">
        ${buildTemperatureCard(data)}
        ${buildWindCard(data)}
        ${buildAmbientSensorCard(data)}
      </div>
      <div class="wdash-row wdash-row--middle">
        ${buildHumidityCard(data)}
        ${buildRainCard(data)}
        ${buildPressureCard(data)}
      </div>
      <div class="wdash-row wdash-row--lower">
        ${buildSolarCard(data)}
        ${buildAirQualityCard(data)}
        ${buildSunCard(data)}
      </div>
      <div class="wdash-row wdash-row--bottom">
        ${buildOutlookCard(data)}
      </div>
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

    const colors = colorForTemp(temp);
    const angle = gaugeAngle(temp);
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
          <div class="wdash-gauge" style="--gauge-angle:${angle};--gauge-color-a:${colors[0]};--gauge-color-b:${colors[1]};">
            <div class="wdash-gauge-ring"></div>
            <div class="wdash-gauge-center">
              <div class="wdash-temp-extrema wdash-temp-extrema--high">
                <span class="wdash-temp-extrema-label">High</span>
                <span class="wdash-temp-extrema-value">${highText}</span>
              </div>
              <div class="wdash-gauge-value">${formatTemperature(temp)}</div>
              <div class="wdash-gauge-label">Current</div>
              <div class="wdash-temp-extrema wdash-temp-extrema--low">
                <span class="wdash-temp-extrema-label">Low</span>
                <span class="wdash-temp-extrema-value">${lowText}</span>
              </div>
            </div>
          </div>
          <div class="wdash-temp-stats">
            <div class="wdash-temp-stats-row wdash-temp-stats-row--labels">
              <span>Dew Point</span>
              <span>Humidity</span>
              <span>Trend</span>
              <span>Feels Like</span>
            </div>
            <div class="wdash-temp-stats-row wdash-temp-stats-row--values">
              <span>${dewText}</span>
              <span>${humidityText}</span>
              <span>${trendText}</span>
              <span>${feelsText}</span>
            </div>
          </div>
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

    return `
      <section class="wdash-card wdash-card--wind">
        ${cardHeader(CARD_TITLES.wind, data)}
        <div class="wdash-wind">
          <div class="wdash-wind-primary">
            <div class="wdash-wind-speed">
              <span class="wdash-value">${formatNumber(speed, 1)}</span>
              <span class="wdash-unit">mph</span>
              <span class="wdash-label">Speed</span>
            </div>
            <div class="wdash-wind-gust">
              <span class="wdash-label">Gust</span>
              <span class="wdash-value">${formatNumber(gust, 1)}<span class="wdash-unit"> mph</span></span>
            </div>
            <div class="wdash-wind-average">
              <span class="wdash-label">${windowMins} min avg</span>
              <span class="wdash-value">${formatNumber(avgSpeed, 1)}<span class="wdash-unit"> mph</span></span>
              <span class="wdash-sub">${avgDirText || '--'} (${formatDegrees(avgDir)})</span>
            </div>
          </div>
          <div class="wdash-compass">
            ${compassSvg(dirText, dirDegrees)}
          </div>
        </div>
      </section>
    `;
  }

  function buildAmbientSensorCard(data) {
    const sensors = Array.isArray(data.ambientSensors) ? data.ambientSensors.filter(Boolean) : [];
    const hasSensors = sensors.length > 0;
    const sensor = sensors[0] || {};
    const temp = toNumber(sensor.temperatureF);
    const humidity = toNumber(sensor.humidity);
    const tempUnit = data.ambientTemperatureUnit || '°F';
    const humidityUnit = data.ambientHumidityUnit || '%';
    const countLabel = hasSensors
      ? (sensors.length > 1 ? `${sensors.length} locations` : (sensor.name || ''))
      : 'No sensors configured';
    const rotationText = hasSensors && sensors.length > 1 ? `Sensor 1 of ${sensors.length}` : '';

    const tempDisplay = Number.isFinite(temp) ? formatNumber(temp, 1) : '—';
    const humidityDisplay = Number.isFinite(humidity) ? formatNumber(humidity, 0) : '—';
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
              <span class="wdash-ambient-value wdash-ambient-value--temp">${tempDisplay}</span>
              <span class="wdash-ambient-unit wdash-ambient-unit--temp">${escapeHtml(tempUnit)}</span>
              <span class="wdash-ambient-label">Temperature</span>
            </div>
            <div class="wdash-ambient-circle wdash-ambient-circle--humidity">
              <span class="wdash-ambient-value wdash-ambient-value--humidity">${humidityDisplay}</span>
              <span class="wdash-ambient-unit wdash-ambient-unit--humidity">${escapeHtml(humidityUnit)}</span>
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

  function buildHumidityCard(data) {
    const outdoor = data.outdoor || {};
    const indoor = data.indoor || {};
    const humidity = toNumber(outdoor.humidity);
    const indoorHum = toNumber(indoor.humidity);
    const indoorTemp = toNumber(indoor.temperatureF);

    return `
      <section class="wdash-card wdash-card--humidity">
        ${cardHeader(CARD_TITLES.humidity, data)}
        <div class="wdash-humidity">
          <div class="wdash-humidity-row">
            <span class="wdash-label">Outdoor</span>
            <span class="wdash-value">${formatPercent(humidity, 0)}</span>
          </div>
          <div class="wdash-humidity-row">
            <span class="wdash-label">Indoor</span>
            <span class="wdash-value">${formatPercent(indoorHum, 0)}</span>
          </div>
          <div class="wdash-humidity-row">
            <span class="wdash-label">Indoor Temp</span>
            <span class="wdash-value">${formatTemperature(indoorTemp)}</span>
          </div>
        </div>
      </section>
    `;
  }

  function buildRainCard(data) {
    const rain = data.rain || {};
    return `
      <section class="wdash-card wdash-card--rain">
        ${cardHeader(CARD_TITLES.rain, data)}
        <dl class="wdash-rain">
          <div><dt>Rate</dt><dd>${formatRain(rain.rateInPerHour)}</dd></div>
          <div><dt>Daily</dt><dd>${formatRain(rain.dailyIn)}</dd></div>
          <div><dt>Weekly</dt><dd>${formatRain(rain.weeklyIn)}</dd></div>
          <div><dt>Monthly</dt><dd>${formatRain(rain.monthlyIn)}</dd></div>
        </dl>
      </section>
    `;
  }

  function buildPressureCard(data) {
    const pressure = data.pressure || {};
    const trend = pressure.trend || '--';
    const rate = toNumber(pressure.trendInHgPerHour);
    const change = toNumber(pressure.changeInTrendWindow);
    const outlook = data.outlook24h || {};

    return `
      <section class="wdash-card wdash-card--pressure">
        ${cardHeader(CARD_TITLES.pressure, data)}
        <div class="wdash-pressure">
          <div class="wdash-pressure-row">
            <span class="wdash-label">Relative</span>
            <span class="wdash-value">${formatPressure(pressure.relativeInHg)}</span>
          </div>
          <div class="wdash-pressure-row">
            <span class="wdash-label">Absolute</span>
            <span class="wdash-value">${formatPressure(pressure.absoluteInHg)}</span>
          </div>
          <div class="wdash-pressure-row">
            <span class="wdash-label">Tendency</span>
            <span class="wdash-value">${trend}</span>
          </div>
          <div class="wdash-pressure-row">
            <span class="wdash-label">Rate</span>
            <span class="wdash-value">${formatSigned(rate, 3, 'inHg/hr')}</span>
          </div>
          <div class="wdash-pressure-row">
            <span class="wdash-label">Change</span>
            <span class="wdash-value">${formatSigned(change, 3, 'inHg')}</span>
          </div>
        </div>
        <div class="wdash-pressure-outlook">
          <span class="wdash-outlook-label">${outlook.category || 'Outlook'}</span>
          <span class="wdash-outlook-text">${outlook.summary || 'No forecast available.'}</span>
        </div>
      </section>
    `;
  }

  function buildSolarCard(data) {
    const solar = data.solar || {};
    return `
      <section class="wdash-card wdash-card--solar">
        ${cardHeader(CARD_TITLES.solar, data)}
        <div class="wdash-solar">
          <div class="wdash-solar-row">
            <span class="wdash-label">UV Index</span>
            <span class="wdash-value">${formatNumber(solar.uvIndex, 1)}</span>
          </div>
          <div class="wdash-solar-row">
            <span class="wdash-label">Solar</span>
            <span class="wdash-value">${formatNumber(solar.solarRadiationWm2, 0)}<span class="wdash-unit"> W/m²</span></span>
          </div>
        </div>
      </section>
    `;
  }

  function buildAirQualityCard(data) {
    const air = data.airQuality || {};
    return `
      <section class="wdash-card wdash-card--air">
        ${cardHeader(CARD_TITLES.air, data)}
        <div class="wdash-air">
          <div class="wdash-air-row">
            <span class="wdash-label">AQI</span>
            <span class="wdash-value">${formatNumber(air.aqi, 0)}</span>
          </div>
          <div class="wdash-air-row">
            <span class="wdash-label">PM2.5</span>
            <span class="wdash-value">${formatNumber(air.pm25, 1)}<span class="wdash-unit"> µg/m³</span></span>
          </div>
        </div>
      </section>
    `;
  }

  function buildSunCard(data) {
    const sun = data.sun || {};
    return `
      <section class="wdash-card wdash-card--sun">
        ${cardHeader(CARD_TITLES.sun, data)}
        <div class="wdash-sun">
          <div class="wdash-sun-row">
            <span class="wdash-label">Sunrise</span>
            <span class="wdash-value">${formatTime(sun.sunrise)}</span>
          </div>
          <div class="wdash-sun-row">
            <span class="wdash-label">Sunset</span>
            <span class="wdash-value">${formatTime(sun.sunset)}</span>
          </div>
        </div>
      </section>
    `;
  }

  function buildOutlookCard(data) {
    const outlook = data.outlook24h || {};
    const updated = data.metadata?.generatedAt ? formatRelativeTime(data.metadata.generatedAt) : null;
    return `
      <section class="wdash-card wdash-card--outlook">
        ${cardHeader(CARD_TITLES.outlook, data)}
        <div class="wdash-outlook">
          <div class="wdash-outlook-category">${outlook.category || 'No forecast'}</div>
          <div class="wdash-outlook-summary">${outlook.summary || 'Waiting for forecast data.'}</div>
          <div class="wdash-updated">Updated ${updated || '—'}</div>
        </div>
      </section>
    `;
  }

  /* ---------- helpers ---------- */

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
    const tempEl = container.querySelector('.wdash-ambient-value--temp');
    const tempUnitEl = container.querySelector('.wdash-ambient-unit--temp');
    const humidityEl = container.querySelector('.wdash-ambient-value--humidity');
    const humidityUnitEl = container.querySelector('.wdash-ambient-unit--humidity');
    const nameEl = container.querySelector('.wdash-ambient-name');
    const rotationEl = container.querySelector('.wdash-ambient-rotation');

    const card = container.closest('.wdash-card--ambient');

    if (!sensor) {
      if (tempEl) tempEl.textContent = '—';
      if (tempUnitEl) tempUnitEl.textContent = ambientRotation.tempUnit;
      if (humidityEl) humidityEl.textContent = '—';
      if (humidityUnitEl) humidityUnitEl.textContent = ambientRotation.humidityUnit;
      if (nameEl) nameEl.textContent = 'No sensors configured';
      if (rotationEl) rotationEl.textContent = '';
      container.classList.add('wdash-ambient--empty');
      if (card) card.classList.add('wdash-ambient--empty');
      return;
    }

    container.classList.remove('wdash-ambient--empty');
    if (card) card.classList.remove('wdash-ambient--empty');
    if (tempEl) tempEl.textContent = formatNumber(toNumber(sensor.temperatureF), 1);
    if (tempUnitEl) tempUnitEl.textContent = ambientRotation.tempUnit;
    if (humidityEl) humidityEl.textContent = formatNumber(toNumber(sensor.humidity), 0);
    if (humidityUnitEl) humidityUnitEl.textContent = ambientRotation.humidityUnit;
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

  function compassSvg(cardinal, degrees) {
    const label = cardinal || (Number.isFinite(degrees) ? degreesToCardinal(degrees) : '--');
    const deg = Number.isFinite(degrees) ? ((degrees % 360) + 360) % 360 : 0;
    return `
      <svg viewBox="0 0 120 120" class="wdash-compass-svg" role="img" aria-label="Wind direction ${label}">
        <circle cx="60" cy="60" r="54" class="ring" />
        <line x1="60" y1="18" x2="60" y2="10" class="tick" />
        <line x1="102" y1="60" x2="110" y2="60" class="tick" />
        <line x1="60" y1="102" x2="60" y2="110" class="tick" />
        <line x1="18" y1="60" x2="10" y2="60" class="tick" />
        <text x="60" y="24" text-anchor="middle" class="cardinal">N</text>
        <text x="60" y="114" text-anchor="middle" class="cardinal">S</text>
        <text x="14" y="64" text-anchor="middle" class="cardinal">W</text>
        <text x="106" y="64" text-anchor="middle" class="cardinal">E</text>
        <g class="needle" style="transform:rotate(${deg}deg);transform-origin:60px 60px;">
          <polygon points="60,20 68,62 60,54 52,62" class="needle-head" />
          <polygon points="60,100 52,62 60,70 68,62" class="needle-tail" />
        </g>
        <circle cx="60" cy="60" r="6" class="hub" />
        <text x="60" y="82" text-anchor="middle" class="direction-label">${label}</text>
      </svg>
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
      .wdash { width: var(--wdash-base-width); height: var(--wdash-base-height); font-family: 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif; color: #f4f6ff; background: linear-gradient(145deg, rgba(27,35,58,0.95), rgba(13,18,32,0.95)); backdrop-filter: blur(4px); border-radius: 12px; padding: 16px; box-sizing: border-box; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.05); transform-origin: top left; transform: scale(var(--wdash-scale)); }
      .wdash-grid { display: flex; flex-direction: column; gap: 14px; height: 100%; width: 100%; }
      .wdash-grid[data-empty="true"] { align-items: center; justify-content: center; }
      .wdash-grid > * { min-height: 0; }
      .wdash-empty { width: 100%; text-align: center; font-size: 1.1rem; opacity: 0.7; }
      .wdash-row { display: grid; gap: 14px; width: 100%; min-height: 0; }
      .wdash-row--top { grid-template-columns: 5fr 4fr 3fr; flex: 4.2 1 0%; }
      .wdash-row--middle { grid-template-columns: 3fr 4fr 5fr; flex: 2.2 1 0%; }
      .wdash-row--lower { grid-template-columns: repeat(3, 1fr); flex: 2 1 0%; }
      .wdash-row--bottom { grid-template-columns: 1fr; flex: 1.6 1 0%; }
      .wdash-card { background: linear-gradient(145deg, rgba(27,35,58,0.95), rgba(13,18,32,0.95)); border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 10px; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.05); height: 100%; min-height: 0; }
      .wdash-card-header { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.72rem; color: #8ea0c8; }
      .wdash-card-header h3 { margin: 0; font-size: 0.78rem; font-weight: 700; color: #c9d8ff; }
      .wdash-updated { font-size: 0.68rem; opacity: 0.7; }
      @media (max-width: 1180px) {
        .wdash-row--top { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .wdash-row--middle { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .wdash-row--lower { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
      @media (max-width: 900px) {
        .wdash { padding: 12px; }
        .wdash-row { grid-template-columns: 1fr !important; }
      }
      .wdash-temp { display: grid; grid-template-rows: minmax(0, 1fr) auto; gap: 16px; align-items: center; justify-items: center; }
      .wdash-gauge { position: relative; width: 100%; max-width: 280px; margin: 0 auto; border-radius: 50%; aspect-ratio: 1 / 1; }
      .wdash-gauge-ring { position: absolute; inset: 7%; border-radius: 50%; background: conic-gradient(var(--gauge-color-a), var(--gauge-color-b) var(--gauge-angle), rgba(255,255,255,0.12) var(--gauge-angle), rgba(255,255,255,0.05)); mask: radial-gradient(closest-side, transparent calc(100% - 16px), black calc(100% - 15px)); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08); }
      .wdash-gauge-center { position: absolute; inset: 19%; border-radius: 50%; background: rgba(5,10,20,0.85); display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 12px 10px; gap: 6px; }
      .wdash-gauge-value { font-size: 3.1rem; font-weight: 800; letter-spacing: -0.02em; }
      .wdash-gauge-label { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.12em; color: #9badcf; }
      .wdash-temp-extrema { display: flex; flex-direction: column; align-items: center; gap: 2px; }
      .wdash-temp-extrema-label { font-size: 0.62rem; letter-spacing: 0.12em; text-transform: uppercase; color: #8ea0c8; }
      .wdash-temp-extrema-value { font-size: 1rem; font-weight: 600; color: #dce8ff; }
      .wdash-temp-extrema--high .wdash-temp-extrema-value { color: #ffb95a; }
      .wdash-temp-extrema--low .wdash-temp-extrema-value { color: #7cc5ff; }
      .wdash-temp-stats { width: 100%; background: rgba(255,255,255,0.06); border-radius: 12px; padding: 12px 16px; display: grid; gap: 8px; }
      .wdash-temp-stats-row { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; text-align: center; }
      .wdash-temp-stats-row--labels span { text-transform: uppercase; font-size: 0.66rem; letter-spacing: 0.1em; color: #8ea0c8; }
      .wdash-temp-stats-row--values span { font-size: 1rem; font-weight: 600; }
      @media (max-width: 700px) { .wdash-temp-stats-row { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
      .wdash-wind { display: grid; grid-template-columns: 1fr 160px; gap: 16px; align-items: center; min-height: 0; }
      @media (max-width: 800px) { .wdash-wind { grid-template-columns: 1fr; } }
      .wdash-wind-primary { display: grid; gap: 12px; }
      .wdash-wind-speed { display: flex; align-items: baseline; gap: 6px; }
      .wdash-value { font-size: 2.4rem; font-weight: 700; }
      .wdash-unit { font-size: 0.9rem; margin-left: 2px; opacity: 0.8; }
      .wdash-label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; color: #9badcf; }
      .wdash-wind-gust, .wdash-wind-average { display: flex; flex-direction: column; }
      .wdash-wind-average .wdash-sub { font-size: 0.78rem; opacity: 0.75; }
      .wdash-compass { position: relative; }
      .wdash-compass-svg { width: 100%; height: auto; filter: drop-shadow(0 4px 12px rgba(0,0,0,0.35)); }
      .wdash-compass-svg .ring { fill: none; stroke: rgba(255,255,255,0.18); stroke-width: 4; }
      .wdash-compass-svg .tick { stroke: rgba(255,255,255,0.22); stroke-width: 2; stroke-linecap: round; }
      .wdash-compass-svg .cardinal { fill: rgba(255,255,255,0.6); font-size: 12px; font-weight: 600; }
      .wdash-compass-svg .needle-head { fill: #ff7b3a; }
      .wdash-compass-svg .needle-tail { fill: rgba(255,123,58,0.35); }
      .wdash-compass-svg .hub { fill: rgba(12,18,32,0.9); stroke: rgba(255,255,255,0.7); stroke-width: 2; }
      .wdash-compass-svg .direction-label { fill: #fff; font-size: 12px; font-weight: 600; }
      .wdash-ambient { display: flex; flex-direction: column; gap: 12px; justify-content: space-between; height: 100%; min-height: 0; }
      .wdash-ambient-circles { display: flex; gap: 12px; justify-content: space-between; }
      .wdash-ambient-circle { flex: 1; aspect-ratio: 1; border-radius: 50%; display: grid; place-items: center; gap: 6px; position: relative; color: #fff; font-weight: 600; box-shadow: 0 8px 18px rgba(4, 9, 20, 0.35); }
      .wdash-ambient-circle--temp { background: radial-gradient(circle at 30% 30%, rgba(255,158,89,0.9), rgba(242,91,44,0.6)); }
      .wdash-ambient-circle--humidity { background: radial-gradient(circle at 30% 30%, rgba(90,160,255,0.88), rgba(51,96,255,0.55)); }
      .wdash-ambient-value { font-size: 2.2rem; font-weight: 700; }
      .wdash-ambient-unit { font-size: 0.9rem; opacity: 0.85; }
      .wdash-ambient-label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.75; }
      .wdash-ambient-footer { display: flex; justify-content: space-between; align-items: baseline; font-size: 0.85rem; color: #c9d8ff; }
      .wdash-ambient-name { font-weight: 700; }
      .wdash-ambient-rotation { font-size: 0.75rem; color: #8ea0c8; }
      .wdash-ambient.wdash-ambient--empty .wdash-ambient-value,
      .wdash-card--ambient.wdash-ambient--empty .wdash-ambient-value { opacity: 0.6; }
      .wdash-ambient.wdash-ambient--empty .wdash-ambient-name,
      .wdash-card--ambient.wdash-ambient--empty .wdash-ambient-name { opacity: 0.7; }
      @media (max-width: 800px) { .wdash-ambient-circles { flex-direction: row; } }
      .wdash-humidity, .wdash-solar, .wdash-air, .wdash-sun { display: grid; gap: 10px; font-size: 0.92rem; min-height: 0; }
      .wdash-humidity-row, .wdash-solar-row, .wdash-air-row, .wdash-sun-row { display: flex; justify-content: space-between; }
      .wdash-rain { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; font-size: 0.9rem; min-height: 0; }
      .wdash-rain dt { color: #8ea0c8; font-weight: 600; }
      .wdash-rain dd { margin: 0; font-weight: 600; }
      .wdash-pressure { display: grid; gap: 8px; font-size: 0.9rem; min-height: 0; }
      .wdash-pressure-row { display: flex; justify-content: space-between; }
      .wdash-pressure-outlook { margin-top: auto; background: rgba(255,255,255,0.06); border-radius: 8px; padding: 10px; font-size: 0.82rem; display: grid; gap: 6px; }
      .wdash-outlook-label { font-weight: 700; color: #ffb95a; text-transform: uppercase; letter-spacing: 0.06em; font-size: 0.75rem; }
      .wdash-outlook-text { line-height: 1.3; }
      .wdash-outlook { display: grid; gap: 10px; font-size: 0.95rem; min-height: 0; }
      .wdash-outlook-category { font-size: 1.2rem; font-weight: 700; }
      .wdash-outlook-summary { line-height: 1.4; opacity: 0.85; }
    `;
    document.head.appendChild(style);
  }

  function gaugeAngle(temp) {
    if (!Number.isFinite(temp)) return '220deg';
    const range = TEMP_RANGE.max - TEMP_RANGE.min;
    const clamped = Math.min(TEMP_RANGE.max, Math.max(TEMP_RANGE.min, temp));
    const pct = (clamped - TEMP_RANGE.min) / range;
    const deg = 300 * pct + 30; // start at 30°, sweep 300°
    return `${deg}deg`;
  }

  function colorForTemp(temp) {
    if (!Number.isFinite(temp)) return ['#4aa3ff', '#6bc3ff'];
    for (const entry of TEMP_COLORS) {
      if (temp <= entry.max) return entry.colors;
    }
    return TEMP_COLORS[TEMP_COLORS.length - 1].colors;
  }

  function formatTemperature(value) {
    if (!Number.isFinite(value)) return '--°';
    return `${value.toFixed(1)}°`;
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
