# Temp & Wind Gauge Sizing – End-to-End Audit

This revision replaces the earlier summary with an exhaustive inventory of every style and script that influences the Temp & Wind gauges, starting from the dashboard container and ending with the inner labels. All references point to `dashboard/weather-dashboard.js` unless noted otherwise.

## 1. Layout stack from host tile to gauge wrapper

| Level | Source | Lines | Contribution to gauge space |
| --- | --- | --- | --- |
| Hubitat tile host | `renderDashboard()` markup | 367-374 | Injects `.wdash-root` inside the hub tile so the dashboard can manage its own scaling. |
| `.wdash-root` | CSS template | 3449 | Flex container that fills the tile, provides `--wdash-base-width/height`, and centers the rendered frame. |
| `.wdash-frame` | CSS template | 3450 | Holds the rendered dashboard at `--wdash-render-width/height`, clipping overflow. |
| `.wdash` | CSS template | 3451 & 3685-3689 | Defines the base 1200×900 drawing plane, frame padding (`--wdash-frame-gap`), and applies breakpoint-specific padding via CSS variables. All child sizing, including the gauges, occurs within this scaled plane. |
| Layout defaults (`DEFAULT_LAYOUT`, `DEFAULT_COLUMNS`, `DEFAULT_GAPS`) | 24-36, 39-71 | Provide the initial grid track sizes (desktop row 0 = 450 px) and gutter spacing that bound the Temp & Wind area before overrides. |
| Layout compilation (`compileGridTemplate`, `sanitize*`) | 3302-3438 | Normalizes template overrides so that any custom rows/columns still resolve to concrete track sizes used by the grid variables. |
| Layout application (`applyLayoutOverrides`, `setupScaling`) | 512-699 | Writes the compiled grid row/column/gap values and frame padding to CSS variables on `.wdash`, then applies the calculated scale to `.wdash-root`. |
| `.wdash-grid` | CSS template | 3452-3454 | Creates the CSS grid, consumes the row/column variables, and enforces the inter-card gap. The Temp & Wind card inherits its footprint from the `grid-area: temp-wind` slot here. |
| `.wdash-card` | CSS template | 3456 | Gives every card 12 px padding and 10 px internal gap between header / main / footer, reducing the raw area the gauges can occupy. |
| `.wdash-card--temp-wind` | CSS template | 3479-3482 | Narrows the vertical gap to 6 px, trims block padding to 5 px, keeps the header transparent, and provides custom properties used by the gauge overlays. |
| `.wdash-card-header--temp-wind` | CSS template | 3471-3474 | Aligns header elements and adds 10 px of padding below the title before the gauge row begins. |
| `.wdash-temp-wind-main` | CSS template | 3497-3499 | Declares the gauge row as a stretching horizontal flex container with a 14 px column gap. This container is what the sizing helper measures for available height when column hosts are absent. |
| `.wdash-temp`, `.wdash-wind` | CSS template | 3494-3501 | Set each column to `flex: 1`, `align-items: center`, and ensure `min-width/min-height: 0` so they expand to fill the card slot. Their bounding boxes are the authoritative “parent container” measurements for the gauges. |

## 2. Gauge and inner-element styling

| Element | Selector / Source | Lines | Effect on rendered size |
| --- | --- | --- | --- |
| Gauge host markup | Template HTML | 1035-1093 | Emits `<div class="wdash-gauge">` / `.wdash-wind-compass` wrappers and applies color-related custom properties, but no fixed width/height. |
| `.wdash-gauge`, `.wdash-wind-compass` | CSS template | 3502-3503 & 3535 | Absolutely position the SVG to fill the wrapper and leave width/height at 100%. The runtime inline size determines actual pixels. |
| `.wdash-gauge-svg` | CSS template | 3503 | Sets the SVG canvas to `position: absolute; inset: 0; width: 100%; height: 100%`, so it mirrors the wrapper size without further clamps. |
| `.wdash-gauge-center` | CSS template | 3504 | Applies a proportional inset (`--temp-wind-gauge-center-inset`, default 26 %) so the numeric hub scales with the wrapper. |
| `.wdash-gauge-current`, `.wdash-gauge-value`, `.wdash-gauge-label` | CSS template | 3505-3507 | Provide typographic rules. The font sizes are constant rem values; they do not change the wrapper size but govern legibility once the gauge is scaled. |
| `.wdash-wind-overlay`, `.wdash-wind-bearing`, `.wdash-wind-speed` etc. | CSS template | 3529-3538 | Use percentage-based insets so wind labels stay centered inside the compass without altering the gauge diameter. |
| `.wdash-metric-row--gauge` | CSS template | 3523-3527 | Limits only the footer metric presentation. It no longer constrains the gauge column width. |

