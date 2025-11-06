'use strict';

const assert = require('assert');
const { createTestEnvironment } = require('./support/fake-dom');

(async function main() {
  const { window } = createTestEnvironment();

  const timerError = new Error('timer stub propagation test');
  const timeoutResult = await new Promise((resolve, reject) => {
    const watchdog = setTimeout(() => {
      reject(new Error('setTimeout stub did not surface uncaughtException within 100ms'));
    }, 100);

    const handle = window.setTimeout(() => {
      throw timerError;
    }, 0);

    process.once('uncaughtException', err => {
      clearTimeout(watchdog);
      window.clearTimeout(handle);
      resolve(err);
    });
  });

  assert.strictEqual(
    timeoutResult,
    timerError,
    'setTimeout stub should propagate the original error instance'
  );

  const intervalError = new Error('interval stub propagation test');
  const intervalResult = await new Promise((resolve, reject) => {
    const watchdog = setTimeout(() => {
      reject(new Error('setInterval stub did not surface uncaughtException within 100ms'));
    }, 100);

    const handle = window.setInterval(() => {
      throw intervalError;
    }, 0);

    process.once('uncaughtException', err => {
      clearTimeout(watchdog);
      window.clearInterval(handle);
      resolve(err);
    });
  });

  assert.strictEqual(
    intervalResult,
    intervalError,
    'setInterval stub should propagate the original error instance'
  );

  console.log('Timer stub harness passed');
})();
