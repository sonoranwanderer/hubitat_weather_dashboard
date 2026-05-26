'use strict';

const http = require('http');
const https = require('https');

const DEFAULT_BASE_WIDTH = 1200;
const DEFAULT_BASE_HEIGHT = 900;

function normalizeText(value) {
  if (value == null) return '';
  return String(value).trim();
}

function ensureDefaultLayoutMetadata(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const metadata = payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
    ? payload.metadata
    : (payload.metadata = {});
  const layout = metadata.layout && typeof metadata.layout === 'object' && !Array.isArray(metadata.layout)
    ? metadata.layout
    : (metadata.layout = {});

  if (!Number.isFinite(Number(layout.baseWidth)) || Number(layout.baseWidth) <= 0) {
    layout.baseWidth = DEFAULT_BASE_WIDTH;
  }
  if (!Number.isFinite(Number(layout.baseHeight)) || Number(layout.baseHeight) <= 0) {
    layout.baseHeight = DEFAULT_BASE_HEIGHT;
  }

  return payload;
}

function toAttributeMap(source) {
  if (!source) return null;
  if (Array.isArray(source)) {
    const map = {};
    source.forEach(entry => {
      if (!entry || typeof entry !== 'object') return;
      const key = entry.name || entry.attribute || entry.id;
      if (!key) return;
      map[key] = entry.value != null ? entry.value : entry.currentValue;
    });
    return map;
  }
  if (typeof source === 'object') return source;
  return null;
}

