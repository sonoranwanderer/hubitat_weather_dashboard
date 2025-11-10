'use strict';

const DEFAULT_RENDER_BASE_WIDTH = 1200;
const DEFAULT_RENDER_BASE_HEIGHT = 900;

const DEFAULT_LAYOUT = {
  columns: ['1fr', '1fr'],
  rows: ['auto', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto'],
  gap: '18px',
  cards: [
    { id: 'outdoor', title: 'Outdoor Conditions', row: 1, column: 1, rowSpan: 1, colSpan: 2 },
    { id: 'indoor', title: 'Indoor Conditions', row: 2, column: 1, rowSpan: 1 },
    { id: 'wind', title: 'Wind', row: 2, column: 2, rowSpan: 1 },
    { id: 'rain', title: 'Rainfall', row: 3, column: 1, rowSpan: 1 },
    { id: 'pressure', title: 'Pressure', row: 3, column: 2, rowSpan: 1 },
    { id: 'solar', title: 'Solar & Sun', row: 4, column: 1, rowSpan: 1 },
    { id: 'lightning', title: 'Lightning', row: 4, column: 2, rowSpan: 1 },
    { id: 'outdoorAirQuality', title: 'Outdoor Air Quality', row: 5, column: 1, rowSpan: 1 },
    { id: 'indoorAirQuality', title: 'Indoor Air Quality', row: 5, column: 2, rowSpan: 1 },
    { id: 'ambientSensors', title: 'Ambient Sensors', row: 6, column: 1, rowSpan: 1, colSpan: 2 },
    { id: 'outlook24h', title: '24 Hour Outlook', row: 7, column: 1, rowSpan: 1, colSpan: 2 },
    { id: 'metadata', title: 'Station Metadata', row: 8, column: 1, rowSpan: 1, colSpan: 2 }
  ]
};

function coercePositiveDimension(value) {
  if (value == null) return null;
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(numeric)) return null;
  const positive = Math.max(0, Number(numeric));
  return positive > 0 ? positive : null;
}

function formatLabel(key) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, match => match.toUpperCase());
}

function formatValue(value) {
  if (value == null) return '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return '';
    }
    if (Number.isInteger(value)) {
      return String(value);
    }
    const abs = Math.abs(value);
    if (abs >= 100) {
      return String(Math.round(value));
    }
    return value.toFixed(1);
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch (err) {
      return String(value);
    }
  }
  return String(value);
}

function convertObjectToMetrics(source) {
  const metrics = [];
  if (!source || typeof source !== 'object') {
    return metrics;
  }
  Object.entries(source).forEach(([key, value]) => {
    if (value == null) {
      return;
    }
    if (typeof value === 'object' && !Array.isArray(value)) {
      const nested = convertObjectToMetrics(value);
      if (nested.length) {
        metrics.push({
          label: formatLabel(key),
          value: nested.map(entry => `${entry.label}: ${entry.value}`).join(', ')
        });
      }
      return;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) return;
      metrics.push({
        label: formatLabel(key),
        value: value.map(item => formatValue(item)).join(', ')
      });
      return;
    }
    metrics.push({
      label: formatLabel(key),
      value: formatValue(value)
    });
  });
  return metrics;
}

function buildMetricsCard(source) {
  if (!source || typeof source !== 'object') {
    return null;
  }
  if (Array.isArray(source)) {
    if (source.length === 0) {
      return null;
    }
    const metrics = source.map((entry, index) => {
      if (entry && typeof entry === 'object') {
        if (entry.label != null && entry.value != null) {
          return {
            label: String(entry.label),
            value: formatValue(entry.value)
          };
        }
        const label = entry.name != null ? String(entry.name) : `Item ${index + 1}`;
        return {
          label,
          value: formatValue(entry.value != null ? entry.value : entry)
        };
      }
      return {
        label: `Item ${index + 1}`,
        value: formatValue(entry)
      };
    });
    return { metrics };
  }

  const metrics = convertObjectToMetrics(source);
  if (!metrics.length) {
    return null;
  }
  return { metrics };
}

function buildAmbientSensorsCard(sensors, humidityUnit) {
  if (!Array.isArray(sensors) || sensors.length === 0) {
    return null;
  }
  const items = sensors.map((sensor, index) => {
    const label = sensor && sensor.name
      ? String(sensor.name)
      : `Sensor ${sensor && sensor.ordinal != null ? sensor.ordinal : index + 1}`;
    const parts = [];
    if (sensor && sensor.temperature != null) {
      parts.push(`${formatValue(sensor.temperature)}°`);
    }
    if (sensor && sensor.humidity != null) {
      const humidityValue = `${formatValue(sensor.humidity)}${humidityUnit ? `% ${humidityUnit}` : '%'}`;
      parts.push(humidityValue);
    }
    if (sensor && sensor.battery != null) {
      parts.push(`${formatValue(sensor.battery)}% battery`);
    }
    return {
      label,
      value: parts.length ? parts.join(' • ') : formatValue(sensor)
    };
  });
  return { metrics: items };
}

