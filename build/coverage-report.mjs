#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..');
const coverageRoot = path.join(repoRoot, 'coverage');
const v8CoverageDir = path.join(coverageRoot, 'v8');
const summaryPath = path.join(coverageRoot, 'coverage-summary.json');

function walkFiles(dir, predicate, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'coverage') continue;
      walkFiles(full, predicate, out);
    } else if (entry.isFile() && predicate(full)) {
      out.push(full);
    }
  }
  return out;
}

function toRepoPath(filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join('/');
}

function isJsSource(repoPath) {
  return (repoPath.startsWith('src/') || repoPath.startsWith('app/'))
    && repoPath.endsWith('.js')
    && !repoPath.endsWith('weather-dashboard.js');
}

function isGroovySource(repoPath) {
  return repoPath.startsWith('hubitat/') && repoPath.endsWith('.groovy');
}

function percent(covered, total) {
  return total > 0 ? Number(((covered / total) * 100).toFixed(2)) : 100;
}

function lineStartsFor(source) {
  const starts = [0];
  for (let i = 0; i < source.length; i += 1) {
    if (source.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function lineForOffset(starts, offset) {
  let low = 0;
  let high = starts.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (starts[mid] <= offset) {
      if (mid === starts.length - 1 || starts[mid + 1] > offset) return mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return 0;
}

function summarizeJsCoverage() {
  const files = new Map();
  for (const file of walkFiles(v8CoverageDir, item => item.endsWith('.json'))) {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const result of raw.result || []) {
      if (!result.url || !result.url.startsWith('file://')) continue;
      const filePath = fileURLToPath(result.url);
      const repoPath = toRepoPath(filePath);
      if (!isJsSource(repoPath) || !fs.existsSync(filePath)) continue;

      const source = fs.readFileSync(filePath, 'utf8');
      const nonBlankLines = new Set(source.split(/\r?\n/)
        .map((line, index) => (line.trim() ? index + 1 : null))
        .filter(Boolean));
      const entry = files.get(repoPath) || {
        path: repoPath,
        source,
        nonBlankLines,
        functions: new Map(),
        coveredLines: new Set()
      };
      const starts = lineStartsFor(source);

      for (const fn of result.functions || []) {
        const ranges = Array.isArray(fn.ranges) ? fn.ranges : [];
        const key = `${fn.functionName || '(anonymous)'}:${ranges[0]?.startOffset ?? 0}:${ranges[0]?.endOffset ?? 0}`;
        const covered = ranges.some(range => Number(range.count) > 0);
        entry.functions.set(key, Boolean(entry.functions.get(key) || covered));

        const isTopLevel = !fn.functionName && ranges.length === 1
          && ranges[0].startOffset === 0
          && ranges[0].endOffset >= source.length;
        if (!covered || isTopLevel) continue;

        for (const range of ranges) {
          if (Number(range.count) <= 0) continue;
          const startLine = lineForOffset(starts, range.startOffset);
          const endLine = lineForOffset(starts, Math.max(range.startOffset, range.endOffset - 1));
          for (let line = startLine; line <= endLine; line += 1) {
            const lineNumber = line + 1;
            if (entry.nonBlankLines.has(lineNumber)) {
              entry.coveredLines.add(lineNumber);
            }
          }
        }
      }
      files.set(repoPath, entry);
    }
  }

  for (const filePath of walkFiles(repoRoot, file => isJsSource(toRepoPath(file)))) {
    const repoPath = toRepoPath(filePath);
    if (!files.has(repoPath)) {
      files.set(repoPath, {
        path: repoPath,
        source: fs.readFileSync(filePath, 'utf8'),
        nonBlankLines: new Set(fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
          .map((line, index) => (line.trim() ? index + 1 : null))
          .filter(Boolean)),
        functions: new Map(),
        coveredLines: new Set()
      });
    }
  }

  const fileSummaries = Array.from(files.values())
    .sort((a, b) => a.path.localeCompare(b.path))
    .map(entry => {
      const totalNonBlankLines = entry.source.split(/\r?\n/).filter(line => line.trim()).length;
      const totalFunctions = entry.functions.size;
      const coveredFunctions = Array.from(entry.functions.values()).filter(Boolean).length;
      return {
        path: entry.path,
        lineCoveragePercent: percent(entry.coveredLines.size, totalNonBlankLines),
        coveredLines: entry.coveredLines.size,
        totalNonBlankLines,
        functionCoveragePercent: percent(coveredFunctions, totalFunctions),
        coveredFunctions,
        totalFunctions
      };
    });

  const totals = fileSummaries.reduce((acc, file) => {
    acc.coveredLines += file.coveredLines;
    acc.totalNonBlankLines += file.totalNonBlankLines;
    acc.coveredFunctions += file.coveredFunctions;
    acc.totalFunctions += file.totalFunctions;
    return acc;
  }, { coveredLines: 0, totalNonBlankLines: 0, coveredFunctions: 0, totalFunctions: 0 });

  return {
    lineCoveragePercent: percent(totals.coveredLines, totals.totalNonBlankLines),
    functionCoveragePercent: percent(totals.coveredFunctions, totals.totalFunctions),
    ...totals,
    files: fileSummaries
  };
}

function summarizeGroovyCoverageApproximation() {
  const testText = walkFiles(path.join(repoRoot, 'tests', 'hubitat'), file => file.endsWith('.groovy'))
    .map(file => fs.readFileSync(file, 'utf8'))
    .join('\n');
  const methodPattern = /^\s*(?:(?:private|public|protected)\s+)?(?:static\s+)?(?:(?:def)|(?:[A-Za-z_][\w<>, ?\[\]]*))\s+([A-Za-z_]\w*)\s*\(/;

  const files = walkFiles(repoRoot, file => isGroovySource(toRepoPath(file))).sort().map(filePath => {
    const methods = fs.readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map((line, index) => {
        const match = line.match(methodPattern);
        return match ? { name: match[1], line: index + 1 } : null;
      })
      .filter(Boolean);
    const covered = methods.filter(method => new RegExp(`['"]${method.name}['"]|\\b${method.name}\\s*\\(`).test(testText));
    return {
      path: toRepoPath(filePath),
      coverageType: 'method-reference approximation',
      methodCoveragePercent: percent(covered.length, methods.length),
      coveredMethods: covered.length,
      totalMethods: methods.length,
      unreferencedMethods: methods
        .filter(method => !covered.some(item => item.name === method.name && item.line === method.line))
        .map(method => `${method.name}:${method.line}`)
    };
  });

  const totals = files.reduce((acc, file) => {
    acc.coveredMethods += file.coveredMethods;
    acc.totalMethods += file.totalMethods;
    return acc;
  }, { coveredMethods: 0, totalMethods: 0 });

  return {
    coverageType: 'method-reference approximation',
    methodCoveragePercent: percent(totals.coveredMethods, totals.totalMethods),
    ...totals,
    files
  };
}

fs.rmSync(coverageRoot, { recursive: true, force: true });
fs.mkdirSync(v8CoverageDir, { recursive: true });

const testResult = spawnSync('./tests/run-all.sh', {
  cwd: repoRoot,
  env: { ...process.env, NODE_V8_COVERAGE: v8CoverageDir },
  stdio: 'inherit'
});

const summary = {
  generatedAt: new Date().toISOString(),
  command: 'npm run coverage',
  js: summarizeJsCoverage(),
  groovy: summarizeGroovyCoverageApproximation(),
  notes: [
    'JavaScript coverage uses Node V8 coverage generated while running the existing local harnesses.',
    'Groovy coverage is an approximation based on methods referenced by local Groovy smoke tests; Hubitat runtime execution is not instrumented.'
  ]
};

fs.mkdirSync(coverageRoot, { recursive: true });
fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);

console.log('');
console.log('Coverage summary');
console.log(`JS line coverage: ${summary.js.lineCoveragePercent}% (${summary.js.coveredLines}/${summary.js.totalNonBlankLines})`);
console.log(`JS function coverage: ${summary.js.functionCoveragePercent}% (${summary.js.coveredFunctions}/${summary.js.totalFunctions})`);
console.log(`Groovy method coverage approximation: ${summary.groovy.methodCoveragePercent}% (${summary.groovy.coveredMethods}/${summary.groovy.totalMethods})`);
console.log(`Machine-readable report: ${path.relative(repoRoot, summaryPath)}`);

if (testResult.status !== 0) {
  process.exitCode = testResult.status || 1;
}
