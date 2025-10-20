# Temp & Wind Gauge Sizing – Follow-up Audit

This addendum replaces the earlier sizing summary and documents every current CSS and JavaScript input that still affects the Temp & Wind gauges inside `dashboard/weather-dashboard.js`. It also calls out the conflicting logic that let two different measurements fight over the live gauge diameter.

## Active layout and CSS inputs

| Source | Location | Effect |
| --- | --- | --- |
| `DEFAULT_LAYOUT.desktop.rows[0]`, `tablet.rows[0]`, `mobile.rows[0]` | `dashboard/weather-dashboard.js` lines 26-34 | Establish the base grid row heights (450 px desktop) for the Temp & Wind track. Those row heights bound the vertical space the gauges can ever inherit. |
| `.wdash-card` | lines 3437-3442 | Applies the shared card padding (12 px on all sides) and `gap: 10px` between the header, main slot, and footer. Even when the Temp & Wind card overrides its block padding, this shared chrome still consumes vertical room. |
| `.wdash-card--temp-wind` | lines 3451-3456 | Narrows the section gap to 6 px, trims the card’s block padding to 5 px, and exposes inset custom properties used by the SVG artwork. No width or height clamp remains here. |
| `.wdash-temp-wind-main` | lines 3470-3474 | Declares the gauge row as a horizontal flex container with `flex: 1` so it stretches to absorb the available track height. Its `gap: 14px` reserves horizontal breathing room between the temperature and wind columns. |
| `.wdash-temp`, `.wdash-wind` | lines 3466-3474 | Make each column a vertical flex stack, `flex: 1`, and `align-items: stretch`. Because the gauges consume 100 % of their host’s width/height, these hosts define the drawing box. |
| `.wdash-gauge`, `.wdash-wind-compass` | lines 3478-3484 | Keep the wrappers square, position their contents absolutely, and default to `width: 100%; height: 100%`. Inline styles applied by the runtime now determine the concrete pixel diameter. |

## Runtime sizing code

| Function | Location | Effect |
| --- | --- | --- |
| `setupInteractiveComponents` | lines 1876-1895 | Called after every payload refresh. It ensures the Temp & Wind sizing hooks exist alongside other interactive controls. |
| `setupTempWindGaugeSizing` | lines 2395-2436 | Locates the `.wdash-temp` and `.wdash-wind` hosts, reapplies the last stored size, and, when hosts change, rebuilds the ResizeObserver. It no longer tears everything down on each refresh, so prior inline dimensions remain stable. |
| `applyTempWindGaugeSize` | lines 2443-2473 | Measures each host via `getBoundingClientRect()`, takes the smaller dimension, rounds to the nearest tenth, and writes that value to the gauge wrapper’s inline `width`/`height`. This is now the sole producer of explicit gauge diameters. |
| `teardownTempWindGaugeSizing` | lines 2379-2393 | Disconnects the observer, removes the resize fallback, and clears any inline sizing when the card disappears. |

## What the previous report missed

1. **Repeated teardown/rebuild during data polling.** Every five seconds `renderFromData()` calls `setupInteractiveComponents()`, which in turn invoked `setupTempWindGaugeSizing()` after calling `teardownTempWindGaugeSizing()` unconditionally. That cycle stripped the gauges’ inline dimensions and then re-measured them, which is why the heartbeat reappeared as soon as the next payload arrived. The earlier report claimed only the observer loop was at fault and never mentioned this polling trigger.
2. **Mismatched measurement boxes.** `applyTempWindGaugeSize()` used `getBoundingClientRect()` during manual calls but trusted the `ResizeObserver`’s `contentRect` when the observer fired. Because the `contentRect` excludes borders and padding, the observer consistently reported a smaller box than the manual measurement, so the gauges toggled between two diameters on every update. The previous audit failed to note this discrepancy, leaving the duel in place.

## Conflicting inputs now identified

- The **manual measurement path** (initial setup and resize fallback) uses `getBoundingClientRect()` to compute the host size.  
- The **observer callback** now invokes the same helper without passing the `contentRect`, forcing it to use `getBoundingClientRect()` as well.  
- The **data-refresh loop** no longer tears down observers or clears inline sizes when the host set is unchanged, so the gauges retain their dimensions between payloads instead of bouncing between two answers.

With both sources now aligned to a single measurement and the periodic teardown removed, the gauges receive one stable diameter taken directly from their parent containers on load and only change when the parents themselves are resized.