function parseJsonAttribute(attributes, key) {
  if (!attributes || !key) return null;
  const raw = attributes[key];
  if (raw == null) return null;
  const text = normalizeText(raw);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Maker API attribute ${key} contained invalid JSON (${error.message}).`);
  }
}

function collectAmbientSegments(attributes) {
  if (!attributes) return null;
  const segments = [];
  Object.keys(attributes).forEach(key => {
    const match = key.match(/^segmentAmbient(\d+)$/);
    if (!match) return;
    const segment = parseJsonAttribute(attributes, key);
    if (segment && typeof segment === 'object') {
      segments.push({ index: Number(match[1]) || segment.segmentIndex || 0, data: segment });
    }
  });

  if (!segments.length) return null;
  segments.sort((a, b) => a.index - b.index);

  const sensors = [];
  let rotation = null;
  let humidityUnit = null;
  let total = null;

  segments.forEach(entry => {
    const segment = entry.data;
    if (!segment || typeof segment !== 'object') return;
    const list = Array.isArray(segment.ambientSensors) ? segment.ambientSensors : [];
    list.forEach(sensor => {
      if (sensor && typeof sensor === 'object') sensors.push(sensor);
    });
    if (rotation == null && segment.ambientRotationSeconds != null) {
      rotation = segment.ambientRotationSeconds;
    }
    if (humidityUnit == null && segment.ambientHumidityUnit != null) {
      humidityUnit = segment.ambientHumidityUnit;
    }
    const candidateTotal = Number(segment.totalAmbientSensors);
    if (Number.isFinite(candidateTotal)) {
      total = total == null ? candidateTotal : Math.max(total, candidateTotal);
    }
  });

  return {
    sensors,
    rotation,
    humidityUnit,
    total: total != null ? total : sensors.length
  };
}

function buildPayloadFromDevice(device) {
  const attributes = toAttributeMap(device && device.attributes);
  if (!attributes) return null;

  const payload = {};
  const core = parseJsonAttribute(attributes, 'segmentCore');
  if (core && typeof core === 'object') Object.assign(payload, core);

  const precip = parseJsonAttribute(attributes, 'segmentPrecip');
  if (precip && typeof precip === 'object') Object.assign(payload, precip);

  const air = parseJsonAttribute(attributes, 'segmentAirQuality');
  if (air && typeof air === 'object') {
    if (air.outdoorAirQuality && typeof air.outdoorAirQuality === 'object') {
      payload.outdoorAirQuality = air.outdoorAirQuality;
    }
    if (air.indoorAirQuality && typeof air.indoorAirQuality === 'object') {
      payload.indoorAirQuality = air.indoorAirQuality;
    }
  }

  const ambient = collectAmbientSegments(attributes);
  if (ambient) {
    if (ambient.sensors.length) payload.ambientSensors = ambient.sensors;
    if (ambient.rotation != null) payload.ambientRotationSeconds = ambient.rotation;
    if (ambient.humidityUnit != null) payload.ambientHumidityUnit = ambient.humidityUnit;
    if (ambient.total != null) payload.totalAmbientSensors = ambient.total;
  }

  const meta = parseJsonAttribute(attributes, 'segmentMeta');
  if (meta && typeof meta === 'object') {
    if (meta.outlook24h && typeof meta.outlook24h === 'object') payload.outlook24h = meta.outlook24h;
    if (meta.metadata && typeof meta.metadata === 'object') {
      payload.metadata = Object.assign({}, payload.metadata || {}, meta.metadata);
    }
  }

  const layoutSegment = parseJsonAttribute(attributes, 'segmentLayout');
  if (layoutSegment && typeof layoutSegment === 'object' && layoutSegment.layout) {
    payload.metadata = payload.metadata || {};
    payload.metadata.layout = layoutSegment.layout;
  }

  const updated = normalizeText(attributes.dashboardUpdated || attributes.lastUpdated);
  if (updated) {
    payload.metadata = payload.metadata || {};
    if (!payload.metadata.generatedAt) payload.metadata.generatedAt = updated;
    payload.metadata.dashboardUpdatedAt = updated;
  }

  ensureDefaultLayoutMetadata(payload);
  return Object.keys(payload).length ? payload : null;
}

function normalizeMakerApiDeviceList(response) {
  if (!response) return null;
  if (Array.isArray(response)) return response;
  if (Array.isArray(response.devices)) return response.devices;
  if (response.device && typeof response.device === 'object') return [response.device];
  if (response.name && response.attributes) return [response];
  return null;
}

function selectDashboardDevice(devices, options = {}) {
  if (!Array.isArray(devices) || devices.length === 0) return null;
  const requestedIds = new Set(
    Array.isArray(options.deviceIds)
      ? options.deviceIds.map(id => String(id))
      : []
  );

  if (requestedIds.size) {
    const requested = devices.find(device => device && requestedIds.has(String(device.id)));
    if (requested) return requested;
  }

  const byLabel = devices.find(device => {
    const name = String(device && device.name || '').toLowerCase();
    const label = String(device && device.label || '').toLowerCase();
    const type = String(device && device.type || '').toLowerCase();
    return [name, label, type].some(text => text.includes('weather dashboard'));
  });
  return byLabel || (devices.length === 1 ? devices[0] : null);
}

function buildPayloadFromMakerApiResponse(response, options = {}) {
  const devices = normalizeMakerApiDeviceList(response);
  if (!devices) return null;
  const device = selectDashboardDevice(devices, options);
  if (!device) {
    throw new Error('Maker API response did not include the Weather Dashboard Device.');
  }
  const payload = buildPayloadFromDevice(device);
  if (!payload) {
    throw new Error('Weather Dashboard Device attributes were empty.');
  }
  return {
    payload,
    selectedDevice: {
      id: device.id != null ? String(device.id) : null,
      name: device.name || null,
      label: device.label || null,
      type: device.type || null
    },
    deviceCount: devices.length
  };
}

function buildMakerApiUrl(options = {}) {
  const hubBaseUrl = options.hubBaseUrl || options.hub || '';
  const appId = options.appId || '';
  if (!hubBaseUrl || !appId) {
    throw new Error('hubBaseUrl and appId are required.');
  }
  const base = new URL(/^https?:\/\//i.test(hubBaseUrl) ? hubBaseUrl : `http://${hubBaseUrl}`);
  const target = new URL(`/apps/api/${encodeURIComponent(appId)}/devices/all`, base);
  if (options.makerToken) target.searchParams.set('access_token', options.makerToken);
  if (Array.isArray(options.deviceIds) && options.deviceIds.length) {
    target.searchParams.set('deviceIds', options.deviceIds.join(','));
  }
  return target.toString();
}

function redactUrlSecrets(value) {
  if (!value) return value;
  const target = new URL(value);
  ['access_token', 'makerToken', 'dashboardToken'].forEach(key => {
    if (target.searchParams.has(key)) target.searchParams.set(key, 'REDACTED');
  });
  return target.toString();
}

function fetchJson(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs) || 10000;
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = target.protocol === 'https:' ? https : http;
    const request = client.get(target, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        body += chunk;
      });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Maker API returned HTTP ${response.statusCode}: ${body.slice(0, 200)}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error(`Maker API returned invalid JSON (${error.message}).`));
        }
      });
    });
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`Maker API request timed out after ${timeoutMs}ms.`));
    });
    request.on('error', reject);
  });
}

module.exports = {
  buildMakerApiUrl,
  buildPayloadFromDevice,
  buildPayloadFromMakerApiResponse,
  collectAmbientSegments,
  ensureDefaultLayoutMetadata,
  fetchJson,
  normalizeMakerApiDeviceList,
  parseJsonAttribute,
  redactUrlSecrets,
  selectDashboardDevice,
  toAttributeMap
};
