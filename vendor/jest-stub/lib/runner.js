'use strict';

const fs = require('fs');
const path = require('path');
const { runTestFile } = require('./minijest');

function patternMatches(filePath, patterns) {
  const normalized = filePath.replace(/\\/g, '/');
  for (const pattern of patterns) {
    if (pattern.includes('test')) {
      if (normalized.endsWith('.test.js')) {
        return true;
      }
    }
    if (pattern.includes('spec')) {
      if (normalized.endsWith('.spec.js')) {
        return true;
      }
    }
  }
  return false;
}

function walkForTests(startDir, patterns, out) {
  const entries = fs.readdirSync(startDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') {
      continue;
    }
    const fullPath = path.join(startDir, entry.name);
    if (entry.isDirectory()) {
      walkForTests(fullPath, patterns, out);
    } else if (entry.isFile()) {
      if (patternMatches(fullPath, patterns)) {
        out.push(fullPath);
      }
    }
  }
}

function loadConfig(configPath) {
  if (!configPath || !fs.existsSync(configPath)) {
    return {};
  }
  const resolved = path.resolve(configPath);
  delete require.cache[resolved];
  return require(resolved) || {};
}

async function runCLI(options = {}) {
  const cwd = process.cwd();
  const configPath = options.config ? path.resolve(cwd, options.config) : path.resolve(cwd, 'jest.config.js');
  const config = loadConfig(configPath);
  const rootDir = config.rootDir ? path.resolve(cwd, config.rootDir) : cwd;
  const testPatterns = Array.isArray(config.testMatch) && config.testMatch.length ? config.testMatch : ['**/*.test.js'];
  const modulePaths = Array.isArray(config.modulePaths)
    ? config.modulePaths.map(p => path.resolve(rootDir, p))
    : [];

  let testFiles = [];
  if (options.runTestsByPath && options.runTestsByPath.length) {
    testFiles = options.runTestsByPath.map(file => path.resolve(cwd, file));
  } else {
    walkForTests(rootDir, testPatterns, testFiles);
  }

  if (!testFiles.length) {
    console.log('No tests found.');
    return { success: true, results: [] };
  }

  console.log(`Running ${testFiles.length} test file(s)...`);

  const aggregated = {
    files: [],
    total: 0,
    failed: 0,
    passed: 0
  };

  for (const file of testFiles) {
    const summary = await runTestFile(file, { modulePaths });
    aggregated.files.push(summary);
    aggregated.total += summary.total;
    aggregated.failed += summary.failed;
    aggregated.passed += summary.passed;

    for (const test of summary.tests) {
      if (test.status === 'passed') {
        console.log(`\x1b[32m✓\x1b[0m ${test.name}`);
      } else {
        console.log(`\x1b[31m✗\x1b[0m ${test.name}`);
        if (test.error) {
          console.log(`    ${test.error.stack || test.error.message || String(test.error)}`);
        }
      }
    }
  }

  const success = aggregated.failed === 0;
  const statusLine = success ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`\n${statusLine} ${aggregated.passed}/${aggregated.total} tests passed across ${testFiles.length} file(s).`);

  return { success, results: aggregated };
}

module.exports = { runCLI };
