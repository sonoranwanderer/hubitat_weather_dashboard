'use strict';

const path = require('path');
const { JSDOM } = require('jsdom');
const Module = require('module');

function createExpect() {
  function stringify(value) {
    if (typeof value === 'string') return JSON.stringify(value);
    if (value && typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch (err) {
        return String(value);
      }
    }
    return String(value);
  }

  function ensureIncludesTarget(received) {
    if (received == null) {
      throw new Error('Received value cannot be inspected.');
    }
    if (typeof received.includes === 'function') {
      return received.includes.bind(received);
    }
    if (Array.isArray(received)) {
      return value => received.indexOf(value) !== -1;
    }
    throw new Error('Received value does not support the \'toContain\' matcher.');
  }

  function expect(received) {
    const positive = {
      toBe(expected) {
        if (received !== expected) {
          throw new Error(`Expected ${stringify(received)} to be ${stringify(expected)}.`);
        }
      },
      toBeNull() {
        if (received !== null) {
          throw new Error(`Expected ${stringify(received)} to be null.`);
        }
      },
      toContain(expected) {
        const checker = ensureIncludesTarget(received);
        if (!checker(expected)) {
          throw new Error(`Expected ${stringify(received)} to contain ${stringify(expected)}.`);
        }
      }
    };

    const negative = {
      toBe(expected) {
        if (received === expected) {
          throw new Error(`Expected ${stringify(received)} not to be ${stringify(expected)}.`);
        }
      },
      toBeNull() {
        if (received === null) {
          throw new Error('Expected value not to be null.');
        }
      },
      toContain(expected) {
        const checker = ensureIncludesTarget(received);
        if (checker(expected)) {
          throw new Error(`Expected ${stringify(received)} not to contain ${stringify(expected)}.`);
        }
      }
    };

    return Object.assign({}, positive, { not: negative });
  }

  return expect;
}

function installGlobals(runtime) {
  global.describe = runtime.describe;
  global.it = runtime.it;
  global.test = runtime.it;
  global.beforeEach = runtime.beforeEach;
  global.afterEach = runtime.afterEach;
  global.expect = runtime.expect;
}

function uninstallGlobals() {
  delete global.describe;
  delete global.it;
  delete global.test;
  delete global.beforeEach;
  delete global.afterEach;
  delete global.expect;
}

function createSuite(name, parent) {
  return {
    type: 'suite',
    name,
    parent: parent || null,
    children: [],
    beforeEach: [],
    afterEach: []
  };
}

