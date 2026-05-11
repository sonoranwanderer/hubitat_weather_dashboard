# Dashboard Layout Configuration

The Weather Dashboard app includes a **Layout configuration JSON** setting on **Dashboard Setup**. Use it to change the size and placement of dashboard cards without editing `dashboard/weather-dashboard.js`. This setting controls the JavaScript renderer inside `tile-0`; the generated Hubitat Dashboard import JSON on the same page controls Hubitat's grid and tile placement.

The renderer builds one CSS grid inside the visible Hubitat Dashboard tile. Each row in the JSON defines one grid row, and each item in that row's `columns` array names the card that should occupy that column.

## Card Names

Use these area names in `columns`:

| Area name | Card |
| --- | --- |
| `temp-wind` | Temperature and wind |
| `ambient` | Ambient sensor rotation |
| `air` | Air quality |
| `rain` | Rain |
| `solar` | Sun and moon |
| `pressure` | Pressure and forecast |
| `lightning` | Lightning |
| `.` | Empty placeholder |

The `lightning` card only appears when lightning data is present. If your layout includes `lightning` but no lightning data is available, that grid area will be empty.

## Basic Shape

```json
{
  "baseWidth": 1200,
  "baseHeight": 900,
  "trackUnit": "px",
  "desktop": {
    "columns": "repeat(2, minmax(0, 1fr))",
    "gap": "14px",
    "rows": [
      { "height": 450, "columns": ["temp-wind", "ambient"] },
      { "height": 140, "columns": ["air", "rain"] },
      { "height": 180, "columns": ["solar", "rain"] },
      { "height": 110, "columns": ["solar", "pressure"] }
    ]
  }
}
```

Top-level keys:

| Key | Meaning |
| --- | --- |
| `baseWidth` | Optional design canvas width. With pixel layouts, the default is `1200`. With percent layouts, the measured tile width is used when omitted. |
| `baseHeight` | Optional design canvas height. With pixel layouts, the default is `900`. With percent layouts, the measured tile height is used when omitted. |
| `trackUnit` | Optional track unit. Use `"px"` for numeric pixel tracks or `"percent"` for numeric percentage tracks. Defaults to `"px"`. |
| `desktop` | Layout used above 1100px wide. |
| `tablet` | Layout used at 1100px wide and below. |
| `mobile` | Layout used at 720px wide and below. |

Breakpoint keys can contain:

| Key | Meaning |
| --- | --- |
| `baseWidth` | Optional breakpoint-specific base width. |
| `baseHeight` | Optional breakpoint-specific base height. |
| `columns` | Grid column definition. Accepts a CSS grid string or an array of numeric tracks. |
| `gap` | CSS gap between rows and columns, such as `"14px"` or `"0.5rem"`. |
| `rows` | Array of row objects. Each row has a `height` and `columns`. |

## Default Layout

This is the default layout as JSON you can paste into the app setting:

```json
{
  "baseWidth": 1200,
  "baseHeight": 900,
  "trackUnit": "px",
  "desktop": {
    "columns": "repeat(2, minmax(0, 1fr))",
    "gap": "14px",
    "rows": [
      { "columns": ["temp-wind", "ambient"], "height": 450 },
      { "columns": ["air", "rain"], "height": 140 },
      { "columns": ["solar", "rain"], "height": 180 },
      { "columns": ["solar", "pressure"], "height": 110 }
    ]
  },
  "tablet": {
    "columns": "repeat(2, minmax(0, 1fr))",
    "gap": "14px",
    "rows": [
      { "columns": ["temp-wind", "ambient"], "height": 450 },
      { "columns": ["air", "rain"], "height": 140 },
      { "columns": ["solar", "rain"], "height": 180 },
      { "columns": ["solar", "pressure"], "height": 110 }
    ]
  },
  "mobile": {
    "columns": "repeat(2, minmax(0, 1fr))",
    "gap": "14px",
    "rows": [
      { "columns": ["temp-wind", "ambient"], "height": 450 },
      { "columns": ["air", "rain"], "height": 140 },
      { "columns": ["solar", "rain"], "height": 180 },
      { "columns": ["solar", "pressure"], "height": 110 }
    ]
  }
}
```

