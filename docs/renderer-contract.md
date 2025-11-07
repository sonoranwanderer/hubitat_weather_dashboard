# Renderer Contract

The renderer entry point exposes a pure factory that converts measured host
dimensions, a layout description, and a snapshot of card data into DOM-ready
markup.  The module lives at `src/render/index.js` and exports the following
API:

```js
const { createRenderer, baseStyles } = require('../src/render');

const { markup, variables, styles } = createRenderer({
  width: 960,
  height: 540,
  layout,
  data
});
```

## `createRenderer({ width, height, layout, data })`

* **width / height** – numeric pixel measurements supplied by the host
  container.  The renderer does not perform internal scaling; instead it
  publishes the values as CSS custom properties so the host can size the root
  element directly.
* **layout** – JSON description of the grid.  Columns and rows accept arrays or
  template strings using fractional (`fr`) or percentage tracks.  Cards declare
  their position via `row`, `column`, `rowSpan`, and `colSpan` along with
  optional style hints such as `class`, `minWidth`, `minHeight`, or additional
  inline styles.
* **data** – snapshot object keyed by card identifier.  Primitive values render
  as a single metric, arrays become bullet lists, and objects may define
  `title`, `content`, or `metrics` collections.

The factory returns an object with three properties:

* **markup** – HTML string for the dashboard root and its cards.
* **variables** – map of CSS custom properties (`--wdash-width`,
  `--wdash-height`, `--wdash-grid-template-columns`, etc.) that the host should
  apply to the root element.  This map is sufficient to size the dashboard
  without any transform-based scaling.
* **styles** – baseline stylesheet covering the root grid container and
  responsive card layout.  Hosts can inject the string into a `<style>` element
  or merge it with their existing stylesheets.

## Layout language

A minimal layout description looks like this:

```json
{
  "columns": ["2fr", "1fr"],
  "rows": ["auto", "auto"],
  "gap": "18px",
  "cards": [
    { "id": "temperature", "row": 1, "column": 1, "colSpan": 1 },
    { "id": "wind", "row": 1, "column": 2 },
    { "id": "rain", "row": 2, "column": 1, "colSpan": 2, "minHeight": "220px" }
  ]
}
```

* Tracks can be expressed as fractional values (`1`, `2`, `3fr`), percentages,
  or advanced functions (`minmax`, `clamp`).
* Gaps accept pixel numbers, CSS length strings, or percentages.
* Cards default to a `rowSpan`/`colSpan` of `1` when the properties are omitted.
* Inline style hints are merged into the generated grid item styles, allowing
  cards to participate in responsive sizing without fixed transforms.

## Applying the result

1. Inject `styles` once per document to register the base dashboard rules.
2. Insert `markup` into the host container.
3. Iterate over `variables` and call `rootElement.style.setProperty(name, value)`
   so the dashboard picks up the measured width and height as well as the grid
   template definitions.
4. Render new markup whenever the data snapshot changes.  Re-apply the CSS
   variables if the container dimensions change.

Because the renderer does not reach outside of the provided arguments, hosts can
unit test the output without mocking DOM globals.
