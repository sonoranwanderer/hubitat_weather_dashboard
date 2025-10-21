'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

class FakeStyle {
  constructor() {
    this.store = Object.create(null);
  }

  setProperty(name, value) {
    this.store[name] = String(value);
  }

  removeProperty(name) {
    delete this.store[name];
  }

  getPropertyValue(name) {
    return this.store[name] || '';
  }

  clone() {
    const clone = new FakeStyle();
    for (const key of Object.keys(this.store)) {
      clone.store[key] = this.store[key];
    }
    return clone;
  }
}

['display', 'transform', 'width', 'height'].forEach(prop => {
  Object.defineProperty(FakeStyle.prototype, prop, {
    get() {
      return this.store[prop] || '';
    },
    set(value) {
      if (value == null) {
        delete this.store[prop];
      } else {
        this.store[prop] = String(value);
      }
    }
  });
});

class FakeClassList {
  constructor(element) {
    this.element = element;
    this._set = new Set();
  }

  add(...classes) {
    classes.filter(Boolean).forEach(cls => this._set.add(cls));
    this._sync();
  }

  remove(...classes) {
    classes.filter(Boolean).forEach(cls => this._set.delete(cls));
    this._sync();
  }

  contains(cls) {
    return this._set.has(cls);
  }

  toggle(cls, force) {
    if (force === undefined) {
      if (this.contains(cls)) {
        this.remove(cls);
        return false;
      }
      this.add(cls);
      return true;
    }
    if (force) {
      this.add(cls);
      return true;
    }
    this.remove(cls);
    return false;
  }

  toArray() {
    return Array.from(this._set);
  }

