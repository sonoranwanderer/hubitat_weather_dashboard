# Chunk Fingerprint Performance Impact

This note summarizes the expected performance overhead introduced when the
Weather Dashboard chunk payloads include the optional `chunkFingerprint`
metadata and when the browser groups chunk envelopes by fingerprint before
rendering.

## Hubitat Virtual Device

* **Fingerprint computation.** Every time `updateDashboardData` receives a
  payload larger than a single attribute (greater than 1,024 characters),
  `chunkPayload` now generates a lightweight fingerprint that combines the
  current hub timestamp, a monotonic per-device counter stored in `state`, and
  the payload length. All three values are already available inside the driver
  so the work is limited to a few integer additions and base-36 conversions—no
  extra passes over the JSON and no sandboxed class imports are required.【F:hubitat/WeatherDashboardDevice.groovy†L116-L163】
* **Chunk size growth.** Each emitted chunk carries roughly 34 extra bytes of
  JSON: the `"chunkFingerprint"` property name, delimiters, and the short
  base-36 token. Even a 10-chunk payload therefore grows by only ~340 bytes,
  which is still well within the 1,024-character attribute budget. Memory churn
  is unchanged because the same number of chunk strings are allocated before the
  `sendEvent` calls.【F:hubitat/WeatherDashboardDevice.groovy†L134-L151】

Overall, the Hubitat hub performs one extra O(n) pass over the payload string
plus a small constant increase in per-chunk attribute size. Both additions are
minor compared with the existing JSON slicing loop and the platform’s event
handling overhead.

## Browser Dashboard Script

* **Grouping logic.** On every refresh the browser now scans up to ten chunk
  tiles, groups the envelopes by fingerprint (or by `chunkCount` for legacy
  payloads), and reassembles the newest complete group using the
  timestamp/sequence embedded in the fingerprint. The work remains O(n) with
  n ≤ 10, so the extra grouping and comparison steps stay negligible next to
  `JSON.parse` and DOM updates.【F:dashboard/weather-dashboard.js†L232-L318】【F:dashboard/weather-dashboard.js†L1932-L2099】
* **Metadata merge.** When a matching group is parsed, the script still adds
  the `chunkFingerprint` and chunk count to the existing `metadata` object. The
  cost is unchanged from the earlier SHA/CRC versions because the work is a
  handful of property assignments after the JSON payload has been parsed.【F:dashboard/weather-dashboard.js†L2002-L2006】

In practice the browser sees the same asymptotic complexity as before and the
observable cost remains dominated by parsing the merged JSON payload and
updating the DOM.
