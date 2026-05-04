'use strict';

const {
  createTestEnvironment,
  loadWeatherDashboard,
  createElement,
  createSpan
} = require('./support/fake-dom');

function buildTempWindStructure(doc) {
  const tile = createElement(doc, 'div');
  tile.setAttribute('id', 'tile-0');
  doc.body.appendChild(tile);

  const card = createElement(doc, 'section', ['wdash-card', 'wdash-card--temp-wind']);
  tile.appendChild(card);

  const header = createElement(doc, 'header', ['wdash-card-header', 'wdash-card-header--temp-wind']);
  const headerMain = createElement(doc, 'div', ['wdash-card-header-main']);
  const headerMeta = createElement(doc, 'div', ['wdash-temp-wind-header-meta']);
  const updatedWrapper = createElement(doc, 'span', ['wdash-updated']);
  const updatedLine = createSpan(doc, 'wdash-updated-line');
  updatedLine.classList.add('wdash-updated-line--primary');
  updatedWrapper.appendChild(updatedLine);
  const batterySlot = createElement(doc, 'div', ['wdash-battery-slot', 'wdash-temp-wind-battery']);
  batterySlot.dataset.batteryOrientation = 'landscape';
  batterySlot.dataset.batteryShowLabel = 'false';
  batterySlot.dataset.batteryHideWhenInvalid = 'true';
  batterySlot.dataset.batteryLabel = 'Outdoor sensor';
  batterySlot.dataset.batteryTitlePrefix = 'Outdoor sensor battery';
  headerMeta.appendChild(updatedWrapper);
  headerMeta.appendChild(batterySlot);
  header.appendChild(headerMain);
  header.appendChild(headerMeta);
  card.appendChild(header);

  const main = createElement(doc, 'div', ['wdash-temp-wind-main']);
  const tempSection = createElement(doc, 'div', ['wdash-temp']);
  const gauge = createElement(doc, 'div', ['wdash-gauge']);
  const gaugeCenter = createElement(doc, 'div', ['wdash-gauge-center']);
  const highWrap = createElement(doc, 'div', ['wdash-temp-extrema', 'wdash-temp-extrema--high']);
  highWrap.appendChild(createSpan(doc, 'wdash-temp-extrema-label'));
  highWrap.appendChild(createSpan(doc, 'wdash-temp-extrema-value'));
  const gaugeCurrent = createElement(doc, 'div', ['wdash-gauge-current']);
  const gaugeValue = createSpan(doc, 'wdash-gauge-value');
  const gaugeValueNumber = createSpan(doc, 'wdash-gauge-value-number');
  const unitButton = createElement(doc, 'button', ['wdash-temp-unit-indicator', 'wdash-temp-unit-indicator--gauge']);
  unitButton.setAttribute('type', 'button');
  unitButton.setAttribute('data-temp-unit-indicator', 'true');
  gaugeValue.appendChild(gaugeValueNumber);
  gaugeCurrent.appendChild(gaugeValue);
  const lowWrap = createElement(doc, 'div', ['wdash-temp-extrema', 'wdash-temp-extrema--low']);
  lowWrap.appendChild(createSpan(doc, 'wdash-temp-extrema-label'));
  lowWrap.appendChild(createSpan(doc, 'wdash-temp-extrema-value'));
  gaugeCenter.appendChild(highWrap);
  gaugeCenter.appendChild(gaugeCurrent);
  gaugeCenter.appendChild(lowWrap);
  gauge.appendChild(gaugeCenter);
  tempSection.appendChild(unitButton);
  tempSection.appendChild(gauge);

  const windSection = createElement(doc, 'div', ['wdash-wind']);
  const windButton = createElement(doc, 'button', ['wdash-temp-unit-indicator', 'wdash-wind-unit-indicator']);
  windButton.setAttribute('type', 'button');
  windButton.setAttribute('data-wind-unit-indicator', 'true');
  windButton.textContent = 'mi';
  windSection.appendChild(windButton);
  const windCompass = createElement(doc, 'div', ['wdash-wind-compass']);
  const compassSvg = createElement(doc, 'svg', ['wdash-compass-svg']);
  const currentArrow = createElement(doc, 'g', ['wdash-compass-arrow', 'wdash-compass-arrow--current']);
  currentArrow.appendChild(createElement(doc, 'path', ['wdash-compass-current']));
  const avgArrow = createElement(doc, 'g', ['wdash-compass-arrow', 'wdash-compass-arrow--avg']);
  avgArrow.appendChild(createElement(doc, 'path', ['wdash-compass-avg']));
  avgArrow.style.display = 'none';
  compassSvg.appendChild(currentArrow);
  compassSvg.appendChild(avgArrow);
  windCompass.appendChild(compassSvg);
  const overlay = createElement(doc, 'div', ['wdash-wind-overlay']);
  const bearingLine = createElement(doc, 'span', ['wdash-wind-bearing-line']);
  bearingLine.appendChild(createSpan(doc, 'wdash-wind-bearing'));
  bearingLine.appendChild(createSpan(doc, 'wdash-wind-heading'));
  overlay.appendChild(bearingLine);
  const speedWrap = createElement(doc, 'span', ['wdash-wind-speed']);
  speedWrap.appendChild(createSpan(doc, 'wdash-wind-speed-value'));
  const unit = createSpan(doc, 'wdash-unit');
  unit.classList.add('wdash-wind-speed-unit');
  unit.textContent = 'mph';
  speedWrap.appendChild(unit);
  overlay.appendChild(speedWrap);
  const gustWrap = createElement(doc, 'span', ['wdash-wind-gust']);
  const gustLabel = createSpan(doc, 'wdash-wind-gust-label');
  gustLabel.textContent = 'Gust: ';
  gustWrap.appendChild(gustLabel);
  gustWrap.appendChild(createSpan(doc, 'wdash-wind-gust-value'));
  overlay.appendChild(gustWrap);
  windCompass.appendChild(overlay);
  windSection.appendChild(windCompass);

  main.appendChild(tempSection);
  main.appendChild(windSection);
  card.appendChild(main);

  const footer = createElement(doc, 'div', ['wdash-temp-wind-footer']);
  const details = createElement(doc, 'div', ['wdash-metric-row', 'wdash-temp-wind-details']);
  for (let i = 0; i < 6; i += 1) {
    const metric = createElement(doc, 'div', ['wdash-metric']);
    metric.appendChild(createSpan(doc, 'wdash-metric-label'));
    metric.appendChild(createSpan(doc, 'wdash-metric-value'));
    details.appendChild(metric);
  }
  footer.appendChild(details);
  card.appendChild(footer);

  return { card, windCompass, avgArrow };
}

