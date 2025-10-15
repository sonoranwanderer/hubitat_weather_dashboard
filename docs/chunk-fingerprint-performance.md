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
* **Layout metadata.** During the first slicing pass the driver now records the
  unescaped character offset and length for every chunk and attaches that map to
  each envelope (`chunkOffset`, `chunkLength`, `chunkOffsets`, `chunkLengths`,
  and `chunkTotalLength`). The bookkeeping reuses the existing slicing loop and
  only appends a handful of integers to each JSON envelope, keeping the per-
  chunk cost bounded well below the 1,024-character attribute limit even when
  all ten chunk slots are used.【F:hubitat/WeatherDashboardDevice.groovy†L120-L151】
* **Chunk size growth.** The added fields increase each envelope by roughly 80
  bytes (two numeric properties plus two short arrays). Even with ten chunks the
  payload expands by <1 KB, which remains inside Hubitat’s attribute ceiling and
  does not change the number of driver allocations because the same JSON slices
  are reused when the `sendEvent` calls fire.【F:hubitat/WeatherDashboardDevice.groovy†L120-L151】

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
  reader seeds a character buffer with the last successful payload and overlays
  any newer chunk slices at the offsets published by the driver. Missing ranges
  fall back to the cached payload, so the work is still linear in the number of
  chunk envelopes and bounded by a few string copies before parsing.【F:dashboard/weather-dashboard.js†L2060-L2217】
* **Metadata merge.** Whether the payload comes from a complete group or a
  composite reconstruction, the script merges the chunk count, fingerprint, and
  the resolved layout map into the payload metadata via a few property
  assignments after parsing, keeping the overhead trivial compared with the
  DOM update that follows.【F:dashboard/weather-dashboard.js†L2025-L2051】【F:dashboard/weather-dashboard.js†L2194-L2206】

In practice the browser sees the same asymptotic complexity as before and the
observable cost remains dominated by parsing the merged JSON payload and
updating the DOM.