The compiled CSS grid is:

```css
grid-template-columns: repeat(2, minmax(0, 1fr));
grid-template-rows: 450px 140px 180px 110px;
grid-template-areas:
  "temp-wind ambient"
  "air rain"
  "solar rain"
  "solar pressure";
gap: 14px;
```

## Pixel Layouts

With `"trackUnit": "px"`, numeric row heights and numeric column values are interpreted as pixels.

```json
{
  "baseWidth": 1200,
  "baseHeight": 900,
  "trackUnit": "px",
  "desktop": {
    "columns": [600, 420, 160],
    "gap": "10px",
    "rows": [
      { "height": 290, "columns": ["temp-wind", "ambient", "lightning"] },
      { "height": 180, "columns": ["temp-wind", "rain", "rain"] },
      { "height": 150, "columns": ["solar", "rain", "rain"] },
      { "height": 140, "columns": ["solar", "pressure", "pressure"] },
      { "height": 100, "columns": ["air", "air", "air"] }
    ]
  }
}
```

With a `1200px` base width and a `10px` gap, three columns have `1180px` available because there are two column gaps. With a `900px` base height and five rows, the rows have `860px` available because there are four row gaps.

An array of numeric columns such as `[600, 420, 160]` becomes:

```css
grid-template-columns: 600px 420px 160px;
```

You can also use a CSS grid string when you need `fr`, `minmax`, or other CSS grid syntax:

```json
{
  "desktop": {
    "columns": "52fr 34fr 14fr"
  }
}
```

## Percent Layouts

With `"trackUnit": "percent"`, numeric row heights and numeric column values are interpreted as percentages. Decimal values are allowed.

```json
{
  "trackUnit": "percent",
  "desktop": {
    "columns": [52, 34, 14],
    "gap": "6px",
    "rows": [
      { "height": 32, "columns": ["temp-wind", "ambient", "lightning"] },
      { "height": 26, "columns": ["temp-wind", "rain", "rain"] },
      { "height": 1, "columns": ["solar", "rain", "rain"] },
      { "height": 27, "columns": ["solar", "pressure", "pressure"] },
      { "height": 14, "columns": ["air", "air", "air"] }
    ]
  }
}
```

The renderer reserves space for frame padding and grid gaps before applying percent tracks, so the layout remains inside the measured Hubitat tile.

The default pixel layout converted to percentages is:

```json
{
  "baseWidth": 1200,
  "baseHeight": 900,
  "trackUnit": "percent",
  "desktop": {
    "columns": "repeat(2, minmax(0, 1fr))",
    "gap": "14px",
    "rows": [
      { "columns": ["temp-wind", "ambient"], "height": 51.14 },
      { "columns": ["air", "rain"], "height": 15.91 },
      { "columns": ["solar", "rain"], "height": 20.45 },
      { "columns": ["solar", "pressure"], "height": 12.5 }
    ]
  }
}
```

The percentages above are based on the default row total of `880px`:

| Original height | Percent |
| --- | --- |
| `450px` | `51.14` |
| `140px` | `15.91` |
| `180px` | `20.45` |
| `110px` | `12.5` |

## Breakpoint Inheritance

You can define only `desktop` when tablet and mobile should follow the same structure.

```json
{
  "trackUnit": "percent",
  "desktop": {
    "columns": [52, 34, 14],
    "gap": "6px",
    "rows": [
      { "height": 32, "columns": ["temp-wind", "ambient", "lightning"] },
      { "height": 26, "columns": ["temp-wind", "rain", "rain"] },
      { "height": 1, "columns": ["solar", "rain", "rain"] },
      { "height": 27, "columns": ["solar", "pressure", "pressure"] },
      { "height": 14, "columns": ["air", "air", "air"] }
    ]
  }
}
```

If `tablet` is omitted, it inherits the desktop rows, columns, gap, and base dimensions. If `mobile` is omitted, it inherits from tablet.

You can override only the pieces that differ:

