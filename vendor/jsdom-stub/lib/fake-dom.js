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

class FakeTextNode {
  constructor(text = '', ownerDocument = null) {
    this.nodeType = 3;
    this.parentElement = null;
    this._ownerDocument = ownerDocument;
    this._text = text == null ? '' : String(text);
  }

  get textContent() {
    return this._text;
  }

  set textContent(value) {
    this._text = value == null ? '' : String(value);
  }

  get ownerDocument() {
    return this._ownerDocument;
  }

  set ownerDocument(doc) {
    this._ownerDocument = doc;
  }

  cloneNode() {
    return new FakeTextNode(this._text, this._ownerDocument);
  }
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName || 'div').toUpperCase();
    this.ownerDocument = ownerDocument || null;
    this.childNodes = [];
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
    if ('ownerDocument' in child) {
      child.ownerDocument = this.ownerDocument;
    }
    if (child instanceof FakeElement && this.tagName === 'SVG') {
      child.ownerSVGElement = this;
    }
    this.childNodes.push(child);
    if (child instanceof FakeElement) {
      this.children.push(child);
    }
    this._innerHTML = null;
    if (!(child instanceof FakeElement)) {
      this._textContent = '';
    }
    return child;
  }

  insertBefore(child, before) {
    if (!child) return child;
    if (!before) return this.appendChild(child);
    const nodeIndex = this.childNodes.indexOf(before);
    if (nodeIndex === -1) return this.appendChild(child);
    if (child.parentElement) {
      child.parentElement.removeChild(child);
    }
    child.parentElement = this;
    if ('ownerDocument' in child) {
      child.ownerDocument = this.ownerDocument;
    }
    if (child instanceof FakeElement && this.tagName === 'SVG') {
      child.ownerSVGElement = this;
    }
    this.childNodes.splice(nodeIndex, 0, child);
    if (child instanceof FakeElement) {
      const beforeIndex = this.children.indexOf(before);
      if (beforeIndex === -1) {
        this.children.push(child);
      } else {
        this.children.splice(beforeIndex, 0, child);
      }
    }
    this._innerHTML = null;
    if (!(child instanceof FakeElement)) {
      this._textContent = '';
    }
    return child;
  }

  removeChild(child) {
    const nodeIndex = this.childNodes.indexOf(child);
    if (nodeIndex !== -1) {
      this.childNodes.splice(nodeIndex, 1);
    }
    const elementIndex = this.children.indexOf(child);
    if (elementIndex !== -1) {
      this.children.splice(elementIndex, 1);
    }
    child.parentElement = null;
    this._innerHTML = null;
    return child;
  }

  replaceWith(replacement) {
    if (!this.parentElement) return;
    const parent = this.parentElement;
    const nodeIndex = parent.childNodes.indexOf(this);
    if (nodeIndex === -1) return;
    if (replacement.parentElement) {
      replacement.parentElement.removeChild(replacement);
    }
    parent.childNodes.splice(nodeIndex, 1, replacement);
    const elementIndex = parent.children.indexOf(this);
    if (elementIndex !== -1) {
      if (replacement instanceof FakeElement) {
        parent.children.splice(elementIndex, 1, replacement);
      } else {
        parent.children.splice(elementIndex, 1);
      }
    } else if (replacement instanceof FakeElement) {
      parent.children.push(replacement);
    }
    replacement.parentElement = parent;
    if ('ownerDocument' in replacement) {
      replacement.ownerDocument = parent.ownerDocument;
    }
    if (replacement instanceof FakeElement && parent.tagName === 'SVG') {
      replacement.ownerSVGElement = parent;
    }
    parent._innerHTML = null;
  }

  get textContent() {
    if (this.childNodes.length) {
      return this.childNodes.map(child => child.textContent).join('');
    }
    return this._textContent;
  }

  set textContent(value) {
    const normalized = value == null ? '' : String(value);
    this._textContent = '';
    this.childNodes = [];
    this.children = [];
    this._innerHTML = null;
    if (normalized) {
      this.appendChild(new FakeTextNode(normalized, this.ownerDocument));
    }
  }

  get innerHTML() {
    if (this._innerHTML != null) {
      return this._innerHTML;
    }
    if (!this.childNodes.length) {
      return '';
    }
    return this.childNodes.map(node => serializeNode(node)).join('');
  }

  set innerHTML(value) {
    const markup = value == null ? '' : String(value);
    this._innerHTML = markup;
    this.childNodes = [];
    this.children = [];
    this._textContent = '';
    if (!markup) {
      return;
    }

    const voidTags = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'track', 'area', 'base', 'col', 'embed', 'param', 'wbr']);
    const tokenPattern = /<!--[^]*?-->|<[^>]+>|[^<]+/g;
    const stack = [this];
    let match;
    while ((match = tokenPattern.exec(markup))) {
      const token = match[0];
      const current = stack[stack.length - 1];
      if (!current) {
        continue;
      }
      if (token.startsWith('<!--')) {
        continue;
      }
      if (token.startsWith('</')) {
        if (stack.length > 1) {
          stack.pop();
        }
        continue;
      }
      if (token.startsWith('<')) {
        const openMatch = token.match(/^<\s*([^\s\/>]+)([\s\S]*)>$/);
        if (!openMatch) {
          continue;
        }
        const tagName = openMatch[1].toLowerCase();
        const attrText = openMatch[2] || '';
        const element = new FakeElement(tagName, this.ownerDocument);

        const attrRegex = /([^\s=\/>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g;
        let attrMatch;
        while ((attrMatch = attrRegex.exec(attrText))) {
          let name = attrMatch[1];
          if (!name || name === '/') continue;
          let rawValue = attrMatch[2];
          if (rawValue == null) {
            rawValue = '';
          } else {
            rawValue = rawValue.trim();
            if ((rawValue.startsWith('"') && rawValue.endsWith('"')) || (rawValue.startsWith("'") && rawValue.endsWith("'"))) {
              rawValue = rawValue.slice(1, -1);
            }
          }
          const value = rawValue;
          if (name === 'class') {
            element.className = value;
            value.split(/\s+/).filter(Boolean).forEach(cls => element.classList.add(cls));
            element.attributes.set('class', value);
            continue;
          }
          if (name === 'id') {
            element.setAttribute(name, value);
            continue;
          }
          if (name.startsWith('data-')) {
            const dataKey = name
              .slice(5)
              .replace(/-([a-z])/g, (_, char) => char.toUpperCase());
            element.dataset[dataKey] = value;
            element.attributes.set(name, value);
            continue;
          }
          element.setAttribute(name, value);
        }

        current.appendChild(element);
        const selfClosing = /\/>\s*$/.test(attrText) || voidTags.has(tagName);
        if (!selfClosing) {
          stack.push(element);
        }
        continue;
      }

      const text = token;
      if (!text) continue;
      const textNode = new FakeTextNode(text, this.ownerDocument);
      current.appendChild(textNode);
    }
    this._innerHTML = markup;
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
      this.childNodes.forEach(child => clone.appendChild(child.cloneNode(true)));
    }
    return clone;
  }

  get ownerDocument() {
    return this._ownerDocument;
  }

  set ownerDocument(doc) {
    this._ownerDocument = doc;
    if (Array.isArray(this.childNodes)) {
      this.childNodes.forEach(child => {
        if ('ownerDocument' in child) {
          child.ownerDocument = doc;
        }
      });
    }
  }

  remove() {
    if (this.parentElement) {
      this.parentElement.removeChild(this);
    }
  }

  addEventListener() {}

  removeEventListener() {}

  closest(selector) {
    let current = this;
    while (current) {
      if (matchesSimple(current, selector)) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
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
    this.documentElement = new FakeElement('html', this);
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
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
  const nativeSetTimeout = setTimeout;
  const nativeClearTimeout = clearTimeout;
  const clampDelay = value => {
    if (!Number.isFinite(value) || value < 0) return 0;
    return Math.min(value, 50);
  };
  window.setTimeout = function setTimeoutStub(fn, delay) {
    if (typeof fn !== 'function') {
      return 0;
    }
    const ms = clampDelay(delay);
    return nativeSetTimeout(() => {
      let thrownError = null;
      try {
        fn();
      } catch (err) {
        thrownError = err;
      }
      if (thrownError) {
        throw thrownError;
      }
    }, ms);
  };
  window.clearTimeout = function clearTimeoutStub(handle) {
    if (handle != null) {
      nativeClearTimeout(handle);
    }
  };
  window.setInterval = (fn, delay) => window.setTimeout(fn, delay);
  window.clearInterval = handle => window.clearTimeout(handle);
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
  window.getComputedStyle = element => {
    const target = element && element.style && element.style.store ? element.style.store : {};
    return {
      getPropertyValue(name) {
        return Object.prototype.hasOwnProperty.call(target, name) ? target[name] : '';
      }
    };
  };

  global.__WDASH_TEST_MODE__ = true;
  global.__WDASH_TEST_HOOKS__ = {};
  global.window = window;
  global.document = document;
  global.console = console;
  global.Intl = Intl;
  global.MutationObserver = window.MutationObserver;
  global.ResizeObserver = window.ResizeObserver;
  global.matchMedia = window.matchMedia;
  global.getComputedStyle = window.getComputedStyle;

  if (!document.documentElement) {
    document.documentElement = new FakeElement('html', document);
    document.documentElement.appendChild(document.head);
    document.documentElement.appendChild(document.body);
  }

  return { window, document };
}

function loadWeatherDashboard(window, options = {}) {
  const rootDir = path.resolve(__dirname, '..', '..', '..');
  const rendererPath = path.join(rootDir, 'src', 'render', 'index.js');
  const preferScript = options.forceScript === true || process.env.WDASH_FORCE_SCRIPT === '1';
  const explicitScriptPath = options.scriptPath || process.env.WDASH_SCRIPT_PATH;

  if (!preferScript && !explicitScriptPath && fs.existsSync(rendererPath)) {
    try {
      const {
        createRenderer,
        createLegacyWeatherDashboardRenderer
      } = require(rendererPath);
      const factory = typeof createRenderer === 'function'
        ? createRenderer
        : (typeof createLegacyWeatherDashboardRenderer === 'function' ? createLegacyWeatherDashboardRenderer : null);
      if (factory) {
        factory({ window, document: window.document, globalThis: window });
        return window.__WDASH_TEST_HOOKS__;
      }
    } catch (err) {
      if (process.env.WDASH_DEBUG_LOAD === '1') {
        // eslint-disable-next-line no-console
        console.warn('[WeatherDashboard] Unable to require renderer module, falling back to script', err);
      }
    }
  }

  if (explicitScriptPath) {
    const code = fs.readFileSync(explicitScriptPath, 'utf8');
    vm.runInThisContext(code, { filename: explicitScriptPath });
    return window.__WDASH_TEST_HOOKS__;
  }

  const scriptPath = path.join(rootDir, 'dashboard', 'weather-dashboard.js');

  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Weather dashboard script not found at ${scriptPath}`);
  }

  const code = fs.readFileSync(scriptPath, 'utf8');
  vm.runInThisContext(code, { filename: scriptPath });
  return window.__WDASH_TEST_HOOKS__;
}

function initializeDocumentFromHtml(document, html) {
  if (!document || typeof html !== 'string') {
    return;
  }

  const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const headContent = headMatch ? headMatch[1] : '';
  const bodyContent = bodyMatch ? bodyMatch[1] : html;

  document.head.innerHTML = headContent;
  document.body.innerHTML = bodyContent;
}

function serializeNode(node) {
  if (!node) {
    return '';
  }
  if (node instanceof FakeTextNode || node.nodeType === 3) {
    return escapeHtml(node.textContent);
  }
  return serializeElement(node);
}

function serializeElement(element) {
  if (!element) return '';
  const tag = element.tagName ? element.tagName.toLowerCase() : 'div';

  const attrs = [];
  if (element.attributes && element.attributes.size) {
    for (const [name, value] of element.attributes.entries()) {
      if (name === 'class' && element.className) continue;
      attrs.push(`${name}="${escapeHtml(String(value))}"`);
    }
  }

  if (element.className) {
    attrs.push(`class="${escapeHtml(element.className)}"`);
  }

  if (element.dataset) {
    for (const key of Object.keys(element.dataset)) {
      const attrName = `data-${key.replace(/[A-Z]/g, char => `-${char.toLowerCase()}`)}`;
      if (!attrs.some(entry => entry.startsWith(`${attrName}=`))) {
        attrs.push(`${attrName}="${escapeHtml(String(element.dataset[key]))}"`);
      }
    }
  }

  if (element.style && element.style.store) {
    const styleEntries = Object.keys(element.style.store).map(name => `${name}: ${element.style.store[name]}`);
    if (styleEntries.length) {
      attrs.push(`style="${escapeHtml(styleEntries.join('; '))}"`);
    }
  }

  const attrText = attrs.length ? ` ${attrs.join(' ')}` : '';

  let content = '';
  if (element._innerHTML != null) {
    content = element._innerHTML;
  } else if (element.childNodes && element.childNodes.length) {
    content = element.childNodes.map(child => serializeNode(child)).join('');
  } else if (element._textContent) {
    content = escapeHtml(element._textContent);
  }

  return `<${tag}${attrText}>${content}</${tag}>`;
}

function serializeDocument(document) {
  if (!document) {
    return '';
  }

  const headHtml = serializeElement(document.head);
  const bodyHtml = serializeElement(document.body);

  let htmlAttrText = '';
  if (document.documentElement) {
    const htmlAttrs = [];
    if (document.documentElement.attributes && document.documentElement.attributes.size) {
      for (const [name, value] of document.documentElement.attributes.entries()) {
        if (name === 'class' && document.documentElement.className) continue;
        htmlAttrs.push(`${name}="${escapeHtml(String(value))}"`);
      }
    }

    if (document.documentElement.className) {
      htmlAttrs.push(`class="${escapeHtml(document.documentElement.className)}"`);
    }

    if (document.documentElement.dataset) {
      for (const key of Object.keys(document.documentElement.dataset)) {
        const attrName = `data-${key.replace(/[A-Z]/g, char => `-${char.toLowerCase()}`)}`;
        if (!htmlAttrs.some(entry => entry.startsWith(`${attrName}=`))) {
          htmlAttrs.push(`${attrName}="${escapeHtml(String(document.documentElement.dataset[key]))}"`);
        }
      }
    }

    if (document.documentElement.style && document.documentElement.style.store) {
      const styleEntries = Object.keys(document.documentElement.style.store)
        .map(name => `${name}: ${document.documentElement.style.store[name]}`);
      if (styleEntries.length) {
        htmlAttrs.push(`style="${escapeHtml(styleEntries.join('; '))}"`);
      }
    }

    htmlAttrText = htmlAttrs.length ? ` ${htmlAttrs.join(' ')}` : '';
  }

  return `<!DOCTYPE html><html${htmlAttrText}>${headHtml}${bodyHtml}</html>`;
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
  FakeStyle,
  FakeClassList,
  FakeTextNode,
  FakeElement,
  FakeDocument,
  createElement,
  createSpan,
  createTestEnvironment,
  loadWeatherDashboard,
  initializeDocumentFromHtml,
  serializeDocument
};
