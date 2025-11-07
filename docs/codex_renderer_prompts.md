# Weather Dashboard Renderer Rearchitecture – Codex Prompt Pack

These stand-alone prompts guide Codex through incrementally rearchitecting the Weather Dashboard project to achieve renderer independence, a pluggable data layer, well-defined deployment flows, comprehensive tests, and concise documentation. Each prompt assumes prior prompts were completed successfully and that the working tree is clean before starting.

---

## Prompt 1 – Establish the Renderer Contract and Layout Language
```
You are Codex, a senior front-end engineer. Refactor the renderer entry point so it exports a pure `createRenderer()` factory that accepts `{ width, height }`, a layout description JSON, and a data snapshot, then returns DOM-ready markup plus the CSS custom property map required to size the dashboard. Follow these steps:

1. Identify the current render pipeline and replace the scaling logic (`applyScale`, transform-based sizing) with direct container dimension usage. The renderer must:
   • Receive measured `width` and `height` from the host.
   • Apply those dimensions as CSS custom properties on the root element.
   • Build the grid without referencing the legacy 1220×1240 defaults.

2. Define a JSON-based layout language that supports:
   • Row/column definitions with fractional or percentage tracks.
   • Card placement via `row`, `column`, `rowSpan`, `colSpan` properties.
   • Optional per-card style hints (e.g., `class`, `minWidth`, `minHeight`).

3. Implement utilities to translate the layout JSON into CSS Grid templates and card styles. Ensure auto rows/columns are handled without forcing full-height cards.

4. Update styles so cards rely on internal flexbox/typography rules for responsiveness instead of global scaling.

5. Document the new renderer contract (`createRenderer({ width, height, layout, data })`) in `docs/renderer-contract.md`.

6. Add Jest tests covering:
   • Grid generation for square, portrait, and landscape containers.
   • Layout JSON parsing edge cases (missing spans, percentages, fractions).

Do not modify data acquisition code yet. Maintain linting and existing build scripts. Ensure all tests pass.
```

---

## Prompt 2 – Introduce the Renderer Host Layer
```
You are Codex, a senior full-stack engineer. Extract a host controller that wires container measurement and the renderer factory. Complete the following:

1. Create a `src/host/` module exporting `bootstrapRenderer({ container, layout, adapter })`.
   • Measure the container using ResizeObserver or a polling fallback.
   • On size changes, call `renderer.render({ width, height, data })` without scaling transforms.
   • Manage DOM updates by swapping the root element and applying CSS custom properties.

2. Ensure `bootstrapRenderer` accepts a data adapter that exposes `subscribe(onData)` and `dispose()`. The host must:
   • Call `adapter.subscribe` and receive data snapshots.
   • Coalesce resize and data events so rendering only happens with the latest `{ size, data }` pair.
   • Provide user-facing diagnostics for adapter errors (console warning + optional status banner).

3. Update existing entry points to use the host:
   • Hubitat dashboard tile loader.
   • Preview iframe in WeatherDashboardApp.
   • Standalone HTML demo.

4. Add documentation in `docs/deployment-flows.md` covering the three bootstrap paths and measurement contract.

5. Extend tests to cover the host-controller logic with mocked container sizes and adapter streams.
```

---

## Prompt 3 – Implement Pluggable Data Adapters
```
You are Codex, an expert in modular JS design. Introduce a pluggable data acquisition layer with adapters for Hubitat Dashboard tiles, Maker API preview, and a generic HTTP source. Steps:

1. Define an adapter interface in `src/data/adapters/types.ts` (TypeScript-style JSDoc if staying in JS) documenting `subscribe`, `dispose`, and error reporting methods.

2. Implement adapters:
   • `hubitatDashboardAdapter` that reads device attribute tiles with minimal polling.
   • `makerApiAdapter` for preview and standalone modes using fetch; include throttling and error backoff.
   • `mockAdapter` for tests and offline development.

3. Each adapter must:
   • Emit structured data compatible with the renderer layout cards.
   • Provide diagnostics via events or callbacks.
   • Respect resource limits (configurable polling interval, retry delays).

4. Update bootstrap flows to select the correct adapter.

5. Create Jest tests with mocked fetch/Hubitat responses verifying normal data flow, error propagation, and throttling behavior.

6. Document adapter usage and extension steps in `docs/data-adapters.md`.
```

---

## Prompt 4 – Card-Level Responsiveness and Diagnostics
```
You are Codex, a front-end performance specialist. Ensure each dashboard card handles overflow and diagnostics gracefully:

1. Audit card components and update them to:
   • Use CSS clamp() for typography.
   • Scale icons/gauges within the card using flexbox or SVG viewBox adjustments.
   • Display inline diagnostics when data is missing or stale.

2. Remove any residual assumptions about global scaling or fixed canvas sizes.

3. Add targeted tests to confirm cards render without overlap at varied container sizes and when data is incomplete.
```

---

## Prompt 5 – Build Outputs and Artifact Size
```
You are Codex, a build tooling expert. Optimize build outputs:

1. Configure production vs. debug builds using esbuild/rollup:
   • Production: tree-shaken, minified, no diagnostics overlays.
   • Debug: retains logging and status overlays.

2. Ensure renderer/host/data modules compile into small bundles, measuring bundle sizes.

3. Update documentation (`docs/build-and-deploy.md`) with build commands, artifact expectations, and deployment steps for Hubitat, preview app, and standalone HTML.
```

---

## Prompt 6 – Testing Strategy and Manual Verification
```
You are Codex, a QA-focused engineer. Finalize the testing plan:

1. Expand automated Jest suites to cover:
   • Renderer behavior across multiple container sizes and layout overrides.
   • Host coordination of resize/data events.
   • Data adapters with mocked responses and error handling.

2. Document which tests run in CI vs. which require Hubitat manual verification. Provide stubs or instructions for manual Hubitat checks in `docs/testing-guide.md`.

3. Ensure `npm test` runs all relevant suites and update CI configuration if needed.
```

---

## Prompt 7 – Final Documentation Sweep
```
You are Codex, a documentation-focused engineer. Polish the docs:

1. Cross-link renderer contract, data adapters, deployment flows, testing guide, and build instructions.
2. Summarize the architecture and host/renderer interaction in `README.md`.
3. Verify all diagrams or references are consistent with the new renderer contract.
```

---

## Usage Notes
- Run each prompt with a clean working tree and ensure tests pass before moving on.
- Adjust prompt order if a previous prompt uncovers missing prerequisites.
- When extending for additional data sources, replicate the adapter pattern introduced above.

