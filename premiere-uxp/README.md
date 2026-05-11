# Video Audit Premiere Bridge

This is the Premiere Pro UXP plugin scaffold for the Video Audit filesystem bridge.

## Requirements

- Premiere Pro 26.0 or newer.
- UXP Developer Tool.
- Adobe Media Encoder for queued exports.

## Development Loading

1. Open UXP Developer Tool.
2. Add this `premiere-uxp/` folder as a plugin.
3. Load or Load & Watch the plugin into Premiere Pro.
4. After `manifest.json` changes, fully unload and load the plugin again.

## Bridge Setup

The plugin uses `localFileSystem: "request"`, so it must ask for folder access instead of reading arbitrary paths directly.

1. Click `Select bridge folder` and choose `~/VideoAudit/premiere-bridge/`.
2. Click `Select output folder` and choose `/Users/joshlevy/Movies/Edited`.
3. Keep the panel open while processing requests.

The plugin writes:

```txt
~/VideoAudit/premiere-bridge/status.json
```

The backend writes requests to:

```txt
~/VideoAudit/premiere-bridge/requests/
```

The plugin validates bridge access, writes heartbeat status, polls `requests/`, imports each selected video into the active Premiere project, creates one 1920x1080 `Video Audit` sequence per video, and queues each sequence in Adobe Media Encoder with the selected `.epr` preset. It moves successful requests to `completed/` with queued job details and failed requests to `failed/` with error information.

The plugin only queues jobs in Adobe Media Encoder. It does not start the Media Encoder queue automatically.
