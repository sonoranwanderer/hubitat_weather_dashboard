# Maker API setup for the Weather Dashboard App

The Weather Dashboard App embeds a lightweight web bundle that calls Hubitat's Maker API to fetch the latest JSON payload and device metadata. Follow the steps below to install Maker API, authorize the Weather Dashboard App, and copy the credentials that power the in-app preview and any external dashboards.

## 1. Install the built-in Maker API app

1. In Hubitat, open **Apps** and click **Add Built-In App**.
2. Locate **Maker API** in the catalog and add it to your hub.
3. If Maker API already appears in your app list, you can reuse the existing instance—no additional installation is required.

> The Weather Dashboard configuration page detects whether Maker API is present. If the app is missing you will see a reminder to install it before the embedded preview can initialize.

## 2. Enable the required Maker API options

1. Open the Maker API app you just installed.
2. Under **Allow access via**, enable **Local IP Address**. Enable **Cloud** access only if you plan to load the dashboard from outside your LAN.
3. In **Allow access to these apps**, check **Weather Dashboard App** so Maker API can proxy requests to the app’s `/dashboard` endpoint.
4. In **Select devices**, include the **Weather Dashboard** virtual device. Add any other devices you plan to surface through Maker API powered dashboards.
5. Leave the optional POST/DELETE and event streaming features disabled unless you need them for other integrations—the Weather Dashboard bundle only performs read operations.
6. Click **Done** to save the configuration. Maker API displays the generated URLs, access token, and the app ID on the confirmation screen.

## 3. Copy credentials into Weather Dashboard App

1. Still inside Maker API, note the following values from the confirmation screen:
   - **Local URL** (or your preferred base URL)
   - **Application ID**
   - **Access Token**
   - Optional: the comma-separated list of device IDs you authorized, if you want to pre-populate it for future features
2. Navigate to **Apps → Weather Dashboard App → Configure data sources → Maker API access**.
3. Paste the hub base URL (for example `http://192.168.1.10`) and Maker API token into the matching fields. Provide device IDs if you want them surfaced in the embedded bundle’s query string.
4. Click **Done** to persist the changes.

Leaving the Maker API fields blank keeps the embedded preview disabled so the hub avoids any Maker API polling overhead until you are ready to use it.

## 4. Confirm the integration

1. Return to **Apps → Weather Dashboard App**.
2. The landing page should now display the embedded `/local/weather-dashboard-app.html` preview without credential warnings.
3. Use the **Open in new tab** action on the iframe (or copy the link) to verify the URL includes your Maker API token, hub base URL, and optional device IDs.
4. If the preview still reports missing credentials, revisit the Maker API settings to confirm the Weather Dashboard App remains authorized and the access token matches the value stored in the app preferences.

Once these steps are complete, both the in-app preview and any external dashboards can securely fetch the Weather Dashboard JSON via Maker API.