function convertTemperature(value, fromUnit = 'F', toUnit = 'F') {
  if (!Number.isFinite(value)) return NaN;
  const from = (fromUnit || 'F').toUpperCase();
  const to = (toUnit || 'F').toUpperCase();
  if (from === to) return value;
  if (from === 'C' && to === 'F') return (value * 9) / 5 + 32;
  if (from === 'F' && to === 'C') return (value - 32) * (5 / 9);
  return value;
}

function convertTemperatureDelta(value, fromUnit = 'F', toUnit = 'F') {
  if (!Number.isFinite(value)) return NaN;
  const from = (fromUnit || 'F').toUpperCase();
  const to = (toUnit || 'F').toUpperCase();
  if (from === to) return value;
  if (from === 'C' && to === 'F') return (value * 9) / 5;
  if (from === 'F' && to === 'C') return (value * 5) / 9;
  return value;
}

function formatTemperature(value, targetUnit = 'F', sourceUnit = 'F') {
  if (!Number.isFinite(value)) return '--°';
  const converted = convertTemperature(value, sourceUnit, targetUnit);
  if (!Number.isFinite(converted)) return '--°';
  return `${converted.toFixed(1)}°`;
}

function formatPercent(value, decimals = 0) {
  return Number.isFinite(value) ? `${value.toFixed(decimals)}%` : '--';
}

