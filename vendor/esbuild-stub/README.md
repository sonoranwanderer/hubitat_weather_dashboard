# esbuild stub vendor package

This repository vendors a minimal `esbuild` module so `npm install` can
complete in offline or restricted environments. The stub simply re-exports
the local fallback bundler implemented in `build/simple-esbuild.mjs`, which
provides the limited `build` and `context` APIs that the Hubitat dashboard
build requires.
