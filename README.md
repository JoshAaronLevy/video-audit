# Video Audit

Video Audit is a local Vite + React app with a coupled Express backend for scanning video folders, importing selected videos into Premiere Pro for manual editing, and running local FFmpeg-based video fixes.

## Requirements

- Node.js and npm.
- Premiere Pro with UXP support, targeting Premiere Pro 26.0 or newer for the bridge plugin.
- UXP Developer Tool for loading the local plugin during development.
- FFmpeg and FFprobe on the local PATH for audits, thumbnails, and Auto-Fix.

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
  imports/
```

The backend creates these folders when `/api/premiere/status`, `/api/premiere/import-requests`, or the deprecated compatibility route `/api/premiere/export-requests` runs. It does not call Premiere APIs directly. It checks local readiness, validates selected videos, and writes import-only request JSON into `requests/`.

Optional backend env vars:

```txt
PREMIERE_BRIDGE_DIR=/absolute/or/~/path
PREMIERE_BRIDGE_HEARTBEAT_MAX_MS=30000
```

`Edit in Premiere` means selected videos are imported into the currently open Premiere project for manual editing only. The active backend workflow no longer applies Premiere export presets, creates export sequences, or queues Adobe Media Encoder jobs. The old `/api/premiere/export-requests` endpoint is kept as a compatibility shim, but it now writes the same `import-selected-videos` bridge request as `/api/premiere/import-requests`.

## Black-Border Analysis And Auto-Crop

Folder audits can run the standard low-resolution/aspect-ratio scan, FFmpeg `cropdetect` black-border analysis, or both. Send `includeLowResolutionAnalysis: false` with `includeBlackBorderAnalysis: true` to run a black-border-only scan. When black-border analysis is enabled, videos are flagged for review when they have asymmetric borders or borders on both axes. Symmetric pillarbox-only and letterbox-only videos are treated as acceptable. Flagged video records may include `adjustments.blackBorder` with the detected visible area, border sizes, confidence, and auto-crop eligibility. Existing saved audit payloads without `includeLowResolutionAnalysis` still default to the standard scan.

Auto-crop is a separate backend workflow from the Premiere bridge. It uses FFmpeg directly, only processes high-confidence 16:9 nested-border candidates, and writes cropped videos directly into:

```txt
~/Movies/Edited/AutoCropped/
```

Output filenames match the selected source filenames. The backend writes `manifest.in-progress.json` during the run and renames it to `manifest.json` when complete. Source files are never modified, overwritten, deleted, or cropped in place. Cropped outputs can later be scanned or imported into Premiere for manual editing if needed.

## Auto-Fix / FFmpeg Normalize

Auto-Fix uses FFmpeg, not Premiere. Start a job with `POST /api/auto-fix`, follow progress at `GET /api/auto-fix/:jobId/events`, and read results at `GET /api/auto-fix/:jobId/result`.

Every Auto-Fix output is normalized to true `1920x1080`, square pixels, and `16:9` display aspect ratio without stretching. The filter preserves the source image shape and pads with black bars when needed:

```txt
scale=1920:1080:force_original_aspect_ratio=decrease:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,setdar=16/9
```

When existing black-border metadata marks a video as a safe, high-confidence nested-border `crop-scale` candidate, Auto-Fix crops first and then normalizes. Normal pillarbox-only or letterbox-only videos are normalized without cropping.

Profiles are selected independently per video:

- High quality normalize: `libx264`, `medium`, CRF `18`, AAC `192k`, `yuv420p`.
- Standard normalize: `libx264`, `fast`, CRF `20`, AAC `192k`, `yuv420p`.

The backend chooses the standard profile for clearly low-resolution or very low-bitrate sources and uses high quality otherwise, so mixed selections can run in one job.

Outputs are written directly to:

```txt
<destinationRoot>/ffmpeg/
```

If `destinationRoot` is omitted, it defaults to `/Users/joshlevy/Movies/Edited`, so the default output directory is `/Users/joshlevy/Movies/Edited/ffmpeg`. Auto-Fix does not create manifests, per-run folders, or per-video subfolders. Existing files in the `ffmpeg` folder are overwritten intentionally. Source videos are never modified.

MP4 source filenames are preserved exactly. Non-MP4 supported inputs keep the same base name but are written as `.mp4` for H.264/AAC container compatibility.

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
6. Keep the panel open while importing selected videos from the Vite app.

When connected, the plugin writes `status.json` heartbeat updates. The Vite app checks `/api/premiere/status` on load and with the Retry button.

## MVP Limitations

- The browser never checks local processes or files directly; those checks stay in the backend.
- The backend does not call Premiere APIs.
- The Premiere workflow imports selected files only; automatic fixes are handled by FFmpeg Auto-Fix.
- The MVP does not do intelligent reframing, subject tracking, scene analysis, background job dashboards, WebSockets, accounts, or cloud processing.
- Do not parse or edit `.prproj` files directly.
