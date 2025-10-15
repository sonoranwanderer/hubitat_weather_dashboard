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
  extra passes over the JSON and no sandboxed class imports are required.【F:hubitat/WeatherDashboardDevice.groovy†L116-L167】
* **Layout metadata.** During the slicing pass the driver tracks the raw offset
  and length for every chunk and adds those fields (`chunkOffset`, `chunkLength`,
  and `chunkTotalLength`) to each envelope. The bookkeeping reuses the existing
  loop and does not require extra allocations beyond a few integers per chunk,
  so the overhead stays well within the 1,024-character attribute limit.【F:hubitat/WeatherDashboardDevice.groovy†L118-L169】
* **Chunk size control.** Each slice is extended character by character until
  the fully encoded JSON envelope would exceed Hubitat’s 1,024-character limit,
  so the driver never emits an oversized event even when the payload contains
  many escaped characters. The trimming happens inside the existing slicing loop
  and reuses the same `sendEvent` strings, so there is no extra allocation churn.【F:hubitat/WeatherDashboardDevice.groovy†L134-L169】

Overall, the Hubitat hub performs one extra O(n) pass over the payload string
plus a small constant increase in per-chunk attribute size. Both additions are
minor compared with the existing JSON slicing loop and the platform’s event
handling overhead.

## Browser Dashboard Script

* **Grouping logic.** On every refresh the browser scans up to ten chunk tiles,
  groups the envelopes by fingerprint (or by `chunkCount` for legacy payloads),
  and reassembles the newest complete group using the timestamp/sequence
  embedded in the fingerprint. The work remains O(n) with n ≤ 10, so the extra
  grouping and comparison steps stay negligible next to `JSON.parse` and DOM
  updates.【F:dashboard/weather-dashboard.js†L231-L320】【F:dashboard/weather-dashboard.js†L1940-L2123】
* **Composite assembly.** When a complete fingerprint is not yet available the
  reader seeds a character buffer with the last successful payload, derives the
  layout by walking the available chunk metadata, and overlays newer slices at
  those offsets. Missing ranges fall back to the cached payload, so the work
  stays linear in the number of chunk envelopes and bounded by a few string
  copies before parsing.【F:dashboard/weather-dashboard.js†L2056-L2230】
* **Metadata merge.** Whether the payload comes from a complete group or a
  composite reconstruction, the script merges the chunk count, fingerprint, and
  the resolved layout map into the payload metadata via a few property
  assignments after parsing, keeping the overhead trivial compared with the
  DOM update that follows.【F:dashboard/weather-dashboard.js†L2025-L2051】【F:dashboard/weather-dashboard.js†L2194-L2206】

In practice the browser sees the same asymptotic complexity as before and the
observable cost remains dominated by parsing the merged JSON payload and
updating the DOM.