function formatSigned(value, decimals = 1, suffix = '') {
  if (!Number.isFinite(value)) return '--';
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  const abs = Math.abs(value).toFixed(decimals);
  return `${sign}${abs}${suffix ? ` ${suffix}` : ''}`;
}

function formatNumber(value, decimals = 0) {
  return Number.isFinite(value) ? value.toFixed(decimals) : '--';
}

function formatDegrees(value) {
  return Number.isFinite(value) ? `${value.toFixed(0)}°` : '--°';
}

function convertWindSpeed(value, fromUnit = 'mph', toUnit = 'mph') {
  if (!Number.isFinite(value)) return NaN;
  const from = (fromUnit || 'mph').toLowerCase();
  const to = (toUnit || 'mph').toLowerCase();
  const toMph = from === 'kph' ? value / 1.609344 : from === 'kts' ? value * 1.150779448023542 : value;
  if (to === 'kph') return toMph * 1.609344;
  if (to === 'kts') return toMph / 1.150779448023542;
  return toMph;
}

function windUnitLabel(unit) {
  switch ((unit || 'mph').toLowerCase()) {
    case 'kph': return 'kph';
    case 'kts': return 'kts';
    default: return 'mph';
  }
}

function windIndicatorText(unit) {
  switch ((unit || 'mph').toLowerCase()) {
    case 'kph': return 'km';
    case 'kts': return 'kt';
    default: return 'mi';
  }
}

function formatWind(value, unit = 'mph', decimals = 1) {
  const converted = convertWindSpeed(value, 'mph', unit);
  if (!Number.isFinite(converted)) return '--';
  return `${converted.toFixed(decimals)} ${windUnitLabel(unit)}`;
}

function formatAverageWind(direction, speed, unit) {
  const dirText = direction || '--';
  const speedText = formatWind(speed, unit);
  return `${dirText} ${speedText}`;
}

function gaugeIndicator(temp) {
  if (!Number.isFinite(temp)) return '0deg';
  const min = -40;
  const max = 120;
  const clamped = Math.min(Math.max(temp, min), max);
  const pct = (clamped - min) / (max - min);
  return `${(pct * 360).toFixed(1)}deg`;
}

