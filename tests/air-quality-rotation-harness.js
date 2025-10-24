'use strict';

const {
  createTestEnvironment,
  loadWeatherDashboard
} = require('./support/fake-dom');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

(function main() {
  const { window, document } = createTestEnvironment();

  const timeouts = [];
  const fakeSetTimeout = (fn, delay) => {
    const handle = { fn, delay, cleared: false };
    timeouts.push(handle);
    return handle;
  };
  const fakeClearTimeout = handle => {
    if (handle && typeof handle === 'object') {
      handle.cleared = true;
    }
  };

  window.setTimeout = fakeSetTimeout;
  window.clearTimeout = fakeClearTimeout;
  global.setTimeout = fakeSetTimeout;
  global.clearTimeout = fakeClearTimeout;

  const tile = document.createElement('div');
  tile.setAttribute('id', 'tile-0');
  document.body.appendChild(tile);

  const card = document.createElement('section');
  card.classList.add('wdash-card', 'wdash-card--air');
  tile.appendChild(card);

  const hooks = loadWeatherDashboard(window);
  const {
    setupAirQualityRotation,
    updateAirQualityCard,
    getAirQualityRotationState
  } = hooks;

  if (typeof setupAirQualityRotation !== 'function') {
    throw new Error('setupAirQualityRotation hook missing');
  }
  if (typeof getAirQualityRotationState !== 'function') {
    throw new Error('getAirQualityRotationState hook missing');
  }

  const payloadA = {
    outdoorAirQuality: {
      aqi: 13,
      aqiColor: '3ea72d',
      aqi_avg_24h: 8,
      aqiColor_avg_24h: '3ea72d',
      pm25: 3.0,
      pm25_avg_24h: 1.8
    },
    indoorAirQuality: {
      aqi: 5,
      aqiColor: '3ea72d',
      aqi_avg_24h: 7,
      aqiColor_avg_24h: '3ea72d',
      pm25: 1.3,
      pm25_avg_24h: 1.6,
      pm10: 1.7,
      pm10_avg_24h: 2.0,
      carbonDioxide: 660,
      carbonDioxide_avg_24h: 666
    }
  };

  const payloadB = {
    outdoorAirQuality: {
      aqi: 37,
      aqiColor: '3ea72d',
      aqi_avg_24h: 20,
      aqiColor_avg_24h: '3ea72d',
      pm25: 4.4,
      pm25_avg_24h: 2.5
    },
    indoorAirQuality: {
      aqi: 11,
      aqiColor: '3ea72d',
      aqi_avg_24h: 9,
      aqiColor_avg_24h: '3ea72d',
      pm25: 2.1,
      pm25_avg_24h: 1.9,
      pm10: 2.5,
      pm10_avg_24h: 2.2,
      carbonDioxide: 710,
      carbonDioxide_avg_24h: 705
    }
  };

  setupAirQualityRotation(payloadA);
  updateAirQualityCard();

  assert(timeouts.length === 1, 'rotation timer should start once');
  let state = getAirQualityRotationState();
  const firstTimer = state.timer;
  assert(firstTimer === timeouts[0], 'timer handle should match first scheduled timeout');
  assert(Array.isArray(state.sources) && state.sources.length === 2, 'both air quality sources should be tracked');

  let markup = card.outerHTML || '';
  assert(markup.includes('>13<'), 'outdoor AQI should render from the initial payload');

  setupAirQualityRotation(payloadB);
  state = getAirQualityRotationState();

  assert(timeouts.length === 1, 'data refresh should not schedule a second timer');
  assert(state.timer === firstTimer, 'existing rotation timer should persist across refreshes');

  markup = card.outerHTML || '';
  assert(markup.includes('>37<'), 'outdoor AQI should refresh with the latest payload');

  if (typeof firstTimer.fn !== 'function') {
    throw new Error('scheduled timeout is missing its callback');
  }

  firstTimer.fn();

  assert(timeouts.length === 2, 'rotation callback should schedule the next timeout');
  state = getAirQualityRotationState();
  assert(state.index === 1, 'rotation index should advance to the indoor source');
  assert(state.timer === timeouts[1], 'new timeout handle should replace the previous timer');

  markup = card.outerHTML || '';
  assert(markup.includes('CO₂'), 'indoor metrics should render after rotation');
  assert(markup.includes('710 ppm'), 'indoor CO₂ value should reflect the refreshed payload');

  console.log('Air quality rotation harness passed');
})();
