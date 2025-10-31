import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
let esbuildModule;
try {
  esbuildModule = await import('esbuild');
} catch (err) {
  if (process.env.WDASH_DEBUG_BUILD === '1') {
    console.warn('[esbuild] Falling back to simple bundler stub:', err?.message || err);
  }
  esbuildModule = await import('./build/simple-esbuild.mjs');
}

const { build, context } = esbuildModule;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = __dirname;
const entryPoint = path.join(projectRoot, 'src', 'entries', 'hubitat-dashboard.js');
const outFile = path.join(projectRoot, 'dashboard', 'weather-dashboard.js');

const bannerComment = () => `/*! Hubitat Weather Dashboard bundle - generated ${new Date().toISOString()} */`;

function ensureEntryExists() {
  if (!fs.existsSync(entryPoint)) {
    console.error(`Hubitat entry point not found: ${entryPoint}`);
    process.exitCode = 1;
    return false;
  }
  return true;
}

function createBuildOptions({ minify = false, sourcemap = false } = {}) {
  return {
    entryPoints: [entryPoint],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2018'],
    outfile: outFile,
    minify,
    sourcemap: sourcemap ? 'inline' : false,
    logLevel: 'info',
    banner: { js: bannerComment() },
    define: {
      'process.env.NODE_ENV': minify ? '"production"' : '"development"'
    }
  };
}

export async function buildHubitatBundle(options = {}) {
  if (!ensureEntryExists()) return null;
  const buildOptions = createBuildOptions(options);
  await build(buildOptions);
  console.log(`Bundle written to ${path.relative(projectRoot, outFile)}`);
  return buildOptions;
}

export async function watchHubitatBundle(options = {}) {
  if (!ensureEntryExists()) return null;
  const buildOptions = createBuildOptions(options);
  const ctx = await context(buildOptions);
  await ctx.watch();
  console.log('Watching Hubitat bundle for changes...');
  return ctx;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = new Set(process.argv.slice(2));
  const watch = args.has('--watch') || args.has('-w');
  const minify = args.has('--minify');
  const sourcemap = args.has('--sourcemap') || args.has('--source-map');

  const run = watch ? watchHubitatBundle : buildHubitatBundle;

  run({ minify, sourcemap }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export default {
  buildHubitatBundle,
  watchHubitatBundle
};
