'use strict';

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
  'ambientHumidityUnit',
  'outdoorAirQuality',
  'indoorAirQuality',
  'metadata',
  'layout',
  'outlook24h'
]);

function isPlainObject(value) {
  if (!value || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function deepMerge(target, source) {
  const base = isPlainObject(target) ? { ...target } : {};
  if (!isPlainObject(source)) {
    return base;
  }

  for (const [key, value] of Object.entries(source)) {
    if (isPlainObject(value)) {
      base[key] = deepMerge(base[key], value);
    } else if (Array.isArray(value)) {
      base[key] = value.map(item => (isPlainObject(item) ? { ...item } : item));
    } else {
      base[key] = value;
    }
  }

  return base;
}

function mergePayloadSegments(segments) {
  if (!Array.isArray(segments) || segments.length === 0) {
    return null;
  }

  const result = {};
  const ambientSensors = [];
  const ambientMeta = {
    total: null,
    rotation: null,
    humidityUnit: null
  };
  let layout = null;

  for (const segment of segments) {
    if (!isPlainObject(segment)) continue;

    if (Array.isArray(segment.ambientSensors)) {
      const total = Number(segment.totalAmbientSensors);
      if (Number.isFinite(total)) {
        ambientMeta.total = ambientMeta.total == null ? total : Math.max(ambientMeta.total, total);
      }
      if (segment.ambientRotationSeconds != null && ambientMeta.rotation == null) {
        ambientMeta.rotation = segment.ambientRotationSeconds;
      }
      if (segment.ambientHumidityUnit != null && ambientMeta.humidityUnit == null) {
        ambientMeta.humidityUnit = segment.ambientHumidityUnit;
      }
      segment.ambientSensors.forEach(sensor => {
        if (isPlainObject(sensor)) {
          ambientSensors.push({ ...sensor });
        }
      });
    }

    for (const [key, value] of Object.entries(segment)) {
      if (
        key === 'ambientSensors' ||
        key === 'totalAmbientSensors' ||
        key === 'ambientRotationSeconds' ||
        key === 'ambientHumidityUnit' ||
        key === 'segmentIndex' ||
        key === 'segmentSize'
      ) {
        continue;
      }

      if (key === 'metadata' && isPlainObject(value)) {
        result.metadata = deepMerge(result.metadata, value);
        continue;
      }

      if (key === 'layout' && isPlainObject(value)) {
        layout = layout ? deepMerge(layout, value) : { ...value };
        continue;
      }

      if (key === 'outlook24h' && isPlainObject(value)) {
        result.outlook24h = { ...value };
        continue;
      }

      if (KNOWN_PAYLOAD_KEYS.has(key)) {
        result[key] = value;
      }
    }
  }

  if (ambientSensors.length) {
    ambientSensors.sort((a, b) => {
      const aOrdinal = Number(a && a.ordinal);
      const bOrdinal = Number(b && b.ordinal);
      if (Number.isFinite(aOrdinal) && Number.isFinite(bOrdinal)) {
        return aOrdinal - bOrdinal;
      }
      return 0;
    });
    result.ambientSensors = ambientSensors.map(sensor => ({ ...sensor }));
  }

  if (ambientMeta.rotation != null) {
    result.ambientRotationSeconds = ambientMeta.rotation;
  }
  if (ambientMeta.humidityUnit != null) {
    result.ambientHumidityUnit = ambientMeta.humidityUnit;
  }
  if (Number.isFinite(ambientMeta.total)) {
    result.totalAmbientSensors = ambientMeta.total;
  }

  if (layout) {
    result.metadata = result.metadata || {};
    result.metadata.layout = layout;
  }

  return Object.keys(result).length ? result : null;
}

(function exposeTestHooks() {
  const globalReference =
    typeof globalThis !== 'undefined'
      ? globalThis
      : typeof window !== 'undefined'
      ? window
      : typeof global !== 'undefined'
      ? global
      : null;

  if (!globalReference || globalReference.__WDASH_TEST_MODE__ !== true) {
    return;
  }

  const hooks = globalReference.__WDASH_TEST_HOOKS__ || (globalReference.__WDASH_TEST_HOOKS__ = {});
  hooks.KNOWN_PAYLOAD_KEYS = KNOWN_PAYLOAD_KEYS;
  hooks.mergePayloads = mergePayloadSegments;
})();

module.exports = {
  KNOWN_PAYLOAD_KEYS,
  mergePayloadSegments
};
