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
    applyLightningUnitsFromMetadata,
    setLightningDisplayUnit,
    setLightningInputUnit,
    getDisplayLightningUnit,
    getInputLightningUnit,
    convertLightningDistance,
    formatLightningDistance
  } = hooks;

  if (typeof applyLightningUnitsFromMetadata !== 'function') {
    throw new Error('applyLightningUnitsFromMetadata hook missing');
  }

  applyLightningUnitsFromMetadata({ lightningUnits: { input: 'mi', display: 'mi' } });
  assert(getDisplayLightningUnit() === 'mi', 'display unit should default to miles');
  assert(getInputLightningUnit() === 'mi', 'input unit should default to miles');

  const kmDistance = convertLightningDistance(10, 'mi', 'km');
  assert(approxEqual(kmDistance, 16.09344), '10 miles should convert to approximately 16.09344 kilometers');

  const miDistance = convertLightningDistance(32.18688, 'km', 'mi');
  assert(approxEqual(miDistance, 20), '32.18688 kilometers should convert to approximately 20 miles');

  setLightningDisplayUnit('km');
  assert(getDisplayLightningUnit() === 'km', 'display unit should switch to kilometers');

  const formattedKm = formatLightningDistance(12, { sourceUnit: 'mi' });
  assert(formattedKm === '19.3 km', 'lightning distance should format using kilometers when display unit is km');

  const formattedMi = formatLightningDistance(19.312128, { sourceUnit: 'km', unit: 'mi', decimals: 2 });
  assert(formattedMi === '12.00 mi', 'explicit unit override should force miles display with requested decimals');

  const invalid = formatLightningDistance(null);
  assert(invalid === '--', 'invalid lightning values should return placeholders');

  setLightningInputUnit('km');
  assert(getInputLightningUnit() === 'km', 'input unit should switch to kilometers');

  applyLightningUnitsFromMetadata({ lightningUnits: { display: 'mi' } });
  assert(getDisplayLightningUnit() === 'km', 'manual override should persist when metadata reiterates miles');

  setLightningDisplayUnit('mi');
  assert(getDisplayLightningUnit() === 'mi', 'display unit should return to miles');

  applyLightningUnitsFromMetadata({ lightningUnits: { display: 'km' } });
  assert(getDisplayLightningUnit() === 'km', 'metadata change should update display unit to kilometers');

  setLightningDisplayUnit('mi');

  console.log('Lightning units harness passed');
})();