function buildMetadataCard(metadata) {
  if (!metadata || typeof metadata !== 'object') {
    return null;
  }
  const summary = { ...metadata };
  if (summary.layout) {
    delete summary.layout;
  }
  const metrics = convertObjectToMetrics(summary);
  if (!metrics.length) {
    return null;
  }
  return { metrics };
}

function buildRendererData(payload) {
  if (!payload || typeof payload !== 'object') {
    return {};
  }

  const data = {};

  data.outdoor = buildMetricsCard(payload.outdoor);
  data.indoor = buildMetricsCard(payload.indoor);
  data.wind = buildMetricsCard(payload.wind);
  data.rain = buildMetricsCard(payload.rain);
  data.pressure = buildMetricsCard(payload.pressure);
  data.solar = buildMetricsCard(payload.solar);
  data.lightning = buildMetricsCard(payload.lightning);
  data.outdoorAirQuality = buildMetricsCard(payload.outdoorAirQuality);
  data.indoorAirQuality = buildMetricsCard(payload.indoorAirQuality);
  data.ambientSensors = buildAmbientSensorsCard(payload.ambientSensors, payload.ambientHumidityUnit);
  data.outlook24h = buildMetricsCard(payload.outlook24h);
  data.metadata = buildMetadataCard(payload.metadata);

  return data;
}

function selectLayoutCandidate(layout) {
  if (!layout || typeof layout !== 'object') {
    return null;
  }
  if (Array.isArray(layout.cards)) {
    return layout;
  }
  if (layout.desktop && typeof layout.desktop === 'object' && Array.isArray(layout.desktop.cards)) {
    return layout.desktop;
  }
  return null;
}

function prepareLayoutDefinition(candidate) {
  const layout = candidate && typeof candidate === 'object' ? { ...candidate } : {};
  const defaultById = new Map(DEFAULT_LAYOUT.cards.map(card => [card.id, card]));

  layout.columns = layout.columns || DEFAULT_LAYOUT.columns;
  layout.rows = layout.rows || DEFAULT_LAYOUT.rows;
  layout.gap = layout.gap || DEFAULT_LAYOUT.gap;

  if (layout.autoRows == null && DEFAULT_LAYOUT.autoRows != null) {
    layout.autoRows = DEFAULT_LAYOUT.autoRows;
  }
  if (layout.autoColumns == null && DEFAULT_LAYOUT.autoColumns != null) {
    layout.autoColumns = DEFAULT_LAYOUT.autoColumns;
  }

  const cards = Array.isArray(layout.cards) && layout.cards.length
    ? layout.cards.map(card => ({ ...card }))
    : DEFAULT_LAYOUT.cards.map(card => ({ ...card }));

  layout.cards = cards.map(card => {
    const normalized = { ...card };
    const fallback = defaultById.get(normalized.id);
    if (fallback) {
      if (normalized.row == null) normalized.row = fallback.row;
      if (normalized.column == null) normalized.column = fallback.column;
      if (normalized.rowSpan == null) normalized.rowSpan = fallback.rowSpan;
      if (normalized.colSpan == null) normalized.colSpan = fallback.colSpan;
      if (!normalized.title && fallback.title) normalized.title = fallback.title;
    }
    if (normalized.rowSpan == null) normalized.rowSpan = 1;
    if (normalized.colSpan == null) normalized.colSpan = 1;
    return normalized;
  });

  return layout;
}

function extractLayoutFromPayload(payload) {
  const metadataLayout = payload && payload.metadata && typeof payload.metadata === 'object'
    ? payload.metadata.layout
    : null;
  const candidate = selectLayoutCandidate(metadataLayout);
  return prepareLayoutDefinition(candidate);
}

function resolveRendererDimensions(payload, layout) {
  const layoutBaseWidth = coercePositiveDimension(layout && layout.baseWidth);
  const layoutBaseHeight = coercePositiveDimension(layout && layout.baseHeight);

  const metadataLayout = payload && payload.metadata && payload.metadata.layout
    ? payload.metadata.layout
    : {};

  const metadataBaseWidth = coercePositiveDimension(metadataLayout && metadataLayout.baseWidth);
  const metadataBaseHeight = coercePositiveDimension(metadataLayout && metadataLayout.baseHeight);

  const width = layoutBaseWidth ?? metadataBaseWidth ?? DEFAULT_RENDER_BASE_WIDTH;
  const height = layoutBaseHeight ?? metadataBaseHeight ?? DEFAULT_RENDER_BASE_HEIGHT;

  return {
    width,
    height
  };
}

module.exports = {
  DEFAULT_LAYOUT,
  DEFAULT_RENDER_BASE_HEIGHT,
  DEFAULT_RENDER_BASE_WIDTH,
  buildRendererData,
  extractLayoutFromPayload,
  prepareLayoutDefinition,
  resolveRendererDimensions
};