```json
{
  "trackUnit": "percent",
  "desktop": {
    "columns": [52, 34, 14],
    "gap": "6px",
    "rows": [
      { "height": 32, "columns": ["temp-wind", "ambient", "lightning"] },
      { "height": 26, "columns": ["temp-wind", "rain", "rain"] },
      { "height": 1, "columns": ["solar", "rain", "rain"] },
      { "height": 27, "columns": ["solar", "pressure", "pressure"] },
      { "height": 14, "columns": ["air", "air", "air"] }
    ]
  },
  "mobile": {
    "columns": "1fr",
    "rows": [
      { "height": 28, "columns": ["temp-wind"] },
      { "height": 18, "columns": ["ambient"] },
      { "height": 12, "columns": ["air"] },
      { "height": 18, "columns": ["rain"] },
      { "height": 14, "columns": ["solar"] },
      { "height": 10, "columns": ["pressure"] }
    ]
  }
}
```

## Spanning And Empty Space

A card spans rows or columns when the same area name appears in adjacent grid cells. In this example, `rain` spans two rows in the second column and `solar` spans two rows in the first column:

```json
{
  "desktop": {
    "rows": [
      { "height": 450, "columns": ["temp-wind", "ambient"] },
      { "height": 140, "columns": ["air", "rain"] },
      { "height": 180, "columns": ["solar", "rain"] },
      { "height": 110, "columns": ["solar", "pressure"] }
    ]
  }
}
```

Use `"."` for an empty grid cell. This is useful when you want one card to span more height than a neighboring card without placing another card in the open space.

```json
{
  "desktop": {
    "rows": [
      { "height": 220, "columns": ["temp-wind", "ambient"] },
      { "height": 200, "columns": ["temp-wind", "."] },
      { "height": 160, "columns": ["air", "rain"] },
      { "height": 200, "columns": ["solar", "rain"] },
      { "height": 160, "columns": ["solar", "pressure"] }
    ]
  }
}
```

The top offset for a card is the sum of all row heights before the first row containing that card. The card height is the sum of the rows it occupies, plus the gaps between those rows.

## Supported Track Values

For `height`, use one of:

| Value | Example |
| --- | --- |
| Number | `140` |
| CSS length | `"140px"`, `"10rem"`, `"20%"` |
| CSS flexible track | `"1fr"` |
| CSS function | `"minmax(120px, 1fr)"`, `"calc(100% - 20px)"`, `"clamp(100px, 20vh, 200px)"` |
| CSS variable | `"var(--my-row-height, 140px)"` |

For `columns`, use either:

```json
"columns": [52, 34, 14]
```

or:

```json
"columns": "minmax(0, 52fr) minmax(0, 34fr) minmax(0, 14fr)"
```

Numeric arrays honor `trackUnit`; CSS strings are used as written.

## Layout Diagnostics

The renderer snapshots every successful layout pass and exposes diagnostics on `window.weatherDashboard`.

Open the Hubitat dashboard in a browser, launch the developer tools console, and run:

```javascript
weatherDashboard.logLayoutDiagnostics();
```

The helper prints the host element, measured size, resolved base dimensions, source of each base value, and any percent-to-pixel conversions that were applied to rows or columns.

To inspect the raw object:

```javascript
const info = weatherDashboard.captureLayoutDiagnostics();
console.log(info.base, info.percentTracks);
```

To have diagnostics logged automatically after each layout application, set this before the dashboard script runs:

```javascript
window.__WDASH_DEBUG_LAYOUT__ = true;
```

## Practical Tips

Start by changing one breakpoint, usually `desktop`, and let tablet and mobile inherit it until the desktop layout is stable.

Use `"trackUnit": "percent"` when the dashboard tile may be resized often. Use `"trackUnit": "px"` when you want an exact design canvas.

Keep row percentages adding up near `100` for percent layouts. They do not have to be whole numbers.

If a card feels cramped, increase its row height before reducing font sizes. Most dashboard cards have internal responsive behavior, but they still need enough grid space.

After changing layout JSON, save the app settings and refresh the Hubitat dashboard browser tab.
