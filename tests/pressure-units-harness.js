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

function approxEqual(actual, expected, epsilon = 1e-6) {
  return Math.abs(actual - expected) <= epsilon;
}

(function main() {
  const { window } = createTestEnvironment();
  const hooks = loadWeatherDashboard(window);
  const {
    applyPressureUnitsFromMetadata,
    setPressureDisplayUnit,
    setPressureInputUnit,
    getDisplayPressureUnit,
    getInputPressureUnit,
    formatPressure,
    formatPressureChange,
    convertPressure
  } = hooks;

  if (typeof applyPressureUnitsFromMetadata !== 'function') {
    throw new Error('applyPressureUnitsFromMetadata hook missing');
  }

  applyPressureUnitsFromMetadata({ pressureUnits: { input: 'inhg', display: 'inhg' } });
  assert(getDisplayPressureUnit() === 'inhg', 'display unit should default to inches of mercury');
  assert(getInputPressureUnit() === 'inhg', 'input unit should default to inches of mercury');

  const mbValue = convertPressure(29.92, 'inhg', 'mb');
  assert(approxEqual(mbValue, 1013.207, 1e-3), '29.92 inHg should convert to approximately 1013.207 mb');

  const inHgValue = convertPressure(1013.2, 'mb', 'inhg');
  assert(approxEqual(inHgValue, 29.9198, 1e-3), '1013.2 mb should convert back to roughly 29.92 inHg');

  setPressureDisplayUnit('mb');
  assert(getDisplayPressureUnit() === 'mb', 'display unit should switch to millibars');

  const formattedPressure = formatPressure(29.92, { sourceUnit: 'inhg' });
  assert(formattedPressure === '1013.2 mb', 'pressure value should format using millibars');

  const formattedChange = formatPressureChange(0.1, { sourceUnit: 'inhg', perHour: true });
  assert(formattedChange === '+3.39 mb/hr', 'pressure change should convert to millibars per hour');

  const formattedRelative = formatPressure(1013.2, { sourceUnit: 'mb', displayUnit: 'inhg' });
  assert(formattedRelative === '29.92 inHg', 'pressure formatting should honor explicit display units');

  setPressureInputUnit('mb');
  assert(getInputPressureUnit() === 'mb', 'input unit should switch to millibars');

  applyPressureUnitsFromMetadata({ pressureUnits: { display: 'inhg' } });
  assert(getDisplayPressureUnit() === 'mb', 'manual override should persist when metadata reiterates inches of mercury');

  setPressureDisplayUnit('inhg');
  assert(getDisplayPressureUnit() === 'inhg', 'display unit should switch back to inches of mercury');

  applyPressureUnitsFromMetadata({ pressureUnits: { display: 'mb' } });
  assert(getDisplayPressureUnit() === 'mb', 'metadata change should update display unit to millibars');

  setPressureDisplayUnit('inhg');

  console.log('Pressure units harness passed');
})();
