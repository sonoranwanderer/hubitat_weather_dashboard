'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runTestFile } = require('../vendor/jest-stub/lib/minijest');

(async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdash-jest-'));
  const testFile = path.join(tmpDir, 'async-error.test.js');
  fs.writeFileSync(
    testFile,
    "test('async error surfaces', () => {\n  setTimeout(() => { throw new Error('async boom'); }, 0);\n});\n"
  );

  const summary = await runTestFile(testFile);

  fs.rmSync(tmpDir, { recursive: true, force: true });

  assert.strictEqual(summary.failed, 1, 'Expected one failed test when async timer throws.');
  const asyncFailure = summary.tests.find(test =>
    test.name.startsWith('Unhandled asynchronous exception') &&
    test.error &&
    test.error.message === 'async boom'
  );
  assert(asyncFailure, 'Expected async timer error to be reported in summary.');

  console.log('Jest async timer failure harness passed');
})();