function normalizeDegrees(value) {
  if (!Number.isFinite(value)) return 0;
  let normalized = value % 360;
  if (normalized < 0) normalized += 360;
  return normalized;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message} (expected: ${expected}, actual: ${actual})`);
  }
}

(function main() {
  const { window, document } = createTestEnvironment();
  loadWeatherDashboard(window);

  buildTempWindStructure(document);

  const hooks = window.__WDASH_TEST_HOOKS__;
  const { updateTempWindCard, tempWindState, applyTempWindGaugeSize } = hooks;
  if (typeof updateTempWindCard !== 'function') {
    throw new Error('updateTempWindCard hook missing');
  }
  if (typeof applyTempWindGaugeSize !== 'function') {
    throw new Error('applyTempWindGaugeSize hook missing');
  }

  const scaledRoot = createElement(document, 'div', ['wdash-root']);
  scaledRoot.style.setProperty('--wdash-scale', '1.26');
  const scaledHost = createElement(document, 'div', ['wdash-temp']);
  const scaledGauge = createElement(document, 'div', ['wdash-gauge']);
  scaledHost.appendChild(scaledGauge);
  scaledHost.querySelector = selector => (
    selector === '.wdash-gauge, .wdash-wind-compass' ? scaledGauge : null
  );
  scaledRoot.appendChild(scaledHost);
  document.body.appendChild(scaledRoot);
  scaledHost.setBoundingClientRect({ width: 340.83, height: 447.3 });
  Object.defineProperty(scaledHost, 'clientWidth', { configurable: true, value: 0 });
  Object.defineProperty(scaledHost, 'clientHeight', { configurable: true, value: 0 });
  applyTempWindGaugeSize(scaledHost);
  assertEqual(scaledGauge.style.width, '270.5px', 'scaled gauge width should be normalized to dashboard CSS pixels');
  assertEqual(scaledGauge.style.height, '270.5px', 'scaled gauge height should be normalized to dashboard CSS pixels');

  const dataA = {
    outdoor: {
      temperature: 72.3,
      dailyHigh: 85.1,
      dailyLow: 60.5,
      feelsLike: 74.2,
      dewPoint: 55.2,
      humidity: 45,
      trendPerHour: -0.5,
      battery: 88
    },
    wind: {
      speedMph: 12.4,
      gustMph: 18.7,
      directionDegrees: 135,
      directionCardinal: 'SE',
      averageMinutes: 10,
      dailyMaxGustMph: 25.3,
      average: {
        speedMph: 8.2,
        directionDegrees: 110,
        directionCardinal: 'ESE'
      }
    },
    metadata: {
      weatherStationTime: '2025-10-21T12:35:10Z'
    }
  };

  tempWindState.data = dataA;
  updateTempWindCard();

  const card = document.querySelector('.wdash-card--temp-wind');
  const gaugeValueEl = card.querySelector('.wdash-gauge-value-number');
  const gaugeUnitButton = card.querySelector('.wdash-temp-unit-indicator');
  const windUnitButton = card.querySelector('[data-wind-unit-indicator="true"]');
  assertEqual(gaugeValueEl.textContent, formatTemperature(dataA.outdoor.temperature), 'gauge value mismatch after dataA');
  assertEqual(gaugeUnitButton.textContent, '°F', 'unit indicator mismatch after dataA');
  assertEqual(windUnitButton.textContent, windIndicatorText('mph'), 'wind unit indicator mismatch after dataA');
  assertEqual(card.querySelector('.wdash-temp-extrema--high .wdash-temp-extrema-value').textContent, formatTemperature(dataA.outdoor.dailyHigh), 'high value mismatch after dataA');
  assertEqual(card.querySelector('.wdash-temp-extrema--low .wdash-temp-extrema-value').textContent, formatTemperature(dataA.outdoor.dailyLow), 'low value mismatch after dataA');

  const detailValuesA = [
    formatTemperature(dataA.outdoor.feelsLike),
    formatTemperature(dataA.outdoor.dewPoint),
    formatPercent(dataA.outdoor.humidity, 0),
    formatSigned(dataA.outdoor.trendPerHour, 1, '°F/hr'),
    formatAverageWind(dataA.wind.average.directionCardinal, dataA.wind.average.speedMph, 'mph'),
    `${formatWind(dataA.wind.dailyMaxGustMph, 'mph')}`
  ];
  const detailNodesA = card.querySelectorAll('.wdash-temp-wind-details .wdash-metric-value');
  detailNodesA.forEach((node, index) => {
    assertEqual(node.textContent, detailValuesA[index], `detail ${index} mismatch after dataA`);
  });

  const updatedLine = card.querySelector('.wdash-updated-line--primary');
  assert(updatedLine.textContent.startsWith('Updated '), 'updated line missing prefix');

  const batterySlot = card.querySelector('.wdash-temp-wind-battery');
  assert(batterySlot.innerHTML.length > 0, 'battery slot not populated');

  const bearingEl = card.querySelector('.wdash-wind-bearing');
  assertEqual(bearingEl.textContent, 'SE', 'bearing mismatch after dataA');
  const headingEl = card.querySelector('.wdash-wind-heading');
  assertEqual(headingEl.textContent, ` ${formatDegrees(dataA.wind.directionDegrees)}`, 'heading mismatch after dataA');
  assertEqual(card.querySelector('.wdash-wind-speed-value').textContent, formatNumber(dataA.wind.speedMph, 1), 'speed value mismatch after dataA');
  assertEqual(card.querySelector('.wdash-wind-speed-unit').textContent, 'mph', 'wind unit label mismatch after dataA');
  assertEqual(card.querySelector('.wdash-wind-gust-value').textContent, formatWind(dataA.wind.gustMph, 'mph'), 'gust value mismatch after dataA');

  const compass = card.querySelector('.wdash-wind-compass');
  assertEqual(compass.getAttribute('aria-label'), `Wind direction SE ${formatDegrees(dataA.wind.directionDegrees)}`, 'aria label mismatch after dataA');
  const currentArrow = compass.querySelector('.wdash-compass-arrow--current');
  assertEqual(currentArrow.style.transform, `rotate(${normalizeDegrees(dataA.wind.directionDegrees)}deg)`, 'current arrow rotation mismatch after dataA');
  const avgArrow = compass.querySelector('.wdash-compass-arrow--avg');
  assertEqual(avgArrow.style.display, '', 'avg arrow should be visible for dataA');
  assertEqual(avgArrow.style.transform, `rotate(${normalizeDegrees(dataA.wind.average.directionDegrees)}deg)`, 'avg arrow rotation mismatch after dataA');

  const gaugeIndicatorBefore = card.querySelector('.wdash-gauge').style.getPropertyValue('--gauge-indicator');
  assertEqual(gaugeIndicatorBefore, gaugeIndicator(dataA.outdoor.temperature), 'gauge indicator mismatch after dataA');

  const dataB = {
    outdoor: {
      temperature: 65.0,
      dailyHigh: 70.2,
      dailyLow: 50.4,
      feelsLike: 63.5,
      dewPoint: 52.1,
      humidity: 60,
      trendPerHour: 0.2,
      battery: 76
    },
    wind: {
      speedMph: 5.1,
      gustMph: 9.9,
      directionDegrees: 45,
      directionCardinal: 'NE',
      dailyMaxGustMph: 15.0,
      averageMinutes: 5,
      average: {}
    },
    metadata: {
      weatherStationTime: '2025-10-21T12:40:00Z'
    }
  };

  tempWindState.data = dataB;
  updateTempWindCard();

  assertEqual(gaugeValueEl.textContent, formatTemperature(dataB.outdoor.temperature), 'gauge value mismatch after dataB');
  assertEqual(compass.getAttribute('aria-label'), `Wind direction NE ${formatDegrees(dataB.wind.directionDegrees)}`, 'aria label mismatch after dataB');
  assertEqual(currentArrow.style.transform, `rotate(${normalizeDegrees(dataB.wind.directionDegrees)}deg)`, 'current arrow rotation mismatch after dataB');
  assertEqual(avgArrow.style.display, 'none', 'avg arrow should be hidden for dataB');
  assertEqual(card.querySelector('.wdash-wind-gust-value').textContent, formatWind(dataB.wind.gustMph, 'mph'), 'gust mismatch after dataB');

  const gaugeIndicatorAfter = card.querySelector('.wdash-gauge').style.getPropertyValue('--gauge-indicator');
  assertEqual(gaugeIndicatorAfter, gaugeIndicator(dataB.outdoor.temperature), 'gauge indicator mismatch after dataB');
  assert(gaugeIndicatorAfter !== gaugeIndicatorBefore, 'gauge indicator should change for new data');

  const speedValueB = card.querySelector('.wdash-wind-speed-value').textContent;
  assertEqual(speedValueB, formatNumber(dataB.wind.speedMph, 1), 'speed value mismatch after dataB');

  const dataC = {
    outdoor: {
      temperature: 20.0,
      dailyHigh: 23.4,
      dailyLow: 12.8,
      feelsLike: 19.2,
      dewPoint: 10.4,
      humidity: 58,
      trendPerHour: -0.17,
      battery: 80
    },
    wind: {
      speedMph: dataB.wind.speedMph,
      gustMph: dataB.wind.gustMph,
      directionDegrees: dataB.wind.directionDegrees,
      directionCardinal: dataB.wind.directionCardinal,
      dailyMaxGustMph: dataB.wind.dailyMaxGustMph,
      averageMinutes: dataB.wind.averageMinutes,
      average: dataB.wind.average
    },
    metadata: {
      weatherStationTime: '2025-10-21T12:45:00Z',
      temperatureDisplayUnit: 'C'
    }
  };

  tempWindState.data = dataC;
  if (typeof hooks.applyTemperatureUnitsFromMetadata === 'function') {
    hooks.applyTemperatureUnitsFromMetadata(dataC.metadata);
  }
  updateTempWindCard();

  const gaugeIndicatorC = card.querySelector('.wdash-gauge').style.getPropertyValue('--gauge-indicator');
  assertEqual(gaugeIndicatorC, gaugeIndicator(convertTemperature(dataC.outdoor.temperature, 'C', 'F')), 'gauge indicator mismatch after dataC');
  assertEqual(gaugeUnitButton.textContent, '°C', 'unit indicator mismatch after metadata default');
  assertEqual(gaugeValueEl.textContent, formatTemperature(dataC.outdoor.temperature, 'C', 'C'), 'gauge value mismatch after metadata default');

  const detailNodesMetadata = card.querySelectorAll('.wdash-temp-wind-details .wdash-metric-value');
  assertEqual(detailNodesMetadata[0].textContent, formatTemperature(dataC.outdoor.feelsLike, 'C', 'C'), 'feels like mismatch after metadata default');
  assertEqual(detailNodesMetadata[1].textContent, formatTemperature(dataC.outdoor.dewPoint, 'C', 'C'), 'dew point mismatch after metadata default');
  assertEqual(detailNodesMetadata[2].textContent, formatPercent(dataC.outdoor.humidity, 0), 'humidity mismatch after metadata default');
  assertEqual(detailNodesMetadata[3].textContent, formatSigned(dataC.outdoor.trendPerHour, 1, '°C/hr'), 'trend mismatch after metadata default');

  hooks.setTemperatureDisplayUnit('F');
  updateTempWindCard();

  assertEqual(gaugeUnitButton.textContent, '°F', 'unit indicator mismatch after switching to Fahrenheit');
  assertEqual(gaugeValueEl.textContent, formatTemperature(dataC.outdoor.temperature, 'F', 'C'), 'gauge value mismatch after switching to Fahrenheit');

  const detailNodesF = card.querySelectorAll('.wdash-temp-wind-details .wdash-metric-value');
  assertEqual(detailNodesF[0].textContent, formatTemperature(dataC.outdoor.feelsLike, 'F', 'C'), 'feels like mismatch after switching to Fahrenheit');
  assertEqual(detailNodesF[1].textContent, formatTemperature(dataC.outdoor.dewPoint, 'F', 'C'), 'dew point mismatch after switching to Fahrenheit');
  assertEqual(detailNodesF[2].textContent, formatPercent(dataC.outdoor.humidity, 0), 'humidity mismatch after switching to Fahrenheit');
  assertEqual(detailNodesF[3].textContent, formatSigned(convertTemperatureDelta(dataC.outdoor.trendPerHour, 'C', 'F'), 1, '°F/hr'), 'trend mismatch after switching to Fahrenheit');

  hooks.setTemperatureDisplayUnit('C');
  updateTempWindCard();
  assertEqual(gaugeUnitButton.textContent, '°C', 'unit indicator mismatch after switching back to Celsius');
  assertEqual(gaugeValueEl.textContent, formatTemperature(dataC.outdoor.temperature, 'C', 'C'), 'gauge value mismatch after switching back to Celsius');

  const detailNodesBackToC = card.querySelectorAll('.wdash-temp-wind-details .wdash-metric-value');
  assertEqual(detailNodesBackToC[0].textContent, formatTemperature(dataC.outdoor.feelsLike, 'C', 'C'), 'feels like mismatch after switching back to Celsius');
  assertEqual(detailNodesBackToC[1].textContent, formatTemperature(dataC.outdoor.dewPoint, 'C', 'C'), 'dew point mismatch after switching back to Celsius');
  assertEqual(detailNodesBackToC[2].textContent, formatPercent(dataC.outdoor.humidity, 0), 'humidity mismatch after switching back to Celsius');
  assertEqual(detailNodesBackToC[3].textContent, formatSigned(dataC.outdoor.trendPerHour, 1, '°C/hr'), 'trend mismatch after switching back to Celsius');

  hooks.setWindDisplayUnit('kph');
  updateTempWindCard();

  assertEqual(windUnitButton.textContent, windIndicatorText('kph'), 'wind unit indicator mismatch after switching to kph');
  assertEqual(card.querySelector('.wdash-wind-speed-value').textContent, formatNumber(convertWindSpeed(dataC.wind.speedMph, 'mph', 'kph'), 1), 'wind speed mismatch after switching to kph');
  assertEqual(card.querySelector('.wdash-wind-speed-unit').textContent, 'kph', 'wind unit label mismatch after switching to kph');
  assertEqual(card.querySelector('.wdash-wind-gust-value').textContent, formatWind(dataC.wind.gustMph, 'kph'), 'gust mismatch after switching to kph');

  const detailNodesWindKph = card.querySelectorAll('.wdash-temp-wind-details .wdash-metric-value');
  assertEqual(detailNodesWindKph[4].textContent, formatAverageWind(dataC.wind.average.directionCardinal, dataC.wind.average.speedMph, 'kph'), 'average wind mismatch after switching to kph');
  assertEqual(detailNodesWindKph[5].textContent, formatWind(dataC.wind.dailyMaxGustMph, 'kph'), 'max gust mismatch after switching to kph');

  hooks.setWindDisplayUnit('kts');
  updateTempWindCard();

  assertEqual(windUnitButton.textContent, windIndicatorText('kts'), 'wind unit indicator mismatch after switching to kts');
  assertEqual(card.querySelector('.wdash-wind-speed-value').textContent, formatNumber(convertWindSpeed(dataC.wind.speedMph, 'mph', 'kts'), 1), 'wind speed mismatch after switching to kts');
  assertEqual(card.querySelector('.wdash-wind-speed-unit').textContent, 'kts', 'wind unit label mismatch after switching to kts');
  assertEqual(card.querySelector('.wdash-wind-gust-value').textContent, formatWind(dataC.wind.gustMph, 'kts'), 'gust mismatch after switching to kts');

  const detailNodesWindKts = card.querySelectorAll('.wdash-temp-wind-details .wdash-metric-value');
  assertEqual(detailNodesWindKts[4].textContent, formatAverageWind(dataC.wind.average.directionCardinal, dataC.wind.average.speedMph, 'kts'), 'average wind mismatch after switching to kts');
  assertEqual(detailNodesWindKts[5].textContent, formatWind(dataC.wind.dailyMaxGustMph, 'kts'), 'max gust mismatch after switching to kts');

  hooks.applyWindUnitsFromMetadata({ windDisplayUnit: 'mph' });
  updateTempWindCard();

  assertEqual(windUnitButton.textContent, windIndicatorText('mph'), 'wind unit indicator mismatch after resetting to metadata mph');
  assertEqual(card.querySelector('.wdash-wind-speed-unit').textContent, 'mph', 'wind unit label mismatch after resetting to metadata mph');

  hooks.setWindDisplayUnit('mph');
  updateTempWindCard();

  updateTempWindCard();
  assertEqual(card.querySelector('.wdash-gauge').style.getPropertyValue('--gauge-indicator'), gaugeIndicatorC, 'gauge indicator should remain stable on repeat update');

  console.log('Temp-wind card harness passed');
})();
