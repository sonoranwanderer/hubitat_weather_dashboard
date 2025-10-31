#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const esbuild = require('esbuild');

const projectRoot = path.resolve(__dirname, '..');
const entryPoint = path.join(projectRoot, 'dashboard/weather-dashboard.js');
const outdir = path.join(projectRoot, 'dist');
const outfile = path.join(outdir, 'weather-dashboard.js');

const args = new Set(process.argv.slice(2));
const watch = args.has('--watch');
const minify = args.has('--minify');
const sourcemap = args.has('--sourcemap') || args.has('--source-map');

if (!fs.existsSync(entryPoint)) {
  console.error(`Unable to locate entry point: ${entryPoint}`);
  process.exitCode = 1;
  return;
}

fs.mkdirSync(outdir, { recursive: true });

const buildOptions = {
  entryPoints: [entryPoint],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2018'],
  outfile,
  sourcemap: sourcemap ? 'inline' : false,
  minify,
  logLevel: 'info',
  banner: {
    js: `/*! Hubitat Weather Dashboard bundle - generated ${new Date().toISOString()} */`,
  },
};

async function runBuild() {
  if (watch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log('Watching for changes...');
  } else {
    await esbuild.build(buildOptions);
    console.log(`Bundle written to ${path.relative(projectRoot, outfile)}`);
  }
}

runBuild().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