  _sync() {
    this.element.className = this.toArray().join(' ');
  }
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName || 'div').toUpperCase();
    this.ownerDocument = ownerDocument || null;
    this.children = [];
    this.parentElement = null;
    this.classList = new FakeClassList(this);
    this.dataset = {};
    this.style = new FakeStyle();
    this.attributes = new Map();
    this._textContent = '';
    this._innerHTML = '';
    this.className = '';
    this.ownerSVGElement = null;
  }

  appendChild(child) {
    if (!child) return child;
    if (child.parentElement) {
      child.parentElement.removeChild(child);
    }
    child.parentElement = this;
    child.ownerDocument = this.ownerDocument;
    if (this.tagName === 'SVG') {
      child.ownerSVGElement = this;
    }
    this.children.push(child);
    return child;
  }

  insertBefore(child, before) {
    if (!child) return child;
    if (!before) return this.appendChild(child);
    const index = this.children.indexOf(before);
    if (index === -1) return this.appendChild(child);
    if (child.parentElement) {
      child.parentElement.removeChild(child);
    }
    child.parentElement = this;
    child.ownerDocument = this.ownerDocument;
    if (this.tagName === 'SVG') {
      child.ownerSVGElement = this;
    }
    this.children.splice(index, 0, child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index !== -1) {
      this.children.splice(index, 1);
      child.parentElement = null;
    }
    return child;
  }

  replaceWith(replacement) {
    if (!this.parentElement) return;
    const parent = this.parentElement;
    const index = parent.children.indexOf(this);
    if (index === -1) return;
    parent.children.splice(index, 1, replacement);
    replacement.parentElement = parent;
    replacement.ownerDocument = parent.ownerDocument;
  }

  get textContent() {
    if (this.children.length) {
      return this.children.map(child => child.textContent).join('');
    }
    return this._textContent;
  }

  set textContent(value) {
    this._textContent = value == null ? '' : String(value);
    if (this.children.length) {
      this.children = [];
    }
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(value) {
    this._innerHTML = value == null ? '' : String(value);
    this.children = [];
  }

  setAttribute(name, value) {
    const normalized = String(value);
    this.attributes.set(name, normalized);
    if (name === 'id') {
      this.id = normalized;
      if (this.ownerDocument) {
        this.ownerDocument._registerId(normalized, this);
      }
    }
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  querySelector(selector) {
    const all = this.querySelectorAll(selector);
    return all.length ? all[0] : null;
  }

  querySelectorAll(selector) {
    const tokens = selector.trim().split(/\s+/).filter(Boolean);
    const results = [];
    const traverse = (element, index) => {
      if (!matchesSimple(element, tokens[index])) return;
      if (index === tokens.length - 1) {
        results.push(element);
        return;
      }
      element.children.forEach(child => descend(child, index + 1));
    };
    const descend = (element, index) => {
      traverse(element, index);
      element.children.forEach(child => descend(child, index));
    };
    this.children.forEach(child => descend(child, 0));
    return results;
  }

  cloneNode(deep = false) {
    const clone = new FakeElement(this.tagName, this.ownerDocument);
    this.classList.toArray().forEach(cls => clone.classList.add(cls));
    clone.dataset = { ...this.dataset };
    clone.style = this.style.clone();
    clone._textContent = this._textContent;
    clone._innerHTML = this._innerHTML;
    for (const [name, value] of this.attributes.entries()) {
      clone.attributes.set(name, value);
      if (name === 'id' && clone.ownerDocument) {
        clone.ownerDocument._registerId(value, clone);
      }
    }
    if (deep) {
      this.children.forEach(child => clone.appendChild(child.cloneNode(true)));
    }
    return clone;
  }

  get ownerDocument() {
    return this._ownerDocument;
  }

  set ownerDocument(doc) {
    this._ownerDocument = doc;
    if (Array.isArray(this.children)) {
      this.children.forEach(child => {
        child.ownerDocument = doc;
      });
    }
  }

  remove() {
    if (this.parentElement) {
      this.parentElement.removeChild(this);
    }
  }
}

class FakeDocument {
  constructor(window) {
    this.defaultView = window;
    this.readyState = 'complete';
    this.body = new FakeElement('body', this);
    this.head = new FakeElement('head', this);
    this._ids = new Map();
  }

  createElement(tagName) {
    return new FakeElement(tagName, this);
  }

  createElementNS(_ns, tagName) {
    return new FakeElement(tagName, this);
  }

  getElementById(id) {
    return this._ids.get(id) || null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const tokens = selector.trim().split(/\s+/).filter(Boolean);
    const results = [];
    const traverse = (element, index) => {
      if (!matchesSimple(element, tokens[index])) return;
      if (index === tokens.length - 1) {
        results.push(element);
        return;
      }
      element.children.forEach(child => descend(child, index + 1));
    };
    const descend = (element, index) => {
      traverse(element, index);
      element.children.forEach(child => descend(child, index));
    };
    descend(this.body, 0);
    descend(this.head, 0);
    return results;
  }

  addEventListener() {}

  removeEventListener() {}

  _registerId(id, element) {
    if (!id) return;
    this._ids.set(id, element);
  }
}

function matchesSimple(element, token) {
  if (!token) return false;
  let working = token;

  const attrMatch = working.match(/\[([^=]+)=['"]?([^'"\]]+)['"]?\]/);
  if (attrMatch) {
    const [, attr, value] = attrMatch;
    if ((element.attributes.get(attr) || element.dataset[attr] || '') !== value) {
      return false;
    }
    working = working.replace(attrMatch[0], '');
  }

  if (working.startsWith('#')) {
    return element.attributes.get('id') === working.slice(1);
  }

  const hashIndex = working.indexOf('#');
  if (hashIndex !== -1) {
    const idValue = working.slice(hashIndex + 1);
    working = working.slice(0, hashIndex);
    if (element.attributes.get('id') !== idValue) {
      return false;
    }
  }

  let tag = null;
  const dotIndex = working.indexOf('.');
  if (dotIndex > 0) {
    tag = working.slice(0, dotIndex);
    working = working.slice(dotIndex);
  } else if (dotIndex === -1 && working && !working.startsWith('.')) {
    tag = working;
    working = '';
  }

  if (tag && element.tagName.toLowerCase() !== tag.toLowerCase()) {
    return false;
  }

  if (working) {
    const classMatches = working.match(/\.([a-zA-Z0-9_-]+)/g) || [];
    for (const clsToken of classMatches) {
      const cls = clsToken.slice(1);
      if (!element.classList.contains(cls)) {
        return false;
      }
    }
  }

  return true;
}

function createElement(doc, tag, classes = []) {
  const el = doc.createElement(tag);
  classes.forEach(cls => el.classList.add(cls));
  return el;
}

function createSpan(doc, cls) {
  return createElement(doc, 'span', cls ? [cls] : []);
}

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
  gaugeCurrent.appendChild(createSpan(doc, 'wdash-gauge-value'));
  const lowWrap = createElement(doc, 'div', ['wdash-temp-extrema', 'wdash-temp-extrema--low']);
  lowWrap.appendChild(createSpan(doc, 'wdash-temp-extrema-label'));
  lowWrap.appendChild(createSpan(doc, 'wdash-temp-extrema-value'));
  gaugeCenter.appendChild(highWrap);
  gaugeCenter.appendChild(gaugeCurrent);
  gaugeCenter.appendChild(lowWrap);
  gauge.appendChild(gaugeCenter);
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

function formatTemperature(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}°` : '--°';
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
  const window = { __WDASH_TEST_MODE__: true, addEventListener: () => {}, removeEventListener: () => {} };
  const document = new FakeDocument(window);
  window.document = document;
  window.window = window;
  window.console = console;
  window.setTimeout = setTimeout;
  window.clearTimeout = clearTimeout;
  window.setInterval = setInterval;
  window.clearInterval = clearInterval;
  window.requestAnimationFrame = fn => setTimeout(fn, 16);
  window.cancelAnimationFrame = id => clearTimeout(id);
  window.Intl = Intl;

  global.__WDASH_TEST_MODE__ = true;
  global.__WDASH_TEST_HOOKS__ = {};
  global.window = window;
  global.document = document;
  global.console = console;
  global.Intl = Intl;

  const scriptPath = path.resolve(__dirname, '../dashboard/weather-dashboard.js');
  const code = fs.readFileSync(scriptPath, 'utf8');
  vm.runInThisContext(code, { filename: scriptPath });

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
  const gaugeValueEl = card.querySelector('.wdash-gauge-value');
  assertEqual(gaugeValueEl.textContent, formatTemperature(dataA.outdoor.temperatureF), 'gauge value mismatch after dataA');
  assertEqual(card.querySelector('.wdash-temp-extrema--high .wdash-temp-extrema-value').textContent, formatTemperature(dataA.outdoor.dailyHighF), 'high value mismatch after dataA');
  assertEqual(card.querySelector('.wdash-temp-extrema--low .wdash-temp-extrema-value').textContent, formatTemperature(dataA.outdoor.dailyLowF), 'low value mismatch after dataA');

  const detailValuesA = [
    formatTemperature(dataA.outdoor.feelsLikeF),
    formatTemperature(dataA.outdoor.dewPointF),
    formatPercent(dataA.outdoor.humidity, 0),
    formatSigned(dataA.outdoor.trendFPerHour, 1, '°/hr'),
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

  updateTempWindCard();
  assertEqual(card.querySelector('.wdash-gauge').style.getPropertyValue('--gauge-indicator'), gaugeIndicatorAfter, 'gauge indicator should remain stable on repeat update');

  console.log('Temp-wind card harness passed');
})();

