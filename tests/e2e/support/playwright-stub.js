'use strict';

const fs = require('fs');
const path = require('path');

const jsdomModulePath = path.resolve(__dirname, '../../../node_modules/jsdom');
const jsdomStubPath = path.resolve(__dirname, '../../../vendor/jsdom-stub');
const { JSDOM } = require(fs.existsSync(jsdomModulePath) ? jsdomModulePath : jsdomStubPath);

function createRunner() {
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  function expect(actual) {
    return new Expectation(actual);
  }

  class Expectation {
    constructor(actual) {
      this.actual = actual;
    }

    toBe(expected) {
      if (this.actual !== expected) {
        throw new Error(`Expected ${formatValue(this.actual)} to be ${formatValue(expected)}`);
      }
    }

    toEqual(expected) {
      if (!deepEqual(this.actual, expected)) {
        throw new Error(`Expected ${formatValue(this.actual)} to equal ${formatValue(expected)}`);
      }
    }

    toContain(expected) {
      if (typeof this.actual === 'string') {
        if (!this.actual.includes(expected)) {
          throw new Error(`Expected string ${formatValue(this.actual)} to contain ${formatValue(expected)}`);
        }
        return;
      }
      if (Array.isArray(this.actual)) {
        if (!this.actual.includes(expected)) {
          throw new Error(`Expected array ${formatValue(this.actual)} to contain ${formatValue(expected)}`);
        }
        return;
      }
      throw new Error('toContain expects a string or array actual value');
    }

    toBeGreaterThan(expected) {
      if (!(this.actual > expected)) {
        throw new Error(`Expected ${formatValue(this.actual)} to be greater than ${formatValue(expected)}`);
      }
    }

    toBeGreaterThanOrEqual(expected) {
      if (!(this.actual >= expected)) {
        throw new Error(`Expected ${formatValue(this.actual)} to be ≥ ${formatValue(expected)}`);
      }
    }

    toBeLessThanOrEqual(expected) {
      if (!(this.actual <= expected)) {
        throw new Error(`Expected ${formatValue(this.actual)} to be ≤ ${formatValue(expected)}`);
      }
    }
  }

  class FakeBrowser {
    constructor() {
      this.pages = [];
    }

    async newPage() {
      const page = new FakePage();
      this.pages.push(page);
      return page;
    }

    async close() {
      await Promise.all(this.pages.map(page => page.close()));
      this.pages = [];
    }
  }

  class FakePage {
    constructor() {
      this.dom = null;
      this.window = null;
      this.fetchQueue = [];
      this.lastFetchHandler = null;
    }

    async goto(url) {
      await this._createDom(url || 'http://localhost/');
    }

    async _createDom(url) {
      if (this.dom) {
        try {
          this.dom.window.close();
        } catch (err) {
          // ignore close errors
        }
      }
      this.dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
        url,
        pretendToBeVisual: true,
        runScripts: 'dangerously',
        resources: 'usable'
      });
      this.window = this.dom.window;
      this.window.console = global.console;
      installShims(this.window);
      this.window.addEventListener('error', event => {
        const message = event && event.message ? event.message : 'Unknown script error';
        console.error('[playwright-stub] window error:', message);
      });
      const locationUrl = (() => {
        try {
          return new URL(url || 'http://localhost/');
        } catch (err) {
          return new URL('http://localhost/');
        }
      })();
      if (this.window.location) {
        const loc = this.window.location;
        if (typeof loc.href === 'undefined') {
          Object.defineProperty(loc, 'href', {
            configurable: true,
            enumerable: true,
            get() {
              return locationUrl.href;
            }
          });
        }
        if (typeof loc.origin === 'undefined') {
          Object.defineProperty(loc, 'origin', {
            configurable: true,
            enumerable: true,
            get() {
              return locationUrl.origin;
            }
          });
        }
        if (typeof loc.search === 'undefined') {
          Object.defineProperty(loc, 'search', {
            configurable: true,
            enumerable: true,
            get() {
              return locationUrl.search;
            }
          });
        }
      }
      this.fetchQueue = [];
      this.lastFetchHandler = null;
      this.window.fetch = this._fetch.bind(this);
    }

    _fetch(url, options) {
      const handler = this.fetchQueue.length ? this.fetchQueue.shift() : this.lastFetchHandler;
      if (!handler) {
        return Promise.reject(new Error(`No mock fetch handler queued for ${url}`));
      }
      this.lastFetchHandler = handler;
      const result = typeof handler === 'function' ? handler(url, options) : handler;
      return Promise.resolve(result).then(createMockResponse);
    }

    queueResponse(response) {
      this.fetchQueue.push(response);
    }

    async setContent(html) {
      if (!this.window) {
        await this.goto('http://localhost/');
      }
      this.window.document.open();
      this.window.document.write(html || '');
      this.window.document.close();
    }

    async evaluate(fn, arg) {
      if (typeof fn !== 'function') {
        throw new Error('page.evaluate expects a function');
      }
      return fn(this.window, arg);
    }

    async waitForTimeout(ms) {
      await new Promise(resolve => setTimeout(resolve, ms));
    }

    async waitForFunction(fn, options = {}) {
      const timeout = Number.isFinite(options.timeout) ? options.timeout : 1000;
      const interval = Number.isFinite(options.interval) ? options.interval : 20;
      const start = Date.now();
      return new Promise((resolve, reject) => {
        const check = () => {
          try {
            const result = fn(this.window);
            if (result) {
              resolve(result);
              return;
            }
          } catch (err) {
            reject(err);
            return;
          }
          if (Date.now() - start >= timeout) {
            reject(new Error('waitForFunction timeout exceeded'));
            return;
          }
          setTimeout(check, interval);
        };
        check();
      });
    }

    async loadWeatherDashboardApp(options = {}) {
      if (!this.window) {
        await this.goto('http://localhost/');
      }
      const doc = this.window.document;
      doc.body.innerHTML = '';
      if (options.inlineConfig) {
        const script = doc.createElement('script');
        script.type = 'application/json';
        script.id = 'weather-dashboard-config';
        script.textContent = JSON.stringify(options.inlineConfig);
        doc.head.appendChild(script);
      }
      const { createLegacyWeatherDashboardRenderer } = require(path.resolve(__dirname, '../../../src/render'));
      this.window.createLegacyWeatherDashboardRenderer = createLegacyWeatherDashboardRenderer;
      const scriptPath = path.resolve(__dirname, '../../../app/weather-dashboard-app.js');
      const source = fs.readFileSync(scriptPath, 'utf8');
      try {
        const runner = new Function('window', 'document', 'globalThis', source);
        runner(this.window, this.window.document, this.window);
      } catch (error) {
        console.error('[playwright-stub] script execution failed:', error);
        throw error;
      }
    }

    async close() {
      if (this.dom) {
        try {
          this.dom.window.close();
        } catch (err) {
          // ignore
        }
        this.dom = null;
        this.window = null;
      }
    }
  }

  async function run() {
    const results = [];
    for (const entry of tests) {
      const browser = new FakeBrowser();
      let page = null;
      try {
        page = await browser.newPage();
        await entry.fn({ page, browser, expect });
        results.push({ name: entry.name, status: 'passed' });
        console.log(`✓ ${entry.name}`);
      } catch (error) {
        results.push({ name: entry.name, status: 'failed', error });
        console.error(`✗ ${entry.name}`);
        console.error(error.stack || error.message || error);
      } finally {
        if (page) {
          await page.close();
        }
        await browser.close();
      }
    }

    const failures = results.filter(result => result.status === 'failed');
    if (failures.length > 0) {
      const error = new Error(`${failures.length} Playwright stub test(s) failed.`);
      error.failures = failures;
      throw error;
    }
  }

  const chromium = {
    async launch() {
      return new FakeBrowser();
    }
  };

  return { test, expect, run, chromium };
}

