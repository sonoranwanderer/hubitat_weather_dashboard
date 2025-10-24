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

function formatTemperature(value, unit = 'F') {
  if (!Number.isFinite(value)) return '--°';
  const normalized = unit === 'C' ? (value - 32) * (5 / 9) : value;
  return `${normalized.toFixed(1)}°`;
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
  const { updateTempWindCard, tempWindState } = hooks;
  if (typeof updateTempWindCard !== 'function') {
    throw new Error('updateTempWindCard hook missing');
  }

  const dataA = {
    outdoor: {
      temperatureF: 72.3,
      dailyHighF: 85.1,
      dailyLowF: 60.5,
      feelsLikeF: 74.2,
      dewPointF: 55.2,
      humidity: 45,
      trendFPerHour: -0.5,
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
  assertEqual(gaugeValueEl.textContent, formatTemperature(dataA.outdoor.temperatureF), 'gauge value mismatch after dataA');
  assertEqual(gaugeUnitButton.textContent, '°F', 'unit indicator mismatch after dataA');
  assertEqual(card.querySelector('.wdash-temp-extrema--high .wdash-temp-extrema-value').textContent, formatTemperature(dataA.outdoor.dailyHighF), 'high value mismatch after dataA');
  assertEqual(card.querySelector('.wdash-temp-extrema--low .wdash-temp-extrema-value').textContent, formatTemperature(dataA.outdoor.dailyLowF), 'low value mismatch after dataA');

  const detailValuesA = [
    formatTemperature(dataA.outdoor.feelsLikeF),
    formatTemperature(dataA.outdoor.dewPointF),
    formatPercent(dataA.outdoor.humidity, 0),
    formatSigned(dataA.outdoor.trendFPerHour, 1, '°F/hr'),
    `${dataA.wind.average.directionCardinal} ${formatNumber(dataA.wind.average.speedMph, 1)} mph`,
    `${formatNumber(dataA.wind.dailyMaxGustMph, 1)} mph`
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
  assertEqual(card.querySelector('.wdash-wind-gust-value').textContent, `${formatNumber(dataA.wind.gustMph, 1)} mph`, 'gust value mismatch after dataA');

  const compass = card.querySelector('.wdash-wind-compass');
  assertEqual(compass.getAttribute('aria-label'), `Wind direction SE ${formatDegrees(dataA.wind.directionDegrees)}`, 'aria label mismatch after dataA');
  const currentArrow = compass.querySelector('.wdash-compass-arrow--current');
  assertEqual(currentArrow.style.transform, `rotate(${normalizeDegrees(dataA.wind.directionDegrees)}deg)`, 'current arrow rotation mismatch after dataA');
  const avgArrow = compass.querySelector('.wdash-compass-arrow--avg');
  assertEqual(avgArrow.style.display, '', 'avg arrow should be visible for dataA');
  assertEqual(avgArrow.style.transform, `rotate(${normalizeDegrees(dataA.wind.average.directionDegrees)}deg)`, 'avg arrow rotation mismatch after dataA');

  const gaugeIndicatorBefore = card.querySelector('.wdash-gauge').style.getPropertyValue('--gauge-indicator');
  assertEqual(gaugeIndicatorBefore, gaugeIndicator(dataA.outdoor.temperatureF), 'gauge indicator mismatch after dataA');

  const dataB = {
    outdoor: {
      temperatureF: 65.0,
      dailyHighF: 70.2,
      dailyLowF: 50.4,
      feelsLikeF: 63.5,
      dewPointF: 52.1,
      humidity: 60,
      trendFPerHour: 0.2,
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

  assertEqual(gaugeValueEl.textContent, formatTemperature(dataB.outdoor.temperatureF), 'gauge value mismatch after dataB');
  assertEqual(compass.getAttribute('aria-label'), `Wind direction NE ${formatDegrees(dataB.wind.directionDegrees)}`, 'aria label mismatch after dataB');
  assertEqual(currentArrow.style.transform, `rotate(${normalizeDegrees(dataB.wind.directionDegrees)}deg)`, 'current arrow rotation mismatch after dataB');
  assertEqual(avgArrow.style.display, 'none', 'avg arrow should be hidden for dataB');
  assertEqual(card.querySelector('.wdash-wind-gust-value').textContent, `${formatNumber(dataB.wind.gustMph, 1)} mph`, 'gust mismatch after dataB');

  const gaugeIndicatorAfter = card.querySelector('.wdash-gauge').style.getPropertyValue('--gauge-indicator');
  assertEqual(gaugeIndicatorAfter, gaugeIndicator(dataB.outdoor.temperatureF), 'gauge indicator mismatch after dataB');
  assert(gaugeIndicatorAfter !== gaugeIndicatorBefore, 'gauge indicator should change for new data');

  const speedValueB = card.querySelector('.wdash-wind-speed-value').textContent;
  assertEqual(speedValueB, formatNumber(dataB.wind.speedMph, 1), 'speed value mismatch after dataB');

  const dataC = {
    outdoor: {
      temperatureF: 68.0,
      dailyHighF: 74.2,
      dailyLowF: 55.1,
      feelsLikeF: 66.5,
      dewPointF: 50.8,
      humidity: 58,
      trendFPerHour: -0.3,
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
      temperatureUnits: { input: 'C', display: 'C' },
      temperatureInputUnit: 'C',
      temperatureDisplayUnit: 'C'
    }
  };

  tempWindState.data = dataC;
  if (typeof hooks.applyTemperatureUnitsFromMetadata === 'function') {
    hooks.applyTemperatureUnitsFromMetadata(dataC.metadata);
  }
  updateTempWindCard();

  const gaugeIndicatorC = card.querySelector('.wdash-gauge').style.getPropertyValue('--gauge-indicator');
  assertEqual(gaugeIndicatorC, gaugeIndicator(dataC.outdoor.temperatureF), 'gauge indicator mismatch after dataC');
  assertEqual(gaugeUnitButton.textContent, '°C', 'unit indicator mismatch after metadata default');
  assertEqual(gaugeValueEl.textContent, formatTemperature(dataC.outdoor.temperatureF, 'C'), 'gauge value mismatch after metadata default');

  const detailNodesMetadata = card.querySelectorAll('.wdash-temp-wind-details .wdash-metric-value');
  assertEqual(detailNodesMetadata[0].textContent, formatTemperature(dataC.outdoor.feelsLikeF, 'C'), 'feels like mismatch after metadata default');
  assertEqual(detailNodesMetadata[1].textContent, formatTemperature(dataC.outdoor.dewPointF, 'C'), 'dew point mismatch after metadata default');
  assertEqual(detailNodesMetadata[2].textContent, formatPercent(dataC.outdoor.humidity, 0), 'humidity mismatch after metadata default');
  assertEqual(detailNodesMetadata[3].textContent, formatSigned(dataC.outdoor.trendFPerHour * (5 / 9), 1, '°C/hr'), 'trend mismatch after metadata default');

  hooks.setTemperatureDisplayUnit('F');
  updateTempWindCard();

  assertEqual(gaugeUnitButton.textContent, '°F', 'unit indicator mismatch after switching to Fahrenheit');
  assertEqual(gaugeValueEl.textContent, formatTemperature(dataC.outdoor.temperatureF), 'gauge value mismatch after switching to Fahrenheit');

  const detailNodesF = card.querySelectorAll('.wdash-temp-wind-details .wdash-metric-value');
  assertEqual(detailNodesF[0].textContent, formatTemperature(dataC.outdoor.feelsLikeF), 'feels like mismatch after switching to Fahrenheit');
  assertEqual(detailNodesF[1].textContent, formatTemperature(dataC.outdoor.dewPointF), 'dew point mismatch after switching to Fahrenheit');
  assertEqual(detailNodesF[2].textContent, formatPercent(dataC.outdoor.humidity, 0), 'humidity mismatch after switching to Fahrenheit');
  assertEqual(detailNodesF[3].textContent, formatSigned(dataC.outdoor.trendFPerHour, 1, '°F/hr'), 'trend mismatch after switching to Fahrenheit');

  hooks.setTemperatureDisplayUnit('C');
  updateTempWindCard();
  assertEqual(gaugeUnitButton.textContent, '°C', 'unit indicator mismatch after switching back to Celsius');
  assertEqual(gaugeValueEl.textContent, formatTemperature(dataC.outdoor.temperatureF, 'C'), 'gauge value mismatch after switching back to Celsius');

  const detailNodesBackToC = card.querySelectorAll('.wdash-temp-wind-details .wdash-metric-value');
  assertEqual(detailNodesBackToC[0].textContent, formatTemperature(dataC.outdoor.feelsLikeF, 'C'), 'feels like mismatch after switching back to Celsius');
  assertEqual(detailNodesBackToC[1].textContent, formatTemperature(dataC.outdoor.dewPointF, 'C'), 'dew point mismatch after switching back to Celsius');
  assertEqual(detailNodesBackToC[2].textContent, formatPercent(dataC.outdoor.humidity, 0), 'humidity mismatch after switching back to Celsius');
  assertEqual(detailNodesBackToC[3].textContent, formatSigned(dataC.outdoor.trendFPerHour * (5 / 9), 1, '°C/hr'), 'trend mismatch after switching back to Celsius');

  updateTempWindCard();
  assertEqual(card.querySelector('.wdash-gauge').style.getPropertyValue('--gauge-indicator'), gaugeIndicatorC, 'gauge indicator should remain stable on repeat update');

  console.log('Temp-wind card harness passed');
})();

