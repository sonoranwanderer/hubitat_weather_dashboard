'use strict';

// Lightweight jsdom-compatible surface tailored for the dashboard tests.  It
// intentionally implements only the DOM primitives the harnesses rely on.
// Consumers that need full jsdom fidelity should swap this stub for the real
// dependency.

const {
  createTestEnvironment,
  initializeDocumentFromHtml,
  serializeDocument
} = require('./lib/fake-dom');

class JSDOM {
  constructor(html = '<!DOCTYPE html><html><body></body></html>', options = {}) {
    const { window, document } = createTestEnvironment();
    initializeDocumentFromHtml(document, html);
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
    this._initialHtml = html;
    if (options.pretendToBeVisual) {
      this.window.requestAnimationFrame = this.window.requestAnimationFrame || (fn => setTimeout(fn, 16));
      this.window.cancelAnimationFrame = this.window.cancelAnimationFrame || (id => clearTimeout(id));
    }
  }

  serialize() {
    return serializeDocument(this.window.document) || this._initialHtml;
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
