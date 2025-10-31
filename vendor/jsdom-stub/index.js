'use strict';

const { createTestEnvironment } = require('../../tests/support/fake-dom');

class JSDOM {
  constructor(html = '<!DOCTYPE html><html><body></body></html>', options = {}) {
    const { window, document } = createTestEnvironment();
    this.window = window;
    this.window.document = document;
    this.window.location = {
      href: options.url || 'http://localhost/',
      origin: options.url || 'http://localhost/',
      toString() {
        return this.href;
      }
    };
    this.window.navigator = this.window.navigator || { userAgent: 'jsdom-stub' };
    this.window.history = this.window.history || { replaceState() {}, pushState() {} };
    this.window.URL = this.window.URL || URL;
    this.window.close = this.window.close || (() => {});
    this._html = html;
    if (options.pretendToBeVisual) {
      this.window.requestAnimationFrame = this.window.requestAnimationFrame || (fn => setTimeout(fn, 16));
      this.window.cancelAnimationFrame = this.window.cancelAnimationFrame || (id => clearTimeout(id));
    }
  }

  serialize() {
    return this._html;
  }

  get virtualConsole() {
    return {
      sendTo() {}
    };
  }

  reconfigure() {}

  get cookieJar() {
    return {
      setCookie() {},
      getCookies() {
        return [];
      }
    };
  }

  getResourceLoader() {
    return {
      fetch() {
        return Promise.resolve();
      }
    };
  }
}

module.exports = { JSDOM };
