'use strict';

const {
  normalizeLayoutDefinition,
  buildGridVariables,
  renderDashboardMarkup
} = require('./layout');

const baseStyles = `
:root {
  color-scheme: dark;
}

.wdash-source-tile {
  opacity: 0 !important;
  pointer-events: none !important;
}

.wdash-root {
  display: flex;
  flex-direction: column;
  width: var(--wdash-width);
  height: var(--wdash-height);
  max-width: 100%;
  max-height: 100%;
  background: var(--wdash-surface, radial-gradient(circle at top left, #16213f, #0b0f1f));
  border-radius: 18px;
  padding: var(--wdash-padding, 16px);
  box-sizing: border-box;
  box-shadow: var(--wdash-shadow, 0 16px 32px rgba(0, 0, 0, 0.35));
}

.wdash-grid {
  display: grid;
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
  gap: var(--wdash-grid-gap, 16px);
  grid-template-columns: var(--wdash-grid-template-columns, 1fr);
  grid-template-rows: var(--wdash-grid-template-rows, auto);
  grid-auto-rows: var(--wdash-grid-auto-rows, minmax(min-content, auto));
  grid-auto-columns: var(--wdash-grid-auto-columns, minmax(0, 1fr));
  align-content: stretch;
  align-items: stretch;
}

.wdash-card {
  display: flex;
  flex-direction: column;
  background: var(--wdash-card-surface, rgba(12, 17, 30, 0.92));
  color: var(--wdash-card-foreground, #f4f6ff);
  border-radius: 16px;
  padding: 16px;
  min-width: 0;
  box-shadow: var(--wdash-card-shadow, 0 12px 24px rgba(0, 0, 0, 0.25));
  border: 1px solid rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(8px);
  gap: 8px;
}

.wdash-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.wdash-card__title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.wdash-card__body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1 1 auto;
}

.wdash-card__metric {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  font-size: 0.95rem;
}

.wdash-card__metric-label {
  font-weight: 600;
  opacity: 0.75;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.wdash-card__metric-value {
  font-weight: 700;
  font-size: 1rem;
}

.wdash-card__metric-hint {
  margin-left: 6px;
  font-size: 0.75rem;
  opacity: 0.7;
}

.wdash-card__value {
  font-size: 1.6rem;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.wdash-card__content {
  font-size: 0.95rem;
  line-height: 1.4;
}

.wdash-card__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.wdash-card__list-item {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 0.9rem;
}

.wdash-card__list-value {
  font-weight: 600;
}

.wdash-card__empty {
  font-size: 0.85rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  opacity: 0.6;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 80px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
}
`;

function createRenderer({ width, height, layout, data } = {}) {
  const normalizedLayout = normalizeLayoutDefinition(layout);
  const variables = buildGridVariables({ width, height, layout: normalizedLayout });
  const markup = renderDashboardMarkup({ layout: normalizedLayout, data });

  return {
    markup,
    variables,
    styles: baseStyles
  };
}

function createLegacyWeatherDashboardRenderer() {
  throw new Error(
    'createLegacyWeatherDashboardRenderer has been removed. Use createRenderer({ width, height, layout, data }) instead.'
  );
}

module.exports = {
  createRenderer,
  baseStyles,
  createLegacyWeatherDashboardRenderer
};
