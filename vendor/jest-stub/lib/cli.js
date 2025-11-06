'use strict';

const path = require('path');
const { runCLI } = require('./runner');

function parseArgs(argv) {
  const args = argv.slice(2);
  const options = { config: null, runTestsByPath: [] };
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === '--config' && i + 1 < args.length) {
      options.config = args[i + 1];
      i += 1;
    } else if (!token.startsWith('-')) {
      options.runTestsByPath.push(path.resolve(process.cwd(), token));
    }
  }
  return options;
}

(async () => {
  try {
    const options = parseArgs(process.argv);
    const result = await runCLI(options);
    if (!result.success) {
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(err && err.stack ? err.stack : String(err));
    process.exitCode = 1;
  }
})();
