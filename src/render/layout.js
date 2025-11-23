'use strict';

function normalizeLayoutDefinition(input = {}) {
  const layout = typeof input === 'object' && input !== null ? input : {};

  const trackUnit = normalizeTrackUnit(layout.trackUnit);

  const templateColumns = createTrackTemplate(layout.columns, {
    fallback: '1fr',
    axis: 'columns',
    trackUnit
  });
  const templateRows = createTrackTemplate(layout.rows, {
    fallback: 'auto',
    axis: 'rows',
    trackUnit
  });

  const autoRows = layout.autoRows != null
    ? normalizeTrack(layout.autoRows, { axis: 'rows', allowAuto: true, trackUnit })
    : 'minmax(min-content, auto)';

  const autoColumns = layout.autoColumns != null
    ? normalizeTrack(layout.autoColumns, { axis: 'columns', allowAuto: true, trackUnit })
    : 'minmax(0, 1fr)';

  const gap = normalizeGap(layout.gap);

  const cards = Array.isArray(layout.cards)
    ? layout.cards.map(normalizeCardDefinition)
    : [];

  return {
    templateColumns,
    templateRows,
    autoRows,
    autoColumns,
    gap,
    cards
  };
}

function createTrackTemplate(tracks, options = {}) {
  const { fallback = 'auto', axis = 'rows', trackUnit = 'fraction' } = options;

  if (typeof tracks === 'string' && tracks.trim().length > 0) {
    return tracks.trim();
  }

  if (Array.isArray(tracks) && tracks.length > 0) {
    return tracks
      .map(track => normalizeTrack(track, { axis, allowAuto: true, trackUnit }))
      .join(' ');
  }

  if (tracks != null) {
    return normalizeTrack(tracks, { axis, allowAuto: true, trackUnit });
  }

  return fallback;
}