function installShims(window) {
  window.requestAnimationFrame = window.requestAnimationFrame || (cb => window.setTimeout(() => cb(Date.now()), 16));
  window.cancelAnimationFrame = window.cancelAnimationFrame || (id => window.clearTimeout(id));
  if (!window.MutationObserver) {
    window.MutationObserver = class {
      observe() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    };
  }
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (!window.IntersectionObserver) {
    window.IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    };
  }
  if (!window.matchMedia) {
    window.matchMedia = () => ({
      matches: false,
      media: '',
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      }
    });
  }
  if (!window.URLSearchParams && typeof URLSearchParams === 'function') {
    window.URLSearchParams = URLSearchParams;
  }
}

function createMockResponse(input) {
  if (input && typeof input === 'object' && typeof input.text === 'function' && typeof input.json === 'function') {
    return input;
  }
  const options = input && typeof input === 'object'
    ? { ...input }
    : { status: 200, body: input };
  const status = Number.isFinite(options.status) ? options.status : 200;
  const ok = status >= 200 && status < 300;
  const bodyText = options.body != null
    ? String(options.body)
    : (options.json != null ? JSON.stringify(options.json) : '');
  return {
    ok,
    status,
    statusText: options.statusText || (ok ? 'OK' : 'Error'),
    headers: options.headers || {},
    async text() {
      return bodyText;
    },
    async json() {
      if (options.json != null) return options.json;
      if (!bodyText) return {};
      return JSON.parse(bodyText);
    }
  };
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
      if (!deepEqual(a[key], b[key])) return false;
    }
    return true;
  }
  return false;
}

function formatValue(value) {
  if (typeof value === 'string') {
    return `'${value}'`;
  }
  if (Array.isArray(value)) {
    return `[${value.map(formatValue).join(', ')}]`;
  }
  if (value && typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch (err) {
      return Object.prototype.toString.call(value);
    }
  }
  return String(value);
}

module.exports = { createRunner };
