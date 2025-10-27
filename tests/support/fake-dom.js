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
    this._rect = { top: 0, left: 0, width: 0, height: 0 };
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
    clone._rect = { ...this._rect };
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

  setBoundingClientRect(rect) {
    if (!rect || typeof rect !== 'object') return;
    const width = Number(rect.width);
    const height = Number(rect.height);
    const top = Number(rect.top);
    const left = Number(rect.left);
    this._rect = {
      width: Number.isFinite(width) ? width : this._rect.width,
      height: Number.isFinite(height) ? height : this._rect.height,
      top: Number.isFinite(top) ? top : this._rect.top,
      left: Number.isFinite(left) ? left : this._rect.left
    };
  }

  getBoundingClientRect() {
    const { top, left, width, height } = this._rect;
    return {
      top,
      left,
      width,
      height,
      right: left + width,
      bottom: top + height
    };
  }

  get clientWidth() {
    return this._rect.width;
  }

  get clientHeight() {
    return this._rect.height;
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

  const attrMatch = working.match(/\[([^=^]+)(\^?=)['"]?([^'"\]]+)['"]?\]/);
  if (attrMatch) {
    const [, attr, operator, value] = attrMatch;
    const actual = element.attributes.get(attr) || element.dataset[attr] || '';
    if (operator === '^=') {
      if (!String(actual).startsWith(value)) {
        return false;
      }
    } else if (actual !== value) {
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

function createTestEnvironment() {
  const window = {
    __WDASH_TEST_MODE__: true,
    addEventListener: () => {},
    removeEventListener: () => {}
  };
  const document = new FakeDocument(window);
  window.document = document;
  window.window = window;
  window.console = console;
  window.setTimeout = setTimeout;
  window.clearTimeout = clearTimeout;
  window.setInterval = () => 0;
  window.clearInterval = () => {};
  window.requestAnimationFrame = fn => setTimeout(fn, 16);
  window.cancelAnimationFrame = id => clearTimeout(id);
  window.Intl = Intl;
  window.MutationObserver = class {
    constructor(callback) {
      this.callback = callback;
    }
    observe() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
  window.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback;
    }
    observe() {}
    disconnect() {}
    unobserve() {}
  };
  window.matchMedia = () => ({
    matches: false,
    media: '',
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() {
      return false;
    }
  });

  global.__WDASH_TEST_MODE__ = true;
  global.__WDASH_TEST_HOOKS__ = {};
  global.window = window;
  global.document = document;
  global.console = console;
  global.Intl = Intl;
  global.MutationObserver = window.MutationObserver;
  global.ResizeObserver = window.ResizeObserver;
  global.matchMedia = window.matchMedia;

  return { window, document };
}

function loadWeatherDashboard(window, options = {}) {
  const rootDir = path.resolve(__dirname, '..', '..');
  if (options.scriptPath) {
    const code = fs.readFileSync(options.scriptPath, 'utf8');
    vm.runInThisContext(code, { filename: options.scriptPath });
    return window.__WDASH_TEST_HOOKS__;
  }

  const variant = String(options.variant || process.env.WDASH_VARIANT || 'legacy').toLowerCase();
  const defaultPath = variant === 'v2'
    ? path.join(rootDir, 'v2', 'dashboard', 'weather-dashboard.js')
    : path.join(rootDir, 'dashboard', 'weather-dashboard.js');

  let scriptPath = defaultPath;

  if (!fs.existsSync(scriptPath)) {
    const fallbackPath = path.join(rootDir, 'dashboard', 'weather-dashboard.js');
    if (fallbackPath !== scriptPath && fs.existsSync(fallbackPath)) {
      scriptPath = fallbackPath;
    } else {
      throw new Error(`Weather dashboard script not found at ${scriptPath}`);
    }
  }

  const code = fs.readFileSync(scriptPath, 'utf8');
  vm.runInThisContext(code, { filename: scriptPath });
  return window.__WDASH_TEST_HOOKS__;
}

module.exports = {
  FakeStyle,
  FakeClassList,
  FakeElement,
  FakeDocument,
  createElement,
  createSpan,
  createTestEnvironment,
  loadWeatherDashboard
};
