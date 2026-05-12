# Standalone HTML Page

`app/weather-dashboard-app.html` can be opened directly from Hubitat File Manager or from another static host. In this mode it is a standalone dashboard page that fetches the Weather Dashboard virtual device payload through Hubitat Maker API.

For full Maker API setup, including how to authorize the Weather Dashboard virtual device and find the app ID/token, see [Maker API Setup](setup-maker-api.md).

## Upload the files

Upload these files to the Hubitat File Manager root:

- `dashboard/weather-dashboard.js`
- `app/weather-dashboard-app.js`
- `app/weather-dashboard-app.html`

With the default File Manager location, the standalone page is available at:

```text
http://<hub-ip>/local/weather-dashboard-app.html
```

## Required Maker API parameters

The standalone page needs Maker API credentials in the URL:

| Parameter | Required | Description |
| --- | --- | --- |
| `hubBaseUrl` | Yes | Hub base URL, such as `http://192.168.1.10`. |
| `appId` | Yes | Maker API application ID. |
| `makerToken` | Yes | Maker API access token. |
| `deviceIds` | Recommended | Comma-separated Weather Dashboard virtual device IDs authorized in Maker API. |

Example:

```text
http://<hub-ip>/local/weather-dashboard-app.html?hubBaseUrl=http://192.168.1.10&appId=123&makerToken=YOUR_TOKEN&deviceIds=45
```

The Hubitat dashboard tile does not need Maker API. Maker API is required only for the app landing-page preview and standalone/external clients that fetch the payload directly.

## Dashboard size

Use `width` and `height` to set the standalone dashboard viewport size in pixels:

```text
http://<hub-ip>/local/weather-dashboard-app.html?hubBaseUrl=http://192.168.1.10&appId=123&makerToken=YOUR_TOKEN&deviceIds=45&width=1000&height=700
```

Both values must be positive numbers. If either value is missing or invalid, the standalone page uses the browser viewport size.

These URL dimensions affect the standalone HTML page only. Layout JSON configured in the Hubitat app still controls the Hubitat dashboard tile. The standalone page derives same-ratio renderer base dimensions from the viewport so the dashboard fills the requested shape without distorting card contents.

## Supported page parameters

| Parameter | Description |
| --- | --- |
| `hubBaseUrl` | Hub base URL, such as `http://192.168.1.10`. Required for Maker API fetches. |
| `appId` | Maker API application ID. Required for Maker API fetches. |
| `makerToken` | Maker API access token. Required for Maker API fetches. |
| `deviceIds` | Comma-separated Weather Dashboard virtual device IDs authorized in Maker API. Recommended. |
| `width` | Standalone dashboard viewport width in pixels. Must be a positive number and is used only when `height` is also valid. |
| `height` | Standalone dashboard viewport height in pixels. Must be a positive number and is used only when `width` is also valid. |
| `statusBar` | Use `yes` or `no` to force the connection/status panel visible or hidden after successful renders. |
| `pollIntervalMs` | Refresh interval in milliseconds. The page enforces the supported minimum. |
| `maxBackoffMs` | Maximum retry backoff after failed Maker API requests. |
| `bundleBase` | Base path for `weather-dashboard.js` and `weather-dashboard-app.js` when they are hosted outside `/local/`. |
| `rendererScript` | Full URL/path override for `weather-dashboard.js`. |
| `appScript` | Full URL/path override for `weather-dashboard-app.js`. |

The canonical refresh parameters are `pollIntervalMs` and `maxBackoffMs`. The page also accepts these aliases:

- `pollInterval`, `interval`, `refresh`, and `refreshInterval` for `pollIntervalMs`
- `maxBackoff`, `backoff`, and `backoffMs` for `maxBackoffMs`

The standalone JavaScript also supports the same configuration values through an inline JSON script with `id="weather-dashboard-config"` or `data-weather-dashboard-config`. Query string values override inline JSON values.

## Troubleshooting

- If the page shows the loader indefinitely, confirm all three files are uploaded and reachable under `/local/`.
- If the page reports missing credentials, confirm `hubBaseUrl`, `appId`, and `makerToken` are present in the URL.
- If Maker API returns `401 Unauthorized`, recheck the token and confirm the Weather Dashboard virtual device is selected in Maker API.
- If the dashboard does not render data, open the Weather Dashboard virtual device and confirm its segment attributes are populated.
