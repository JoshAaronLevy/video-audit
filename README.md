# Video Audit

Video Audit is a local Vite + React app with a coupled Express backend for scanning video folders and queueing selected audit results into Premiere Pro.

## Requirements

- Node.js and npm.
- Premiere Pro with UXP support, targeting Premiere Pro 26.0 or newer for the bridge plugin.
- UXP Developer Tool for loading the local plugin during development.
- Adobe Media Encoder for queued export jobs.

## Run The App

Install dependencies from the repo root and the backend folder:

```sh
npm install
npm --prefix backend install
```

Start the Vite frontend and Express backend together:

```sh
npm run dev
```

The frontend runs through Vite. The backend serves the local API used for folder audits and Premiere bridge requests.

## Premiere Bridge

The Premiere workflow uses a simple filesystem bridge:

```txt
~/VideoAudit/premiere-bridge/
  status.json
  requests/
  completed/
  failed/
  presets/
```

The backend creates these folders when `/api/premiere/status` or `/api/premiere/export-requests` runs. It does not call Premiere APIs directly. It only checks local readiness, validates selected videos and presets, and writes request JSON into `requests/`.

Optional backend env vars:

```txt
PREMIERE_BRIDGE_DIR=/absolute/or/~/path
PREMIERE_BRIDGE_HEARTBEAT_MAX_MS=30000
```

## Export Presets

Use real Adobe `.epr` export presets. For the MVP, place this file at:

```txt
~/VideoAudit/premiere-bridge/presets/h264-1080p-12mbps.epr
```

The UI shows the friendly preset label, but sends only the stable preset ID to the backend. The backend maps that ID to the `.epr` filename and rejects export requests when the file is missing or unreadable.

## Load The UXP Plugin

1. Open Premiere Pro.
2. Open UXP Developer Tool.
3. Add the local `premiere-uxp/` folder as a plugin.
4. Load or Load & Watch the plugin.
5. In the plugin panel, select `~/VideoAudit/premiere-bridge/` as the bridge folder.
6. Select `/Users/joshlevy/Movies/Edited` as the output folder.
7. Keep the panel open while queueing requests from the Vite app.

When connected, the plugin writes `status.json` heartbeat updates. The Vite app checks `/api/premiere/status` on load and with the Retry button.

## MVP Limitations

- The browser never checks local processes or files directly; those checks stay in the backend.
- The backend does not call Premiere APIs.
- The plugin queues jobs in Adobe Media Encoder but does not start the queue automatically.
- The workflow creates one imported item, one Premiere sequence, and one AME queue item per selected video.
- The MVP does not do intelligent reframing, subject tracking, scene analysis, background job dashboards, WebSockets, accounts, or cloud processing.
- Do not parse or edit `.prproj` files directly.
