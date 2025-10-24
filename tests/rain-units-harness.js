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
    applyRainUnitsFromMetadata,
    setRainDisplayUnit,
    setRainInputUnit,
    getDisplayRainUnit,
    getInputRainUnit,
    formatRain,
    convertRainDepth
  } = hooks;

  if (typeof applyRainUnitsFromMetadata !== 'function') {
    throw new Error('applyRainUnitsFromMetadata hook missing');
  }

  applyRainUnitsFromMetadata({ rainUnits: { input: 'in', display: 'in' } });
  assert(getDisplayRainUnit() === 'in', 'display unit should default to inches');
  assert(getInputRainUnit() === 'in', 'input unit should default to inches');

  const mmDepth = convertRainDepth(1, 'in', 'mm');
  assert(approxEqual(mmDepth, 25.4), '1 inch should convert to 25.4 millimeters');

  const inchDepth = convertRainDepth(25.4, 'mm', 'in');
  assert(approxEqual(inchDepth, 1), '25.4 millimeters should convert to 1 inch');

  setRainDisplayUnit('mm');
  assert(getDisplayRainUnit() === 'mm', 'display unit should switch to millimeters');

  const formattedDepth = formatRain(1, { sourceUnit: 'in' });
  assert(formattedDepth === '25.40 mm', 'rain depth should format using millimeters');

  const formattedRate = formatRain(0.5, { sourceUnit: 'in', perHour: true });
  assert(formattedRate === '12.70 mm/hr', 'rain rate should format using millimeters per hour');

  const invalid = formatRain(null);
  assert(invalid === '--', 'invalid rain values should return placeholders');

  setRainInputUnit('mm');
  assert(getInputRainUnit() === 'mm', 'input unit should switch to millimeters');

  applyRainUnitsFromMetadata({ rainUnits: { display: 'in' } });
  assert(getDisplayRainUnit() === 'mm', 'manual override should persist when metadata reaffirms inches');

  setRainDisplayUnit('in');
  assert(getDisplayRainUnit() === 'in', 'display unit should return to inches');

  applyRainUnitsFromMetadata({ rainUnits: { display: 'mm' } });
  assert(getDisplayRainUnit() === 'mm', 'metadata change should update display unit to millimeters');

  setRainDisplayUnit('in');

  console.log('Rain units harness passed');
})();
