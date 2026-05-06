# Backup And Recovery

Weather Dashboard backups are JSON documents generated from **Apps -> Weather Dashboard App -> Backup & Recovery**. Export writes a timestamped file to Hubitat File Manager using this name format:

```text
weather-dashboard-backup-YYYYMMDD-HHMMSS.json
```

The app can look for Weather Dashboard backup files in File Manager, show matching `weather-dashboard-backup-*.json` files in a selector, and load the selected file for validation and import. The file list uses Hubitat's File Manager JSON endpoint, so the manual filename field remains available as a fallback.

If a backup file is on your workstation, upload that JSON file to the destination hub through Hubitat File Manager first. Recovery in this app only works with files already present in File Manager.

## When To Export

Create a new backup:

- After initial app setup.
- After adding, removing, or remapping weather, rain, wind, lightning, air quality, or ambient sensors.
- After changing unit, refresh, layout, forecast, wind average, or pressure baseline settings.
- Before upgrading the app code.

## What Is Included

The export includes:

- Non-secret app configuration, including selected devices, attribute mappings, units, refresh settings, layout JSON, and dashboard label.
- Device references with IDs and labels so restores can identify unresolved devices.
- Durable calculation state used for rainfall display, lightning statistics, temperature trending, wind averaging, pressure tendency/rate/baseline, forecast diagnostics, daily extrema, and recent payload recovery.

The export excludes:

- Maker API token.
- Weather Dashboard app access token.

Treat backup files as operational data. They do not contain tokens, but they can reveal device names, hub configuration, and weather history.

## Same-Hub Restore

1. Open **Backup & Recovery**.
2. Click **Refresh Backup File List**.
3. Select an existing backup file.
4. Click **Load Selected File**.
5. If the selector cannot find a backup file you know exists, enter the exact File Manager filename or `/local/` path and click **Load Selected File**.
6. Click **Validate Import**.
7. Review warnings, unresolved devices, and optional missing-secret notices.
8. Click **Apply Import**.
9. Open **Configure data sources**, confirm devices and mappings, then save and refresh.
10. Re-enter and validate the Maker API token if you use the embedded preview or external clients.

## Different-Hub Migration

1. Install the app and driver on the destination hub.
2. Download or copy the backup file from the source hub File Manager to your workstation if needed.
3. Upload the backup JSON file to the destination hub through Hubitat File Manager.
4. Open **Backup & Recovery** on the destination hub, refresh the backup file list, and load the uploaded file.
5. Validate and apply the backup.
6. Open **Configure data sources** and reselect any unresolved devices using the labels from the import report.
7. Re-enter the Maker API token if needed, or click **Skip Maker API Token**.
8. Save and refresh.

Maker API is optional. The Hubitat dashboard tile reads the virtual device attributes and can operate without Maker API. Maker API is only needed for the app landing-page preview and external clients that fetch the dashboard payload through Maker API.

## Troubleshooting

- **Backup JSON is not valid:** confirm the selected File Manager file is a complete Weather Dashboard backup JSON document.
- **Unsupported schema version:** import with an app version that supports that backup schema.
- **Unresolved device:** reselect the matching device in **Configure data sources**. Device labels in the report come from the backup.
- **Missing Maker API token:** paste the token from the Maker API app and validate it, or skip it.
- **Preview disabled after import:** confirm Maker API base URL, app ID, token, and authorized dashboard device IDs.

## Developer Maintenance

Backup coverage is allowlist-based by design. When adding a feature, update export/import before release if the feature adds any:

- New app setting needed to configure operation.
- New durable `state` key used for history, totals, counts, trends, averages, forecasts, or diagnostics.
- New device selector or attribute mapping.
- New cache that would be expensive or behaviorally important to rebuild after recovery.

Also update the Groovy smoke tests so missing backup coverage is visible during development.