## 3. Runtime JavaScript affecting gauge dimensions

| Function | Lines | Purpose |
| --- | --- | --- |
| `setupScaling(displayTile, content)` & `applyScale(root)` | 743-793 & 840-889 | Compute how the rendered 1200×900 dashboard should scale inside the hub tile and update `--wdash-scale`. This uniformly scales the card and gauges together. |
| `renderFromData()` and `renderLayout()` | 398-707 | Populate the grid, rebuild cards, and ensure the Temp & Wind markup exists so the sizing hooks can attach. |
| `setupInteractiveComponents()` | 1876-1895 | Entry point after each payload refresh that ensures gauge sizing remains active. |
| `setupTempWindGaugeSizing()` | 2395-2436 | Locates `.wdash-temp` / `.wdash-wind`, reapplies any cached inline square dimensions, and registers the shared `ResizeObserver`. |
| `applyTempWindGaugeSize(host)` | 2443-2473 | Measures the host’s `getBoundingClientRect()`, takes `Math.min(width, height)`, rounds to the nearest tenth, and sets that value as inline `width` and `height` on the immediate `.wdash-gauge` / `.wdash-wind-compass` child. This is the only code path that writes explicit pixel sizes. |
| `teardownTempWindGaugeSizing()` | 2379-2393 | Clears observers and inline sizing only when the card is removed, ensuring steady dimensions during normal refreshes. |

No other JavaScript alters the gauge size: ambient rotation, data polling, and metric updates operate on separate DOM nodes and do not touch the gauge wrappers after `applyTempWindGaugeSize` runs.

## 4. Inline styles and attributes

| Element | Source | Effect |
| --- | --- | --- |
| `.wdash-root` | Markup (line 369) | Sets initial `--wdash-base-width/height` custom properties used for scaling. |
| `.wdash-gauge` / `.wdash-wind-compass` | `applyTempWindGaugeSize` | Receives inline `style="width: Npx; height: Npx;"` plus the color-related custom properties already emitted by the template. These square dimensions propagate to the SVG and overlays via the 100% width/height rules. |
| `.wdash-temp-wind-main` | Markup | Uses no inline sizing; relies entirely on CSS flex growth described above. |
| SVG child elements | Template | Use intrinsic coordinates (`viewBox="0 0 100 100"`) so scaling the parent wrapper scales the drawing proportionally. No additional runtime transforms adjust their size. |

## 5. Previously conflicting inputs (now removed)

- `teardownTempWindGaugeSizing()` is no longer called during routine data refreshes, so inline widths persist until the card is truly removed. (lines 1876-1895 & 2379-2436)
- The `.wdash-gauge-svg` inset clamp (`calc(100% - 22%)`) was deleted in the prior change set, leaving the SVG to fill its parent without subtracting padding. (lines 3503-3504)
- Observer callbacks now always trigger `applyTempWindGaugeSize` without feeding `contentRect`, so manual and observer measurements rely on the same bounding box. (lines 2406-2473)

## 6. Verification scope

This audit now covers:

1. Every layout container between the hub tile and the gauge wrappers.
2. All CSS selectors that affect the gauge wrappers, SVG canvas, center hub, and textual overlays.
3. All JavaScript functions that can write size information or scale the containing layout.
4. Inline styles that originate from markup or runtime helpers.

No additional CSS or JavaScript in the repository applies explicit width, height, max-size, or scaling constraints to the Temp & Wind gauges beyond what is listed above. Any future sizing regression would therefore originate from changes to these documented sources.
