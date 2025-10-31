import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import {
  buildHubitatBundle,
  hubitatOutFile
} from '../esbuild.hubitat.config.mjs';

async function verify() {
  const result = await buildHubitatBundle({
    outfile: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hubitat-bundle-')), path.basename(hubitatOutFile)),
    logLevel: 'silent'
  });

  if (!result) {
    process.exitCode = 1;
    return;
  }

  const tempOutfile = result.outfile;
  if (!fs.existsSync(hubitatOutFile)) {
    console.error('Expected dashboard/weather-dashboard.js to exist, but it was not found.');
    process.exitCode = 1;
    return;
  }

  const trackedBundle = fs.readFileSync(hubitatOutFile, 'utf8');
  const rebuiltBundle = fs.readFileSync(tempOutfile, 'utf8');

  try {
    fs.rmSync(path.dirname(tempOutfile), { recursive: true, force: true });
  } catch (err) {
    if (process.env.WDASH_DEBUG_BUILD === '1') {
      console.warn('[verify] failed to remove temporary directory', err);
    }
  }

  if (trackedBundle !== rebuiltBundle) {
    console.error('Tracked dashboard/weather-dashboard.js is out of date with the current sources.');
    console.error('Run "npm run build:hubitat" and commit the updated bundle.');
    process.exitCode = 1;
    return;
  }

  console.log('dashboard/weather-dashboard.js matches the output of the current build.');
}

verify().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
