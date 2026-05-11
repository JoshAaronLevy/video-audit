# Video Audit Premiere Bridge

This is the Premiere Pro UXP plugin scaffold for the Video Audit filesystem bridge.

## Requirements

- Premiere Pro 26.0 or newer.
- UXP Developer Tool.
- Adobe Media Encoder for later export queue stages.

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

This Stage 6 scaffold validates bridge access, writes heartbeat status, polls `requests/`, and moves malformed or currently unimplemented export requests to `failed/` with an explanatory error. The actual Premiere import, 1920x1080 sequence creation, completed-request records, and Adobe Media Encoder queueing are implemented in Stage 7.
