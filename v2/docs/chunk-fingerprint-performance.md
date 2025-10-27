# Chunk Fingerprint Performance Impact

This note summarizes the expected performance overhead introduced when the
Weather Dashboard chunk payloads include the optional `chunkFingerprint`
metadata, the per-chunk layout hints that describe how the payload was split,
and when the browser groups and composites chunk envelopes by fingerprint
before rendering.

## Hubitat Virtual Device

* **Fingerprint computation.** Every time `updateDashboardData` receives a
  payload larger than a single attribute (greater than 1,024 characters),
  `chunkPayload` generates a lightweight fingerprint that combines the current
  hub timestamp, a monotonic per-device counter stored in `state`, and the
  payload length. All three values are already available inside the driver so
  the work is limited to a few integer additions and base-36 conversions—no
  extra passes over the JSON and no sandboxed class imports are required.【F:hubitat/WeatherDashboardDevice.groovy†L107-L193】
* **Compact metadata.** To keep chunk counts low the driver now emits
  single-letter keys (`ns`, `i`, `c`, `fp`, `o`, `l`, `t`, `d`) inside each
  envelope. The shorter names convey the same namespace, index, count, and
  layout data while trimming dozens of characters per attribute so larger
  payloads still fit within the available tiles.【F:hubitat/WeatherDashboardDevice.groovy†L261-L271】
* **Layout metadata.** During the slicing pass the driver tracks the raw offset
  and length for every chunk and adds those compact fields (`o`, `l`, and `t`)
  to each envelope. The bookkeeping reuses the existing loop and does not
  require extra allocations beyond a few integers per chunk, so the overhead
  stays well within the 1,024-character attribute limit.【F:hubitat/WeatherDashboardDevice.groovy†L195-L271】
* **Chunk size control.** Each slicing pass grows a chunk character by character
  while simulating the fully encoded envelope against a tunable target length.
  If any resulting chunk still exceeds Hubitat’s 1,024-character limit, the
  driver tightens the target and rebuilds the slices until every envelope fits
  (or logs an error and emits a small placeholder when the payload cannot be
  represented within the ten available attributes). The work stays in the same
  O(n) loop and does not add extra allocations beyond the retry bookkeeping.【F:hubitat/WeatherDashboardDevice.groovy†L120-L244】

Overall, the Hubitat hub performs one extra O(n) pass over the payload string
plus a small constant increase in per-chunk attribute size. Both additions are
minor compared with the existing JSON slicing loop and the platform’s event
handling overhead.

## Browser Dashboard Script

* **Grouping logic.** On every refresh the browser scans up to ten chunk tiles,
  groups the envelopes by fingerprint (or by `c` for legacy payloads), and
  reassembles the newest complete group using the timestamp/sequence embedded
  in the fingerprint. The work remains O(n) with n ≤ 10, so the extra grouping
  and comparison steps stay negligible next to `JSON.parse` and DOM
  updates.【F:dashboard/weather-dashboard.js†L270-L327】【F:dashboard/weather-dashboard.js†L1970-L2168】
* **Composite assembly.** When a complete fingerprint is not yet available the
  reader seeds a character buffer with the last successful payload, derives the
  layout by walking the available chunk metadata, and overlays newer slices at
  those offsets. Missing ranges fall back to the cached payload, so the work
  stays linear in the number of chunk envelopes and bounded by a few string
  copies before parsing.【F:dashboard/weather-dashboard.js†L2171-L2279】
* **Metadata merge.** Whether the payload comes from a complete group or a
  composite reconstruction, the script merges the chunk count, fingerprint, and
  the resolved layout map into the payload metadata via a few property
  assignments after parsing, keeping the overhead trivial compared with the
  DOM update that follows.【F:dashboard/weather-dashboard.js†L2145-L2265】

In practice the browser sees the same asymptotic complexity as before and the
observable cost remains dominated by parsing the merged JSON payload and
updating the DOM.
