import fs from 'node:fs';
import path from 'node:path';

function toPosix(filePath) {
  return filePath.split(path.sep).join('/');
}

function ensureJsExtension(filePath) {
  if (fs.existsSync(filePath)) return filePath;
  const withJs = `${filePath}.js`;
  if (fs.existsSync(withJs)) return withJs;
  return filePath;
}

function scanDependencies(entryPoints) {
  const modules = new Map();
  const queue = entryPoints.map(filePath => path.resolve(filePath));

  while (queue.length) {
    const absPath = queue.pop();
    const normalized = toPosix(path.relative(process.cwd(), absPath));
    if (modules.has(normalized)) continue;

    if (!fs.existsSync(absPath)) {
      throw new Error(`Module not found: ${absPath}`);
    }

    const source = fs.readFileSync(absPath, 'utf8');
    const requires = [];
    const dependencyMap = {};
    const regex = /require\((['"])([^'"]+?)\1\)/g;
    let match;
    while ((match = regex.exec(source))) {
      const request = match[2];
      if (!request || !request.startsWith('.')) continue;
      const resolved = ensureJsExtension(path.resolve(path.dirname(absPath), request));
      const resolvedNormalized = toPosix(path.relative(process.cwd(), resolved));
      dependencyMap[request] = resolvedNormalized;
      requires.push(resolved);
    }

    modules.set(normalized, { source, dependencyMap });
    requires.forEach(dep => {
      queue.push(dep);
    });
  }

  return modules;
}

function createBundleText(modules, entryPoints, banner) {
  const lines = [];
  if (banner) {
    lines.push(banner);
  }
  lines.push('(function(){');
  lines.push('  const modules = new Map();');
  modules.forEach(({ source, dependencyMap }, id) => {
    lines.push(`  modules.set(${JSON.stringify(id)}, [`);
    lines.push('    function(module, exports, require) {');
    source.split('\n').forEach(line => {
      lines.push(`      ${line}`);
    });
    lines.push('    },');
    lines.push(`    ${JSON.stringify(dependencyMap)}`);
    lines.push('  ]);');
  });
  const entryIds = entryPoints.map(entry => toPosix(path.relative(process.cwd(), path.resolve(entry))));
  lines.push('  const cache = new Map();');
  lines.push('  function loadModule(id) {');
  lines.push('    if (cache.has(id)) {');
    lines.push('      return cache.get(id).exports;');
    lines.push('    }');
  lines.push('    const entry = modules.get(id);');
  lines.push('    if (!entry) {');
  lines.push('      throw new Error(`Cannot find module "${id}"`);');
  lines.push('    }');
  lines.push('    const [factory, dependencyMap] = entry;');
  lines.push('    const module = { exports: {} };');
  lines.push('    cache.set(id, module);');
  lines.push('    function localRequire(request) {');
  lines.push('      const resolved = dependencyMap[request];');
  lines.push('      if (!resolved) {');
  lines.push('        throw new Error(`Cannot resolve "${request}" from module "${id}"`);');
  lines.push('      }');
  lines.push('      return loadModule(resolved);');
  lines.push('    }');
  lines.push('    factory(module, module.exports, localRequire);');
  lines.push('    return module.exports;');
  lines.push('  }');
  entryIds.forEach(entryId => {
    lines.push(`  loadModule(${JSON.stringify(entryId)});`);
  });
  lines.push('})();');
  lines.push('');
  return lines.join('\n');
}

async function build(options = {}) {
  const entryPoints = options.entryPoints || [];
  if (!entryPoints.length) {
    throw new Error('No entryPoints provided to stub esbuild.');
  }
  const modules = scanDependencies(entryPoints);
  const bannerText = options.banner && options.banner.js ? options.banner.js : '';
  const bundle = createBundleText(modules, entryPoints, bannerText);
  if (!options.outfile) {
    throw new Error('No outfile specified for stub esbuild.');
  }
  fs.mkdirSync(path.dirname(options.outfile), { recursive: true });
  fs.writeFileSync(options.outfile, bundle);
  if (options.logLevel === 'info') {
    console.log(`Stub esbuild wrote ${path.relative(process.cwd(), options.outfile)}`);
  }
  return { outputFiles: [] };
}

async function context(options = {}) {
  return {
    async watch() {
      await build(options);
    },
    async dispose() {}
  };
}

export { build, context };
export default { build, context };
