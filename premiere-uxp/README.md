# Video Audit Premiere Bridge

This is the Premiere Pro UXP plugin for the Video Audit filesystem bridge.

## Requirements

- Premiere Pro 26.0 or newer.
- UXP Developer Tool.

## Development Loading

1. Open UXP Developer Tool.
2. Add this `premiere-uxp/` folder as a plugin.
3. Load or Load & Watch the plugin into Premiere Pro.
4. After `manifest.json` changes, fully unload and load the plugin again.

Start the web app and backend from the repo root:

```sh
npm run dev
```

## Bridge Setup

The plugin uses `localFileSystem: "request"`, so it must ask for folder access instead of reading arbitrary paths directly.

1. Click `Select bridge folder` and choose `~/VideoAudit/premiere-bridge/`.
2. Keep the panel open while processing import requests.

The backend creates the bridge folders when `/api/premiere/status`, `/api/premiere/import-requests`, or the deprecated compatibility route `/api/premiere/export-requests` runs. If the plugin asks for folder access before the backend has created the bridge folder, create `~/VideoAudit/premiere-bridge/` manually or load the Vite app and click Retry once.

The plugin writes:

```txt
~/VideoAudit/premiere-bridge/status.json
```

The backend writes requests to:

```txt
~/VideoAudit/premiere-bridge/requests/
```

## Runtime Flow

The plugin validates bridge access, writes heartbeat status, polls `requests/`, and imports each selected video into the active Premiere project. It moves successful requests to `completed/` with import details and failed requests to `failed/` with error information.

Automatic fixes are handled by the backend FFmpeg Auto-Fix workflow, not by Premiere or Adobe Media Encoder. The plugin still contains older export helpers for compatibility with old request files, but the active backend routes now write import-only requests.

## MVP Limitations

- Keep the plugin panel open while processing requests.
- The plugin does not parse or modify `.prproj` files directly.
- The plugin does not perform intelligent reframing, subject tracking, scene analysis, encoding, or automatic AME queue start.
