# Maker API Setup

The Weather Dashboard App uses Hubitat's Maker API to load the landing-page preview bundle and, when configured, any separately hosted copy of `weather-dashboard-app.html`. This guide matches the settings exposed by `hubitat/WeatherDashboardApp.groovy`.

## 1. Upload the preview assets

Upload these files to Hubitat's **File Manager** so they are served from `/local/`:

- `dashboard/weather-dashboard.js`
- `app/weather-dashboard-app.js`
- `app/weather-dashboard-app.html`

Keep the files at the File Manager root unless you plan to override the preview paths with query parameters.

## 2. Install Maker API

1. In Hubitat, open **Apps** and click **Add Built-In App**.
2. Add **Maker API** if it is not already installed.
3. On the Maker API page, enable **Local IP Address** under **Allow access via**. Enable **Cloud** only if you need remote access.
4. Select the Weather Dashboard virtual device under **Select devices**.
5. Leave POST/DELETE and event streaming disabled unless another integration needs them.
6. Click **Done** and keep the Maker API confirmation values handy:
   - Local URL or hub base URL
   - Application ID
   - Access Token
   - Optional device IDs, if you want them embedded in the preview URL

## 3. Save the Weather Dashboard settings

1. Open **Apps → Weather Dashboard App → Configure data sources → Maker API access**.
2. Paste the Maker API hub base URL, Application ID, and Access Token into the matching fields.
3. Optionally paste the comma-separated device IDs that Maker API should include.
4. Click **Done**. Leaving the fields blank keeps the embedded preview disabled.

The app stores those values in `makerApiBaseUrl`, `makerApiAppId`, `makerApiToken`, and `makerApiDeviceIds`. When the settings are present, `buildDashboardEmbedUrl()` generates `/local/weather-dashboard-app.html` with the following query parameters:

- `hubBaseUrl` and `hub`
- `appId`
- `makerToken`, `makerApiToken`, and `token`
- `deviceIds` and `devices` when device IDs are configured

## 4. Confirm the integration

1. Return to **Apps → Weather Dashboard App**.
2. The landing page should render the embedded `/local/weather-dashboard-app.html` preview.
3. Click **Save & Refresh** if you rotate the Maker API token or change the authorized device list.
4. If the preview still reports missing credentials, confirm that the Weather Dashboard device remains selected in Maker API and that the saved app settings match the current Maker API values.

### Troubleshooting

- **404 in the preview frame** - Re-upload `app/weather-dashboard-app.html`, `app/weather-dashboard-app.js`, and `dashboard/weather-dashboard.js` to File Manager.
- **Custom asset locations** - Pass `bundleBase`, `rendererScript`, or `appScript` in the preview URL if you host the files somewhere other than `/local/`.
- **401 Unauthorized** - Recheck the Maker API Application ID and token in both Maker API and the Weather Dashboard app settings.