function createRuntime() {
  const rootSuite = createSuite('(root)', null);
  let currentSuite = rootSuite;

  function runWithinSuite(targetSuite, fn) {
    const previous = currentSuite;
    currentSuite = targetSuite;
    try {
      if (typeof fn === 'function') {
        fn();
      }
    } finally {
      currentSuite = previous;
    }
  }

  function describe(name, fn) {
    const suite = createSuite(name || '(anonymous suite)', currentSuite);
    currentSuite.children.push(suite);
    runWithinSuite(suite, fn);
  }

  function registerTest(name, fn) {
    currentSuite.children.push({
      type: 'test',
      name: name || '(anonymous test)',
      fn: typeof fn === 'function' ? fn : () => {}
    });
  }

  function addBeforeEach(fn) {
    if (typeof fn === 'function') {
      currentSuite.beforeEach.push(fn);
    }
  }

  function addAfterEach(fn) {
    if (typeof fn === 'function') {
      currentSuite.afterEach.push(fn);
    }
  }

  function collectSuiteNames(chain) {
    return chain
      .filter(suite => suite.name && suite.name !== '(root)')
      .map(suite => suite.name);
  }

  function runSuite(suite, ancestors, results) {
    const chain = ancestors.concat(suite);
    for (const child of suite.children) {
      if (child.type === 'suite') {
        runSuite(child, chain, results);
      } else if (child.type === 'test') {
        runTest(child, chain, results);
      }
    }
  }

  function invokeHooks(hooks) {
    for (const hook of hooks) {
      hook();
    }
  }

  function runTest(testNode, chain, results) {
    const names = collectSuiteNames(chain);
    names.push(testNode.name);
    const fullName = names.join(' > ');
    const beforeHooks = [];
    for (const suite of chain) {
      beforeHooks.push(...suite.beforeEach);
    }
    const afterHooks = [];
    for (let i = chain.length - 1; i >= 0; i -= 1) {
      afterHooks.push(...chain[i].afterEach);
    }

    let status = 'passed';
    let error = null;
    let shouldSkipBody = false;

    try {
      invokeHooks(beforeHooks);
    } catch (err) {
      status = 'failed';
      error = err;
      shouldSkipBody = true;
    }

    if (!shouldSkipBody) {
      try {
        testNode.fn();
      } catch (err) {
        status = 'failed';
        error = err;
      }
    }

    try {
      invokeHooks(afterHooks);
    } catch (err) {
      status = 'failed';
      if (!error) {
        error = err;
      }
    }

    results.tests.push({ status, name: fullName, error });
    results.total += 1;
    if (status === 'failed') {
      results.failed += 1;
    }
  }

  function run() {
    const summary = { tests: [], total: 0, failed: 0 };
    runSuite(rootSuite, [], summary);
    summary.passed = summary.total - summary.failed;
    return summary;
  }

  return {
    describe,
    it: registerTest,
    beforeEach: addBeforeEach,
    afterEach: addAfterEach,
    expect: createExpect(),
    run
  };
}

function installModulePaths(additionalPaths) {
  if (!additionalPaths || !additionalPaths.length) {
    return () => {};
  }
  const unique = Array.from(new Set(additionalPaths.map(p => path.resolve(p))));
  const originalNodePath = process.env.NODE_PATH || '';
  const combined = unique.join(path.delimiter);
  process.env.NODE_PATH = combined + (originalNodePath ? path.delimiter + originalNodePath : '');
  Module._initPaths();
  return () => {
    process.env.NODE_PATH = originalNodePath;
    Module._initPaths();
  };
}

