# Temp & Wind Card Layout Controls

This reference summarizes every selector in `dashboard/weather-dashboard.js` that influences the Temp & Wind card sizing and spacing, along with notes about how they interact. Use it to determine where apparent "dead space" comes from and which rules overlap when you tune the layout.

## Grid placement and scene sizing

| Selector / Constant | Location | Effect |
| --- | --- | --- |
| `DEFAULT_LAYOUT.desktop.rows[0]` (height `450`) | `weather-dashboard.js` lines 19-41 | Sets the grid row height for the Temp & Wind area on desktop. The card will always consume 450px of the base canvas height unless overridden by layout metadata. |
| `DEFAULT_LAYOUT.tablet.rows[0]` (height `380`) | lines 31-37 | Tablet row height for Temp & Wind. |
| `DEFAULT_LAYOUT.mobile.rows[0]` (height `360`) | lines 39-46 | Mobile row height. |
| `.wdash-grid` | lines 2256-2262 | Applies the compiled grid template (rows, columns, gaps). The Temp & Wind card occupies `grid-area: temp-wind`. Changes to the grid template or gap values shift how much space surrounds the card externally. |
| `layoutState` / layout overrides | lines 51-90, 2005-2150 | Allow runtime overrides of base width, height, row sizing, and gaps. If the Temp & Wind row height is large, trimming internal padding alone will not shorten the card. |

## Shared card chrome

| Selector | Location | Effect |
| --- | --- | --- |
| `.wdash-card` | lines 2263-2266 | Base padding of 12px on all sides and a default vertical `gap: 10px` between the header, main body, and footer. Even if the Temp & Wind override sets `padding-block`, the side padding and base gap still come from this rule. |
| `.wdash-card-header` | lines 2267-2271 | Aligns the header contents. No direct spacing below, but participates in the `.wdash-card` gap. |

## Temp & Wind specific rules

| Selector | Location | Effect |
| --- | --- | --- |
| `.wdash-card--temp-wind` | lines 2406-2409 | Overrides the base card with `gap: 6px` (spacing between header, gauge section, and footer) and `padding-block: 5px` (top/bottom padding). It also exposes `--temp-wind-gauge-size`, the runtime-controlled maximum diameter for the instruments. |
| `.wdash-card--temp-wind .wdash-temp-wind-main` | line 2409 | Adds `padding-block: 2px` above and below the gauges inside the main section. This padding persists even if the card-level padding is reduced. |
| `.wdash-card--temp-wind .wdash-gauge`, `.wdash-card--temp-wind .wdash-wind-compass` | lines 2407-2408 | Tie the gauge and compass size to `min(100%, --temp-wind-gauge-size)`. The runtime now updates that variable to the full available height (up to the column width), so the instruments expand beyond the historical 260px ceiling when extra headroom exists. |
| `.wdash-card--temp-wind .wdash-metric-row--gauge` | line 2408 | Keeps the metric band centered and constrains its width to the same `--temp-wind-gauge-size`, so it mirrors the live instrument diameter. |
| `.wdash-temp-wind-main` | lines 2417-2418 | Defines the gauge row as a horizontal flex container, fills remaining height with `flex: 1`, and introduces a `gap: 14px` between the temperature and wind columns. The `flex: 1` setting allows the row to expand to fill the track; removing it can collapse the gauges. |
| `.wdash-temp`, `.wdash-wind` | lines 2415-2416 | Set each column to a vertical flex stack, `flex: 1`, and `align-items: center`. Their `flex: 1` values mirror each other and ensure both columns grow to the same height, so gauge diameters match. |
| `.wdash-temp`, `.wdash-wind` (second declaration) | lines 2420-2421 | Reiterates center alignment for each column. |
| `.wdash-temp-wind-details` | line 2419 | Controls spacing/alignment of the extrema row; contributes to vertical content but not the gauge gap. |

## Gauge geometry

