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

## Folder Tree Selection

The backend can report and scan the local edited-video tree rooted at:

```txt
/Volumes/SanDisk SSD/Videos/Edited
```

`GET /api/folders/default-root` reports whether that default SanDisk edited-video folder is available. `GET /api/folders/tree` returns the full folder tree for local-only use, with folders only as nodes. Recursive counts and sizes are based only on supported video files.

Audits can also be started with `selectedFolders` to scan a subset of that tree while preserving the existing scan options for resolution analysis, black-border analysis, or both. Supported audit/tree formats include `.mp4`, `.mov`, `.m4v`, `.mkv`, `.avi`, `.wmv`, `.webm`, `.mpeg`, `.mpg`, `.m2ts`, and `.ts`. Audit scans never modify source files.

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

## Black-Border Analysis And Auto-Crop

Folder audits can run the standard low-resolution/aspect-ratio scan, FFmpeg `cropdetect` black-border analysis, or both. Send `includeLowResolutionAnalysis: false` with `includeBlackBorderAnalysis: true` to run a black-border-only scan. When black-border analysis is enabled, videos are flagged for review when they have asymmetric borders or borders on both axes. Symmetric pillarbox-only and letterbox-only videos are treated as acceptable. Flagged video records may include `adjustments.blackBorder` with the detected visible area, border sizes, confidence, and auto-crop eligibility. Existing saved audit payloads without `includeLowResolutionAnalysis` still default to the standard scan.

Auto-crop is a separate backend workflow from the Premiere bridge. It uses FFmpeg directly, only processes high-confidence 16:9 nested-border candidates, and writes cropped videos directly into:

```txt
~/Movies/Edited/AutoCropped/
```

Output filenames match the selected source filenames. The backend writes `manifest.in-progress.json` during the run and renames it to `manifest.json` when complete. Source files are never modified, overwritten, deleted, or cropped in place. Cropped outputs can later be scanned or selected for the Premiere export workflow if needed.

## Thumbnail Generation

Thumbnails are generated on demand after audit results are loaded. The audit scan does not generate thumbnails; the frontend starts a separate `POST /api/thumbnails/generate` job with the explicit video rows it wants processed, then follows progress at `/api/thumbnails/jobs/:jobId/events` and reads final metadata from `/api/thumbnails/jobs/:jobId/result`.

The backend uses FFmpeg to extract one JPEG frame per requested video and caches generated files in:

```txt
~/VideoAudit/thumbnails/
```

Override the cache location with:

```txt
VIDEO_AUDIT_THUMBNAIL_DIR=/absolute/path/to/thumbnails
```

Source video files are never modified, and thumbnails are never written into source or audited folders. Repeated generation requests reuse cached thumbnails when the source path, modified time, and size match a previously generated thumbnail.

## Preview Frames / Additional Thumbnails

Preview frames are generated on demand for one video at a time, intended for the video details modal. The backend exposes `POST /api/thumbnails/preview-frames`; it does not generate preview frames during an audit or for every table row.

The number of returned frames depends on the video duration. `additional` mode fills any missing default preview frames up to that allowed count and returns the complete ordered default set. `fresh` mode creates a new batch from different timestamp positions so the UI can replace the currently displayed carousel with a new set.

Preview frames are JPEG thumbnails cached under the existing thumbnail cache directory:

```txt
~/VideoAudit/thumbnails/
```

They are served from the same `/api/thumbnails/...` static route as table thumbnails. Source video files are never modified, and preview frames are never written into source video folders.

## Video Migration / Replacement

The backend exposes a dry-run and execution workflow for replacing an audited destination library with newly edited exports. New videos are copied from the selected source folder into the audited destination root as a flat structure. Existing destination files with exact matching filenames are moved into a unique sibling archive run folder, and the run writes `manifest.in-progress.json`, `manifest.json`, and `operation.log` for recovery.

New source files are never deleted or moved. Old destination files are archived, not permanently deleted. Actual disk space is not reclaimed until the archive folder is manually reviewed and deleted.

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