function setupDomEnvironment() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  const { window } = dom;
  const previous = new Map();
  const globalsToCopy = [
    'window',
    'document',
    'navigator',
    'HTMLElement',
    'SVGElement',
    'Element',
    'Node',
    'Text',
    'Comment',
    'DocumentFragment',
    'CustomEvent',
    'Event',
    'MouseEvent',
    'KeyboardEvent',
    'getComputedStyle'
  ];

  window.console = window.console || global.console;
  window.self = window;

  const originalSetInterval = global.setInterval;
  const originalClearInterval = global.clearInterval;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const clampDelay = value => {
    if (!Number.isFinite(value) || value < 0) return 0;
    return Math.min(value, 50);
  };
  const activeTimeouts = new Set();
  window.setTimeout = function setTimeoutStub(fn, delay) {
    if (typeof fn !== 'function') {
      return 0;
    }
    const ms = clampDelay(delay);
    const handle = originalSetTimeout(() => {
      let thrownError = null;
      try {
        fn();
      } catch (err) {
        thrownError = err;
      } finally {
        activeTimeouts.delete(handle);
      }
      if (thrownError) {
        throw thrownError;
      }
    }, ms);
    activeTimeouts.add(handle);
    return handle;
  };
  window.clearTimeout = function clearTimeoutStub(handle) {
    if (handle != null) {
      originalClearTimeout(handle);
      activeTimeouts.delete(handle);
    }
  };
  window.setInterval = (fn, delay) => window.setTimeout(fn, delay);
  window.clearInterval = handle => window.clearTimeout(handle);

  const setGlobalValue = (key, value) => {
    try {
      global[key] = value;
    } catch (err) {
      Object.defineProperty(global, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value
      });
    }
  };

  for (const key of globalsToCopy) {
    if (Object.prototype.hasOwnProperty.call(window, key)) {
      if (Object.prototype.hasOwnProperty.call(global, key)) {
        previous.set(key, Object.getOwnPropertyDescriptor(global, key) || {
          configurable: true,
          enumerable: true,
          writable: true,
          value: global[key]
        });
      }
      setGlobalValue(key, window[key]);
    }
  }

  const extra = new Map();
  if (!global.window) {
    extra.set('window', window);
    setGlobalValue('window', window);
  }
  if (!global.document) {
    extra.set('document', window.document);
    setGlobalValue('document', window.document);
  }
  if (!global.navigator) {
    extra.set('navigator', window.navigator);
    setGlobalValue('navigator', window.navigator);
  }
  global.globalThis = global;
  global.self = global.window;
  global.setInterval = window.setInterval;
  global.clearInterval = window.clearInterval;
  global.setTimeout = window.setTimeout;
  global.clearTimeout = window.clearTimeout;

  return () => {
    for (const [key, descriptor] of previous.entries()) {
      Object.defineProperty(global, key, descriptor);
    }
    for (const key of extra.keys()) {
      delete global[key];
    }
    if (typeof originalSetInterval === 'function') {
      global.setInterval = originalSetInterval;
    } else {
      delete global.setInterval;
    }
    if (typeof originalClearInterval === 'function') {
      global.clearInterval = originalClearInterval;
    } else {
      delete global.clearInterval;
    }
    if (typeof originalSetTimeout === 'function') {
      global.setTimeout = originalSetTimeout;
    } else {
      delete global.setTimeout;
    }
    if (typeof originalClearTimeout === 'function') {
      global.clearTimeout = originalClearTimeout;
    } else {
      delete global.clearTimeout;
    }
    for (const handle of Array.from(activeTimeouts)) {
      originalClearTimeout(handle);
      activeTimeouts.delete(handle);
    }
  };
}

async function runTestFile(filePath, options = {}) {
  const runtime = createRuntime();
  const restoreModulePaths = installModulePaths(options.modulePaths || []);
  const restoreDom = setupDomEnvironment();
  installGlobals(runtime);
  const uncaughtErrors = [];
  let removeUncaughtHandler = () => {};
  if (typeof process !== 'undefined' && process && typeof process.on === 'function') {
    const handler = err => {
      uncaughtErrors.push(err);
    };
    process.on('uncaughtException', handler);
    removeUncaughtHandler = () => {
      if (typeof process.off === 'function') {
        process.off('uncaughtException', handler);
      } else if (typeof process.removeListener === 'function') {
        process.removeListener('uncaughtException', handler);
      }
    };
  }
  let loadError = null;
  try {
    delete require.cache[require.resolve(filePath)];
    require(filePath);
  } catch (err) {
    loadError = err;
  }

  let summary;
  try {
    if (loadError) {
      summary = {
        tests: [
          {
            status: 'failed',
            name: 'Test suite failed to load',
            error: loadError
          }
        ],
        total: 1,
        failed: 1,
        passed: 0
      };
    } else {
      summary = runtime.run();
    }

    await new Promise(resolve => setTimeout(resolve, 75));

    if (uncaughtErrors.length) {
      let index = 1;
      for (const err of uncaughtErrors) {
        const name = uncaughtErrors.length > 1
          ? `Unhandled asynchronous exception #${index}`
          : 'Unhandled asynchronous exception';
        summary.tests.push({ status: 'failed', name, error: err });
        summary.total += 1;
        summary.failed += 1;
        index += 1;
      }
    }
  } finally {
    uninstallGlobals();
    restoreDom();
    restoreModulePaths();
    removeUncaughtHandler();
  }

  summary.filePath = filePath;
  if (typeof summary.passed !== 'number') {
    summary.passed = summary.total - summary.failed;
  }
  return summary;
}

module.exports = { runTestFile };
