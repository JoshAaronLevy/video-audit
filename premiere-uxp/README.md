# Video Audit Premiere Bridge

This is the Premiere Pro UXP plugin for the Video Audit filesystem bridge.

## Requirements

- Premiere Pro 26.0 or newer.
- UXP Developer Tool.
- Adobe Media Encoder for queued exports.

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
2. Click `Select output folder` and choose `/Users/joshlevy/Movies/Edited`.
3. Keep the panel open while processing requests.

The backend creates the bridge folders when `/api/premiere/status` or `/api/premiere/export-requests` runs. If the plugin asks for folder access before the backend has created the bridge folder, create `~/VideoAudit/premiere-bridge/` manually or load the Vite app and click Retry once.

The plugin writes:

```txt
~/VideoAudit/premiere-bridge/status.json
```

The backend writes requests to:

```txt
~/VideoAudit/premiere-bridge/requests/
```

Place the real Adobe export preset at:

```txt
~/VideoAudit/premiere-bridge/presets/h264-1080p-12mbps.epr
```

The repo does not generate this `.epr` file in JavaScript; export it from Adobe's preset workflow so Premiere and Adobe Media Encoder can read the native preset.

## Runtime Flow

The plugin validates bridge access, writes heartbeat status, polls `requests/`, imports each selected video into the active Premiere project, creates one 1920x1080 `Video Audit` sequence per video, and queues each sequence in Adobe Media Encoder with the selected `.epr` preset. It moves successful requests to `completed/` with queued job details and failed requests to `failed/` with error information.

The plugin only queues jobs in Adobe Media Encoder. It does not start the Media Encoder queue automatically.

## MVP Limitations

- Keep the plugin panel open while processing requests.
- Only the configured output folder `/Users/joshlevy/Movies/Edited` is supported.
- Only real `.epr` preset files are supported; encoding settings are not generated in JavaScript.
- The plugin does not parse or modify `.prproj` files directly.
- The plugin does not perform intelligent reframing, subject tracking, scene analysis, or automatic AME queue start.
