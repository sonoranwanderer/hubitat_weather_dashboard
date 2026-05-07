# Security Review

This review records the security posture for the Hubitat Weather Dashboard and
the branch/PR process for follow-up hardening work. The baseline assumption is a
LAN-first deployment: the hub, dashboards, and optional preview run on a trusted
local network. Maker API cloud access is still considered because enabling it
changes the exposure of token and payload issues.

## Threat Model

Trusted components:

- Hubitat Elevation hub firmware, built-in Dashboard, File Manager, and Maker API
  apps.
- Installed Weather Dashboard Groovy app and virtual device driver.
- Files uploaded by the owner to Hubitat File Manager from this repository.
- Weather and sensor devices selected by the owner.

Untrusted or less-trusted inputs:

- Query parameters passed to `/local/weather-dashboard-app.html`.
- Maker API responses and device attributes exposed to the browser.
- Dashboard Attribute tile text scanned by `dashboard/weather-dashboard.js`.
- Backup JSON files loaded from Hubitat File Manager.
- Layout override JSON entered in app preferences.
- Any network client that can reach the Hubitat app endpoint or Maker API URL.

Hubitat platform limits that shape the review:

- The app cannot rely on conventional web server middleware, request throttling,
  CSP headers, secure cookies, server-side sessions, or a dedicated secret vault.
- File Manager is static local hosting, not a hardened application boundary.
- Dashboard rendering intentionally uses Hubitat's tile HTML/script model.
- OAuth/app tokens and Maker API tokens are bearer secrets; possession is access.

## Risk Ranking

Every finding should include both severities.

| Rating | LAN-first meaning | Maker API cloud meaning |
| --- | --- | --- |
| Critical | Unauthenticated local control or broad payload disclosure | Internet-reachable token bypass, reusable token disclosure, or sensitive payload exposure |
| High | Token leakage, trusted-input XSS, unsafe import, or broad local data exposure | Token in URLs/logs/referrers/history, weak endpoint authorization, or cloud-accessible payload leakage |
| Medium | Malformed local input causes denial, stale data, misleading diagnostics, or limited disclosure | Brute-force friction gaps, excessive error detail, token lifecycle gaps, or weak cloud-risk documentation |
| Low | Hardening or documentation gap with limited practical exploitability | Defense-in-depth gap that matters mainly when cloud access is enabled |

Cloud exposure should usually raise severity for endpoint authorization, token
handling, logs, generated preview URLs, iframe behavior, and external-client
configuration.

## Current Findings

| ID | Area | Finding | LAN | Cloud | Follow-up |
| --- | --- | --- | --- | --- | --- |
| SEC-001 | Maker API preview | The embedded preview URL includes Maker API tokens in query parameters. This matches Hubitat/Maker API conventions, but URLs can be exposed through browser history, screenshots, copied links, Hubitat UI, proxy logs, and referrers. | High | Critical | `security-hardening-token-handling` |
| SEC-002 | Maker API cloud | Documentation recommends local access but does not clearly rank cloud access as higher risk or explain compensating controls. | Medium | High | `security-docs-maker-api-cloud` |
| SEC-003 | App endpoint | `/dashboard` checks a generated dashboard token and the configured Maker API token using a constant-time comparison. There is no platform-level rate limiting, so exposed cloud endpoints rely on bearer-token strength and network controls. | Medium | High | `security-hardening-token-handling` |
| SEC-004 | Backups | Backups intentionally exclude Maker API and dashboard access tokens. Backup files still contain operational data, device names, settings, and history that may be sensitive when shared. | Medium | Medium | `security-hardening-backup-import` |
| SEC-005 | Backup import | File Manager backup import validates document shape and allowlisted settings/state. Review should add adversarial import cases around oversized JSON, unexpected scalar types, and state values near Hubitat limits. | Medium | Medium | `security-hardening-backup-import` |
| SEC-006 | Browser rendering | App-preview status HTML escapes dynamic text before assignment, and dashboard data is parsed from JSON attributes. Review should keep all future `innerHTML` use behind escaping or trusted static templates. | Medium | High | `security-hardening-rendering` |
| SEC-007 | Iframe/postMessage | The preview iframe is sandboxed and resize messages are type-filtered, but parent message handling does not restrict sender origin because local File Manager and Hubitat app pages may not have stable comparable origins in all deployments. | Low | Medium | `security-hardening-rendering` |
| SEC-008 | Supply chain | Dependabot is enabled, local stub packages are vendored, and no PR CI currently enforces build/test verification. | Medium | Medium | `security-review-baseline` |

No finding in this baseline review proves an active unauthenticated bypass in
the current code. The highest risk is bearer-token exposure when Maker API cloud
access is enabled.

## Review Checklist

For each security PR, review these surfaces before merge:

- `hubitat/WeatherDashboardApp.groovy`: OAuth mappings, token creation, token
  comparison, endpoint responses, logging, backup export/import, File Manager
  access, layout parsing, and diagnostic rendering.
- `hubitat/WeatherDashboardDevice.groovy`: payload parsing, segment size limits,
  event values, dashboard script URL preference, and clear/update behavior.
- `app/weather-dashboard-app.js` and `app/weather-dashboard-app.html`: query
  parsing, token propagation, URL construction, `innerHTML`, iframe sandboxing,
  `postMessage`, fetch error handling, and status output.
- `src/render/index.js` and `src/adapters/hubitat-tiles.js`: trusted JSON
  boundaries, malformed tile handling, localStorage, DOM writes, and observer
  behavior.
- Documentation: Maker API local/cloud guidance, token rotation guidance,
  backup sensitivity, and manual validation steps.

## Branch And PR Process

Use small PRs with one security theme each:

- `security-review-baseline`: this document, README link, and CI workflow.
- `security-hardening-token-handling`: token display, rotation, generated URL
  handling, endpoint friction, and tests.
- `security-hardening-backup-import`: adversarial backup tests and import
  validation hardening.
- `security-hardening-rendering`: DOM write audit, iframe/postMessage hardening,
  and rendering regression tests.
- `security-docs-maker-api-cloud`: user-facing cloud-risk documentation and
  operational guidance.

PRs should include the LAN severity, cloud severity, acceptance tests, and any
Hubitat limitation that prevents a conventional web security control.

## Recommended Controls

- Prefer Maker API Local IP Address access. Enable Cloud only when the owner
  accepts that bearer-token URLs may be reachable from outside the LAN.
- Rotate Maker API tokens after sharing screenshots, logs, exported browser
  URLs, or support bundles that may include preview URLs.
- Keep the Weather Dashboard virtual device as the only Maker API-authorized
  device needed by this project.
- Do not publish backup files publicly; they exclude tokens but include device
  names, hub configuration, and weather history.
- Require PR CI before merging security-sensitive changes.
