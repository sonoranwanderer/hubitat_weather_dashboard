'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('../vendor/jsdom-stub');

function extractLoaderScript(html) {
  const marker = '<script>';
  const start = html.indexOf(marker);
  assert(start >= 0, 'loader script should exist');
  const end = html.indexOf('</script>', start + marker.length);
  assert(end > start, 'loader script should have a closing tag');
  return html.slice(start + marker.length, end);
}

function runLoader(search) {
  const htmlPath = path.resolve(__dirname, '../app/weather-dashboard-app.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const dom = new JSDOM(html, {
    url: `http://localhost/local/weather-dashboard-app.html${search}`
  });
  const { window } = dom;
  const appendedScripts = [];
  const originalAppendChild = window.document.body.appendChild.bind(window.document.body);
  window.document.body.appendChild = node => {
    if (node && node.tagName === 'SCRIPT') {
      appendedScripts.push(node);
    }
    return originalAppendChild(node);
  };
  window.location.search = search;
  window.location.href = `http://localhost/local/weather-dashboard-app.html${search}`;
  window.location.origin = 'http://localhost';
  window.URL = URL;
  window.URLSearchParams = URLSearchParams;
  window.requestAnimationFrame = callback => callback();
  window.addEventListener = () => {};

  vm.runInNewContext(extractLoaderScript(html), {
    window,
    document: window.document,
    URL,
    URLSearchParams,
    console,
    setTimeout
  });

  return { window, appendedScripts };
}

const unsafe = runLoader('?rendererScript=javascript%3Aalert(1)%3Cimg%20src%3Dx%20onerror%3Dalert(2)%3E');
assert.strictEqual(unsafe.appendedScripts.length, 0, 'unsafe renderer script should not be appended');
assert(
  unsafe.window.document.body.textContent.includes('Refused to load unsafe script path.'),
  'unsafe renderer script should render a text-only failure'
);
assert(
  !unsafe.window.document.body.innerHTML.includes('<img'),
  'unsafe renderer script should not become loader markup'
);

const safe = runLoader('?bundleBase=/local/custom/');
assert.strictEqual(safe.appendedScripts.length, 1, 'safe same-origin renderer script should be appended');
assert.strictEqual(
  safe.appendedScripts[0].src,
  'http://localhost/local/custom/weather-dashboard.js',
  'relative bundle base should resolve against the current origin'
);

const parsed = new JSDOM('<!doctype html><html><head><title>Safe</title></head><body><main id="root">Ready</main></body></html>');
assert.strictEqual(parsed.window.document.head.textContent, 'Safe', 'head content should be extracted');
assert.strictEqual(parsed.window.document.body.textContent, 'Ready', 'body content should be extracted');

console.log('security-harness.js passed');