function normalizeTrack(value, options = {}) {
  const { axis = 'rows', allowAuto = false, trackUnit = 'fraction' } = options;

  if (value == null || value === '') {
    return allowAuto ? 'auto' : '1fr';
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return allowAuto ? 'auto' : '1fr';
    return trackUnit === 'percent' ? `${value}%` : `${value}fr`;
  }

  const stringValue = String(value).trim();
  if (stringValue.length === 0) {
    return allowAuto ? 'auto' : '1fr';
  }

  if (/^\d+(?:\.\d+)?$/.test(stringValue)) {
    return trackUnit === 'percent' ? `${stringValue}%` : `${stringValue}fr`;
  }

  if (stringValue === 'auto' && allowAuto) {
    return 'auto';
  }

  if (/^minmax\(/i.test(stringValue) || /^clamp\(/i.test(stringValue) || /^repeat\(/i.test(stringValue)) {
    return stringValue;
  }

  if (/fr$/.test(stringValue)) {
    return stringValue;
  }

  if (/%$/.test(stringValue)) {
    return stringValue;
  }

  if (/px$|rem$|em$|vh$|vw$/.test(stringValue)) {
    return stringValue;
  }

  throw new Error(`Unsupported track definition "${stringValue}" for ${axis}`);
}

function normalizeTrackUnit(value) {
  const token = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (token === 'percent' || token === 'percentage') return 'percent';
  return 'fraction';
}

function normalizeGap(value) {
  if (value == null || value === '') {
    return '16px';
  }

  if (typeof value === 'number') {
    return `${value}px`;
  }

  const stringValue = String(value).trim();
  if (stringValue.length === 0) {
    return '16px';
  }

  if (/px$|rem$|em$|vh$|vw$|%$/.test(stringValue)) {
    return stringValue;
  }

  if (/^\d+(?:\.\d+)?$/.test(stringValue)) {
    return `${stringValue}px`;
  }

  return stringValue;
}

function normalizeCardDefinition(card) {
  if (!card || typeof card !== 'object') {
    throw new Error('Card definitions must be objects.');
  }

  const id = card.id != null ? String(card.id).trim() : '';
  if (!id) {
    throw new Error('Card definitions require an "id" property.');
  }

  const row = toPositiveInteger(card.row, 1, 'row');
  const column = toPositiveInteger(card.column, 1, 'column');
  const rowSpan = toPositiveInteger(card.rowSpan, 1, 'rowSpan');
  const colSpan = toPositiveInteger(card.colSpan, 1, 'colSpan');

  const className = card.class ? String(card.class).trim() : '';
  const minWidth = card.minWidth != null ? normalizeCssDimension(card.minWidth) : null;
  const minHeight = card.minHeight != null ? normalizeCssDimension(card.minHeight) : null;

  const style = Object.assign({}, typeof card.style === 'object' && card.style ? card.style : {});
  if (minWidth) style['min-width'] = minWidth;
  if (minHeight) style['min-height'] = minHeight;

  return {
    id,
    title: card.title != null ? String(card.title) : null,
    row,
    column,
    rowSpan,
    colSpan,
    className,
    style
  };
}

function toPositiveInteger(value, fallback, name) {
  const number = Number(value);
  if (Number.isInteger(number) && number > 0) {
    return number;
  }
  if (fallback != null) {
    return fallback;
  }
  throw new Error(`${name} must be a positive integer.`);
}

function normalizeCssDimension(value) {
  if (value == null || value === '') {
    return null;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return `${value}px`;
  }

  const stringValue = String(value).trim();
  if (stringValue.length === 0) {
    return null;
  }

  if (/px$|rem$|em$|vh$|vw$|%$/.test(stringValue)) {
    return stringValue;
  }

  if (/^\d+(?:\.\d+)?$/.test(stringValue)) {
    return `${stringValue}px`;
  }

  return stringValue;
}

function buildGridVariables({ width, height, layout }) {
  if (!layout) throw new Error('Layout is required to build grid variables.');
  const widthValue = normalizeCssDimension(width);
  const heightValue = normalizeCssDimension(height);

  if (!widthValue) {
    throw new Error('createRenderer requires a finite width.');
  }
  if (!heightValue) {
    throw new Error('createRenderer requires a finite height.');
  }

  return {
    '--wdash-width': widthValue,
    '--wdash-height': heightValue,
    '--wdash-grid-template-columns': layout.templateColumns,
    '--wdash-grid-template-rows': layout.templateRows,
    '--wdash-grid-gap': layout.gap,
    '--wdash-grid-auto-rows': layout.autoRows,
    '--wdash-grid-auto-columns': layout.autoColumns
  };
}

function renderDashboardMarkup({ layout, data }) {
  const cardsMarkup = layout.cards
    .map(card => renderCardMarkup({ card, data }))
    .join('');

  return [
    '<div class="wdash-root" data-dashboard-root="true">',
    '  <div class="wdash-grid">',
    cardsMarkup,
    '  </div>',
    '</div>'
  ].join('');
}

function renderCardMarkup({ card, data }) {
  const cardData = resolveCardData(data, card.id);
  const title = card.title || (cardData && cardData.title) || formatCardTitle(card.id);

  const classNames = ['wdash-card', `wdash-card--${card.id}`];
  if (card.className) {
    classNames.push(card.className);
  }

  const styleSegments = [
    `grid-column:${card.column} / span ${card.colSpan}`,
    `grid-row:${card.row} / span ${card.rowSpan}`
  ];

  Object.entries(card.style).forEach(([key, value]) => {
    styleSegments.push(`${kebabCase(key)}:${String(value)}`);
  });

  const bodyMarkup = renderCardBody(cardData);

  return [
    `    <article class="${classNames.join(' ')}" data-card="${escapeHtml(card.id)}" style="${styleSegments.join(';')}">`,
    '      <header class="wdash-card__header">',
    `        <h2 class="wdash-card__title">${escapeHtml(title)}</h2>`,
    '      </header>',
    `      <div class="wdash-card__body">${bodyMarkup}</div>`,
    '    </article>'
  ].join('');
}

function renderCardBody(cardData) {
  if (cardData == null || (typeof cardData === 'object' && !Array.isArray(cardData) && Object.keys(cardData).length === 0)) {
    return '<div class="wdash-card__empty" data-state="empty">No data available</div>';
  }

  if (Array.isArray(cardData)) {
    return `<ul class="wdash-card__list">${cardData.map(renderListItem).join('')}</ul>`;
  }

  if (typeof cardData === 'string' || typeof cardData === 'number' || typeof cardData === 'boolean') {
    return `<div class="wdash-card__value">${escapeHtml(String(cardData))}</div>`;
  }

  if (cardData && typeof cardData === 'object') {
    if (Array.isArray(cardData.metrics)) {
      return cardData.metrics.map(renderMetric).join('');
    }

    if (cardData.content != null) {
      return `<div class="wdash-card__content">${escapeHtml(String(cardData.content))}</div>`;
    }

    const keys = Object.keys(cardData).filter(key => key !== 'title');
    if (keys.length === 0) {
      return '<div class="wdash-card__empty" data-state="empty">No data available</div>';
    }

    if (Object.prototype.hasOwnProperty.call(cardData, 'value')) {
      const allowed = new Set(['title', 'value', 'label', 'hint']);
      const onlyValueMetric = keys.every(key => allowed.has(key));
      if (onlyValueMetric) {
        return renderMetric({
          label: cardData.label,
          value: cardData.value,
          hint: cardData.hint
        });
      }
    }

    return keys.map(key => renderMetric({ label: key, value: cardData[key] })).join('');
  }

  return '<div class="wdash-card__empty" data-state="empty">No data available</div>';
}

function renderListItem(entry) {
  if (entry && typeof entry === 'object') {
    if (entry.value != null) {
      const label = entry.label != null ? String(entry.label) : '';
      return `      <li class="wdash-card__list-item">${escapeHtml(label)}<span class="wdash-card__list-value">${escapeHtml(String(entry.value))}</span></li>`;
    }
    return `      <li class="wdash-card__list-item">${escapeHtml(JSON.stringify(entry))}</li>`;
  }
  return `      <li class="wdash-card__list-item">${escapeHtml(String(entry))}</li>`;
}

function renderMetric(metric) {
  if (metric == null) {
    return '';
  }

  if (typeof metric !== 'object') {
    return [
      '        <div class="wdash-card__metric">',
      `          <span class="wdash-card__metric-label"></span>`,
      `          <span class="wdash-card__metric-value">${escapeHtml(String(metric))}</span>`,
      '        </div>'
    ].join('');
  }

  const label = metric.label != null ? escapeHtml(String(metric.label)) : '';
  let value = '';
  if (metric.value != null) {
    value = typeof metric.value === 'object'
      ? escapeHtml(JSON.stringify(metric.value))
      : escapeHtml(String(metric.value));
  }
  const hint = metric.hint != null ? `<span class="wdash-card__metric-hint">${escapeHtml(String(metric.hint))}</span>` : '';

  return [
    '        <div class="wdash-card__metric">',
    `          <span class="wdash-card__metric-label">${label}</span>`,
    `          <span class="wdash-card__metric-value">${value}${hint}</span>`,
    '        </div>'
  ].join('');
}

function resolveCardData(data, id) {
  if (!data) return null;
  if (data.cards && Object.prototype.hasOwnProperty.call(data.cards, id)) {
    return data.cards[id];
  }
  if (Object.prototype.hasOwnProperty.call(data, id)) {
    return data[id];
  }
  return null;
}

function formatCardTitle(id) {
  return String(id)
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, match => match.toUpperCase());
}

function kebabCase(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = {
  normalizeLayoutDefinition,
  buildGridVariables,
  renderDashboardMarkup,
  escapeHtml
};