| Selector | Location | Effect |
| --- | --- | --- |
| `.wdash-gauge`, `.wdash-wind-compass` | lines 2422-2423 | Provide the base square aspect ratio, cap the diameter at `min(100%, 260px)` by default, and center gauges with `margin: 0 auto`. The Temp & Wind override above tightens this cap dynamically. |
| `.wdash-gauge-svg` | line 2423 | Insets the temperature SVG by 11% of the wrapper size. |
| `.wdash-wind-compass svg` | line 2453 | Insets the compass artwork similarly. |
| `.wdash-wind-overlay` | line 2447 | Places the wind speed/bearing overlay within the compass, contributing to visual spacing. |

## Metric rows and footer content

| Selector | Location | Effect |
| --- | --- | --- |
| `.wdash-metric-row` | lines 2433-2434 | Applies `gap: 10px` to the metrics container. |
| `.wdash-metric-row--gauge` | line 2408 | Centers the metrics row under the gauges (`margin: 0 auto`) with a `gap: 4px 12px` and constrains its width to `--temp-wind-gauge-size` so it mirrors the instrument diameter. |
| `.wdash-metric` | line 2434 | Adds `padding: 6px 8px` inside each metric tile. |

## Responsive overrides

| Selector | Location | Effect |
| --- | --- | --- |
| `@media (max-width: 1100px)` | lines 2450-2453 | Swaps to the tablet grid template (row height 380px). |
| `@media (max-width: 720px)` | lines 2457-2463 | Reduces global card padding to 10px and stacks metric rows vertically. The Temp & Wind card inherits these adjustments in addition to its specific overrides. |

## Runtime sizing helpers

| Function | Location | Effect |
| --- | --- | --- |
| `setupTempWindGaugeSizing` / `teardownTempWindGaugeSizing` | lines 1560-1585 | Attach a `ResizeObserver` (or window resize fallback) to the Temp & Wind card, scheduling gauge recalculations whenever the card height changes. The setup routine now reapplies the last measured gauge size immediately so redraws do not flash back to the 260px default before the observer fires. |
| `applyTempWindGaugeSizing` | lines 1587-1652 | Measures the card’s available vertical space (subtracting header height, metric row height, padding, and flex gaps) and writes the result to `--temp-wind-gauge-size`, capped only by the column width. The helper also caches the normalized size so freshly rendered markup can reuse it before the next resize event. This lets the gauges shrink automatically when you reduce the grid row height (e.g., to 350px) without overflowing the card while also stretching to absorb surplus space. |

## Overlapping influences

1. **Card padding vs. main-section padding** – Even if `.wdash-card--temp-wind` sets `padding-block: 0`, the `.wdash-temp-wind-main` still adds 2px above/below the gauges. The base `.wdash-card` rule also keeps 12px of left/right padding.
2. **Card gap vs. header/footer margins** – The 6px gap between sections interacts with the metric row’s own internal padding. Removing the card gap leaves the metric row’s padding (6px vertical) and any font line-height, so visual spacing remains.
3. **Row height vs. flex growth** – The grid row height (450px desktop by default) is still the dominant constraint. `flex: 1` on `.wdash-temp-wind-main` stretches the gauge row, but once the runtime sizing logic reduces `--temp-wind-gauge-size`, the flex item shrinks with it. To tighten the card globally, lower the grid row height via the layout overrides.
4. **Gauge max width vs. column flex** – The runtime gauge size now grows to the full available height, only stopping once it reaches the column width. If the column itself is narrow, surplus space can still appear; widening the card or column gives the gauges more room to expand.
5. **Metric padding** – The metrics retain their own padding and background height. Even with zero gap, the combined height of the metric row (padding + line height) can make the card feel spacious.

## Practical tuning order

1. **Adjust grid row height** (`layoutOverride.desktop.rows[0].height`) to reclaim vertical space globally. The gauges now follow that height automatically, shrinking toward zero when space is tight and expanding until they hit the column width.
2. **Tighten section gaps** by editing `.wdash-card--temp-wind` gap and `.wdash-temp-wind-main` padding.
3. **Scale metrics** by reducing `.wdash-metric` padding or font sizes if further compaction is needed.
4. **Update gauge limits** only if you need the instruments themselves to shrink below the runtime calculation; by default they already grow or shrink to fit the available height.

These overlapping selectors explain why zeroing `.wdash-card--temp-wind` padding alone did not visibly shrink the space—the grid row height and inner wrapper padding still reserve room between the header, gauges, and footer.
