# Implementation Plan

## Resolved MVP Decisions

- Exported files should be written to `/Users/joshlevy/Movies/Edited`.
- A request can contain multiple selected videos, but the plugin should process each video individually.
- Each selected video should produce one Premiere sequence and one separate Adobe Media Encoder queue item.
- The UXP plugin should use `localFileSystem: "request"` and a folder-token setup, not unrestricted filesystem access.
- Real `.epr` preset files should live in `~/VideoAudit/premiere-bridge/presets/`.
- The plugin should create sequences in a bin named `Video Audit Exports` and leave them there after queueing to AME.
- The target Premiere Pro version is 26.0 or newer, with Manifest v5 support.

## Current Repo Observations

- This is a Vite React app with a colocated Express backend. Root scripts run both sides with `npm run dev`, `vite` for the frontend, and `npm --prefix backend run dev` for the API.
- The frontend uses PrimeReact (`Button`, `Message`, `Toast`, `DataTable`, `Dropdown`, `MultiSelect`, `Skeleton`) plus local CSS in `src/App.css` and `src/index.css`.
- `src/App.tsx` is mostly composition. Audit orchestration is in `src/hooks/useVideoAuditController.ts`; reusable conversion/storage helpers are in `src/helpers/utils.ts`; row types are in `src/types/video.ts`.
- `VideoTable` owns row selection locally today: `const [selectedVideos, setSelectedVideos] = useState<VideoRow[]>([])`, `DataTable` uses `dataKey="path"`, `selectionMode="multiple"`, and the current handler only logs selected rows.
- `VideoRow.path` is the absolute source file path returned by the backend audit. The export request should treat it as the source `absolutePath`; there is no existing stable ID other than `path`.
- Existing persisted audit data shape is `{ fileName, payload, rows }` in `localStorage` under `video-audit:videos:v1`. Do not mix Premiere queue state into that cache for MVP.
- The backend is CommonJS Express in `backend/index.js`. It already uses `crypto.randomUUID()`, `fs/promises`, `path`, `cors`, `express.json({ limit: "1mb" })`, and route-level validation returning `{ status, message }`.
- Current backend routes are `/api/health`, `/api/audits`, `/api/audits/:jobId`, `/api/audits/:jobId/events`, and `/api/audits/:jobId/result`. Keep Premiere routes under `/api/premiere/...` to avoid touching the audit flow.
- `backend/.env` already configures local filesystem behavior via `SEARCH_ROOTS`; use the same env style for `PREMIERE_BRIDGE_DIR` and heartbeat max age.
- The MVP export output directory is fixed at `/Users/joshlevy/Movies/Edited`.

## Stage 1: Shared Bridge Contract

Intelligence: Medium

Create the shared contract before touching routes or UI. Keep it small and usable from the CommonJS backend and the UXP plugin.

Recommended files to add in this stage:

```txt
shared/
  premiereBridge.cjs
  premiereBridge.schema.md
```

Implementation details:

- Use `.cjs` because `backend/` is CommonJS while the root package has `"type": "module"`. UXP examples use `require()`, so `.cjs` is the lowest-friction shared format for backend + plugin.
- Export constants for:
  - `PLUGIN_ID = "video-audit-premiere-bridge"`
  - `DEFAULT_BRIDGE_DIR = "~/VideoAudit/premiere-bridge"` as a display/default string
  - `DEFAULT_EXPORT_OUTPUT_DIR = "/Users/joshlevy/Movies/Edited"`
  - `EXPORT_PROJECT_BIN_NAME = "Video Audit Exports"`
  - `REQUEST_TYPE_EXPORT_SELECTED_VIDEOS = "export-selected-videos"`
  - lifecycle folder names: `requests`, `completed`, `failed`, `presets`
  - status states: `ready`, `not_ready`, `error`
  - request lifecycle states: `queued`, `processing`, `completed`, `failed`
  - default heartbeat max age, for example `15_000` or `30_000` ms
- Export a minimal preset list:

```js
[
  {
    id: "h264-1080p-12mbps",
    label: "H.264 1080p - 12 Mbps",
    resolution: "1920x1080",
    presetFileName: "h264-1080p-12mbps.epr",
  },
]
```

- Add simple validation helpers only where they reduce duplicate bugs:
  - `isKnownPresetId(presetId)`
  - `getPresetById(presetId)`
  - `isExportSelectedVideosRequest(value)`
- Do not introduce a schema library yet. Manual validation is enough for the MVP and matches the backend's current style.
- Keep frontend types in `src/types/video.ts` or a new `src/types/premiere.ts`; the frontend can get presets from the backend rather than importing shared CJS directly.
- The `videos` array may contain multiple selected rows. The plugin should still process the array one item at a time and create separate sequence/AME queue entries for each video.

Request JSON shape to standardize:

```json
{
  "id": "8f65f05f-7a7c-41f0-9e98-8c865c6af811",
  "type": "export-selected-videos",
  "status": "queued",
  "createdAt": "2026-05-11T00:00:00.000Z",
  "presetId": "h264-1080p-12mbps",
  "presetFileName": "h264-1080p-12mbps.epr",
  "outputDirectory": "/Users/joshlevy/Movies/Edited",
  "videos": [
    {
      "id": "/Users/example/Videos/example.mp4",
      "fileName": "example.mp4",
      "absolutePath": "/Users/example/Videos/example.mp4",
      "directory": "/Users/example/Videos",
      "durationSeconds": 123.45,
      "width": 3840,
      "height": 2160,
      "displayAspectRatio": "16:9",
      "frameRate": 29.97
    }
  ]
}
```

Status JSON shape to standardize:

```json
{
  "plugin": "video-audit-premiere-bridge",
  "status": "ready",
  "updatedAt": "2026-05-11T00:00:00.000Z",
  "activeProjectName": "Some Project.prproj",
  "activeProjectPath": "/Users/example/Projects/Some Project.prproj",
  "bridgeDir": "/Users/example/VideoAudit/premiere-bridge",
  "outputDirectory": "/Users/joshlevy/Movies/Edited",
  "version": "0.1.0"
}
```

Completed/failed result JSON shape:

```json
{
  "id": "8f65f05f-7a7c-41f0-9e98-8c865c6af811",
  "type": "export-selected-videos",
  "status": "completed",
  "completedAt": "2026-05-11T00:05:00.000Z",
  "queuedJobs": [
    {
      "sourcePath": "/Users/example/Videos/example.mp4",
      "sequenceName": "Video Audit - example",
      "outputPath": "/Users/joshlevy/Movies/Edited/example-1080p.mp4"
    }
  ]
}
```

## Stage 2: Backend Bridge Utilities And Status Endpoint

Intelligence: Medium

Add backend-only orchestration utilities without changing the existing audit routes.

Recommended backend additions:

```txt
backend/utils/premiereBridge.js
```

Backend utility responsibilities:

- Resolve the bridge directory:
  - Use `process.env.PREMIERE_BRIDGE_DIR` when set.
  - Otherwise expand the shared default `~/VideoAudit/premiere-bridge` using `os.homedir()`.
- Create directories if missing:
  - bridge root
  - `requests/`
  - `completed/`
  - `failed/`
  - `presets/`
- Ensure `/Users/joshlevy/Movies/Edited` exists before accepting export requests. This is the fixed MVP output directory, not a user-selectable UI option.
- Read `status.json` and classify heartbeat freshness using `PREMIERE_BRIDGE_HEARTBEAT_MAX_MS` or the shared default.
- Check whether Premiere Pro is running on macOS from the backend only. Recommended MVP check:
  - use `child_process.execFile("pgrep", ["-x", "Adobe Premiere Pro"])`
  - treat exit code 0 as running, exit code 1 as not running
  - if `pgrep` is unavailable, return an `unknown` detail but do not let the browser perform this check
- Validate bridge readiness as:
  - `premiereRunning === true`
  - status file exists
  - status file plugin id matches
  - status is `ready`
  - status `outputDirectory` matches `/Users/joshlevy/Movies/Edited`
  - `updatedAt` is recent

Add route:

```txt
GET /api/premiere/status
```

Response shape:

```json
{
  "status": "ready",
  "premiere": {
    "running": true
  },
  "bridge": {
    "connected": true,
    "status": "ready",
    "updatedAt": "2026-05-11T00:00:00.000Z",
    "activeProjectName": "Some Project.prproj"
  },
  "bridgeDir": "/Users/example/VideoAudit/premiere-bridge",
  "outputDirectory": "/Users/joshlevy/Movies/Edited",
  "presets": [
    {
      "id": "h264-1080p-12mbps",
      "label": "H.264 1080p - 12 Mbps",
      "resolution": "1920x1080"
    }
  ],
  "message": "Premiere bridge is ready."
}
```

Status cases the backend should distinguish:

- Premiere Pro is not open:

```json
{
  "status": "premiere_not_running",
  "premiere": { "running": false },
  "bridge": { "connected": false },
  "message": "Premiere Pro is not open."
}
```

- Premiere Pro is open but the bridge/plugin is not connected:

```json
{
  "status": "bridge_disconnected",
  "premiere": { "running": true },
  "bridge": {
    "connected": false,
    "reason": "missing_or_stale_status"
  },
  "message": "Premiere Pro is open, but the Video Audit bridge plugin is not connected."
}
```

- Bridge ready:

```json
{
  "status": "ready",
  "premiere": { "running": true },
  "bridge": {
    "connected": true,
    "status": "ready",
    "outputDirectory": "/Users/joshlevy/Movies/Edited"
  },
  "message": "Premiere bridge is ready."
}
```

Notes:

- Keep this endpoint as a normal request. Do not add WebSockets or SSE for Premiere readiness.
- Do not call Premiere APIs from the backend. The backend only checks local process state and bridge files.
- Use the existing response style: JSON with `status` and `message`.

## Stage 3: Backend Export Request Endpoint

Intelligence: Medium

Add the request-writing API that the UI will call after selected rows and a preset are chosen.

Add route:

```txt
POST /api/premiere/export-requests
```

Expected request body:

```json
{
  "presetId": "h264-1080p-12mbps",
  "videos": [
    {
      "id": "/Users/example/Videos/example.mp4",
      "fileName": "example.mp4",
      "absolutePath": "/Users/example/Videos/example.mp4",
      "directory": "/Users/example/Videos",
      "durationSeconds": 123.45,
      "width": 3840,
      "height": 2160,
      "displayAspectRatio": "16:9",
      "frameRate": 29.97
    }
  ]
}
```

Backend validation:

- Body must be an object.
- `presetId` must match a shared known preset ID.
- Preset file must exist under `bridgeDir/presets/<presetFileName>` before accepting the request. Return `400` or `409` with a useful message if missing.
- The fixed output directory `/Users/joshlevy/Movies/Edited` must exist or be created before accepting the request.
- `videos` must be a non-empty array and should have an upper bound such as 100 for MVP.
- Each video must have:
  - `absolutePath` as an absolute path
  - `fileName` as a non-empty string
  - optional numeric metadata fields may be `number` or `null`
- For safety, call `fs.stat(absolutePath)` and require an existing file. Return a per-file validation error if any selected row points at a missing path.
- Before writing, call the same bridge readiness helper used by `GET /api/premiere/status`. If not ready, return `409`:

```json
{
  "status": "bridge_not_ready",
  "message": "Premiere Pro is open, but the Video Audit bridge plugin is not connected.",
  "premiereStatus": {
    "status": "bridge_disconnected"
  }
}
```

Request writing:

- Generate `id` with `crypto.randomUUID()`.
- Create a full request object with `status: "queued"`, `createdAt`, and `outputDirectory: "/Users/joshlevy/Movies/Edited"`.
- Write atomically:
  - write to `requests/<id>.json.tmp`
  - rename to `requests/<id>.json`
- Return `202`:

```json
{
  "status": "queued",
  "requestId": "8f65f05f-7a7c-41f0-9e98-8c865c6af811",
  "message": "Export request queued for Premiere."
}
```

Do not add:

- Direct Premiere API calls.
- Background dashboard.
- Request polling UI.
- AME queue start calls.

## Stage 4: Frontend Premiere Status State And Banner

Intelligence: Medium

Add frontend readiness state to the existing controller flow.

Recommended files:

```txt
src/types/premiere.ts
src/components/PremiereStatusBanner.tsx
```

Controller changes in `useVideoAuditController`:

- Add state:
  - `premiereStatus`
  - `isPremiereStatusLoading`
  - `premierePresets`
- Add `checkPremiereStatus()` that calls `GET ${apiBaseUrl}/api/premiere/status`.
- Run it once in `useEffect` when the app loads.
- Expose `checkPremiereStatus`, status state, and preset list to `App`.
- Reuse the existing `Toast` ref for status-check failures only when the HTTP request itself fails; normal not-ready states should be shown in the banner.

Banner component behavior:

- Use PrimeReact `Message` or a lightweight custom panel consistent with the existing `.table-error-panel` / `.error-alert` style.
- Show separate text for:
  - Premiere Pro is not open.
  - Premiere Pro is open, but the Video Audit bridge plugin is not connected.
  - Premiere bridge is connected and ready.
- Include a PrimeReact `Button` labeled `Retry`.
- The `Retry` button reruns `checkPremiereStatus()`.
- Prefer placing the banner near the top of `App`, below `Toast` and above `UploadPanel`, so it is visible in both empty and table states.
- Consider showing the ready state as a compact success/info message only when data is loaded, to avoid cluttering the initial scan screen. If implemented, keep the ready message small.

Frontend status types:

```ts
export type PremiereStatusCode =
  | 'ready'
  | 'premiere_not_running'
  | 'bridge_disconnected'
  | 'error'

export type PremierePreset = {
  id: string
  label: string
  resolution: string
}
```

## Stage 5: Lift Selection And Add Export Controls

Intelligence: Medium

Move selected video state out of `VideoTable` so the controller can export selected rows.

Recommended approach:

- Add to `useVideoAuditController`:
  - `selectedVideos`
  - `setSelectedVideos`
  - reset selection to `[]` when new audit rows load, refresh starts, or clear cache runs
- Change `VideoTableProps`:
  - add `selectedVideos: VideoRow[]`
  - add `onSelectedVideosChange: (videos: VideoRow[]) => void`
  - remove internal `selectedVideos` state
  - remove the current `console.log('selectedVideos', nextSelectedVideos)`
- Keep `DataTable` selection exactly where it is, still keyed by `path`.

Add export controls to the existing table header:

- Add a PrimeReact `Button` labeled `Export to Premiere`.
- Disable it when:
  - `selectedVideos.length === 0`
  - Premiere is not running
  - bridge is not connected/ready
  - table is loading
  - audit is active
- Use the existing `.table-actions` group. If the button crowding gets awkward, put export first or create a second action group inside the header; keep it simple.
- Include selected count in the button label or adjacent text, for example `Export to Premiere (3)`, but avoid adding a new dashboard surface.

Modal/dialog:

- Use PrimeReact `Dialog` for preset selection if PrimeReact already provides it in dependencies.
- Use `Dropdown` for preset choice, fed by `premierePresets` from `/api/premiere/status`.
- Dialog actions:
  - Cancel
  - Queue export
- Disable `Queue export` if no preset is selected or the POST is in flight.
- Show selected count in concise text inside the dialog.

Payload mapping from `VideoRow`:

```ts
const toPremiereExportVideo = (row: VideoRow) => ({
  id: row.path,
  fileName: row.fileName,
  absolutePath: row.path,
  directory: row.directory,
  durationSeconds: row.durationSeconds,
  width: row.width,
  height: row.height,
  displayAspectRatio: row.displayAspectRatio,
  frameRate: row.frameRate,
})
```

Submit flow:

- POST to `/api/premiere/export-requests`.
- On `202`, close the dialog and show toast success: request queued with request ID.
- On `409 bridge_not_ready`, update `premiereStatus` from the response if present and show a toast/error message.
- On validation errors, keep the dialog open and show a PrimeReact `Message` inside it.
- Do not poll for completion in the MVP. The user's confirmation for actual processing is the plugin/AME UI plus bridge files.

## Stage 6: Premiere UXP Plugin Scaffold

Intelligence: High

Create the plugin only when implementation begins. Do not add this directory during planning.

Expected folder:

```txt
premiere-uxp/
  manifest.json
  index.html
  index.js
  styles.css
  README.md
```

Manifest requirements:

- Manifest v5.
- Host app should be Premiere Pro / `premierepro` with minimum version 26.0.
- Include a panel entrypoint so the user can see bridge status and select/configure the bridge folder.
- Required permissions:
  - `localFileSystem: "request"` for the folder-token approach.
- Do not add network permission unless the plugin later talks to the backend directly. The MVP bridge does not need plugin-to-backend HTTP.

Development loading:

- Install/open UXP Developer Tool.
- Enable Premiere Pro developer mode, restart Premiere Pro if required.
- Add the `premiere-uxp/` folder as a plugin in UXP Developer Tool.
- Load or Load & Watch the plugin into Premiere Pro.
- After manifest changes, fully unload and load again; normal JS/HTML changes can use reload.

Plugin UI:

- Small panel with:
  - bridge folder status
  - output folder status for `/Users/joshlevy/Movies/Edited`
  - `Select bridge folder` button
  - `Select output folder` button if the output folder token has not been granted
  - active project name
  - last heartbeat time
  - last request/error summary
  - `Process now` button for manual debugging
- Keep UI utilitarian; the Vite app remains the main queueing UI.

Filesystem access recommendation:

- On first run, ask the user to select `~/VideoAudit/premiere-bridge/` using UXP `localFileSystem.getFolder()`, then store a persistent token in plugin `localStorage`.
- Also ask the user to grant access to `/Users/joshlevy/Movies/Edited` as the export output folder, then store a separate persistent token.
- This is a permission grant, not an alternate destination picker. If UXP exposes the folder's native path, verify it matches `/Users/joshlevy/Movies/Edited`; if it does not, show an error and ask again.
- On reload, restore both folders with `getEntryForPersistentToken()`.
- If either token fails because a folder moved or permissions changed, show a disconnected/not-ready state and ask the user to select the missing folder again.
- Risk: UXP filesystem access is sandboxed and permission-based. Do not assume arbitrary path access with `localFileSystem: "request"`; the plugin needs explicit user-granted access to the bridge folder and the output folder.

Heartbeat/status:

- Once bridge folder and output folder access are established, write `status.json` every 5-10 seconds.
- Include `plugin`, `status`, `updatedAt`, `activeProjectName`, `activeProjectPath`, `bridgeDir`, `outputDirectory`, and `version`.
- If no active project is open, write `status: "not_ready"` with `message: "No active Premiere project is open."`
- If the output folder token is missing, write `status: "not_ready"` with `message: "Export output folder is not connected."`
- Stop or mark not ready when the panel unloads if UXP lifecycle allows it; backend freshness timeout is still the source of truth.

Request processing loop:

- Poll `requests/` every few seconds while the plugin panel is active.
- Read `*.json` files.
- Move a request into an in-memory `processing` set before acting to avoid double-processing during one session.
- Process one request at a time for MVP.
- Within one request, process the `videos` array one video at a time.
- For each request:
  - validate `type === "export-selected-videos"`
  - validate preset ID and preset file path
  - validate `outputDirectory === "/Users/joshlevy/Movies/Edited"` for the MVP
  - validate each source file path is present in the request; actual access/import failures should become failed request records
  - write/update a request status if useful, but avoid complex progress tracking
- On success, move the request JSON from `requests/` to `completed/<id>.json` with appended result data.
- On failure, move it to `failed/<id>.json` with `failedAt`, `error.message`, and a concise stack/detail if available.

## Stage 7: Premiere Import, Sequence, 1080p Workflow, And AME Queue

Intelligence: Extra High

This is the highest-risk stage because it must be validated against the actual Premiere UXP DOM and Adobe Media Encoder behavior.

Reference APIs to prototype:

- Premiere DOM access starts from `const app = require("premierepro")`.
- Current Adobe docs show `await app.Project.getActiveProject()` for the active project.
- Project import can use `project.importFiles(filePaths, suppressUI, targetBin, asNumberedStills)`.
- `project.createSequenceFromMedia(name, clipProjectItems, targetBin)` can create a sequence from imported media.
- `SequenceSettings` exposes frame-size setters such as `setVideoFrameRect(...)`, but the exact `RectF` construction and persistence path should be prototyped.
- `EncoderManager.getManager()` and `encoderManager.exportSequence(sequence, Constants.ExportType.QUEUE_TO_AME, outputFile, presetFile, exportFull)` are the likely UXP path for queueing to AME without starting the queue.
- `EncoderManager` also exposes `encodeFile(...)` and `encodeProjectItem(...)` with `startQueueImmediately`; these are fallbacks if sequence export is not viable.

Recommended MVP workflow per video:

1. Get the active Premiere project.
2. Get or create a bin named `Video Audit Exports`.
3. Import the selected source video into that bin.
4. Resolve the imported `ClipProjectItem`. If `importFiles()` only returns boolean, locate the project item by path/name in the target bin after import.
5. Create a sequence named `Video Audit - <fileName without extension> - <request short id>` from the imported clip.
6. Ensure the sequence is 1920x1080:
   - Preferred: create from a known 1920x1080 sequence preset if UXP exposes `createSequenceWithPresetPath()` or a reliable preset workflow.
   - Alternate: create sequence from media, then update sequence settings to 1920x1080 with the UXP `SequenceSettings` APIs.
   - Risk: resizing/scaling clip content to fit the 1920x1080 frame may require additional timeline/track item operations. Keep MVP behavior to fit/fill only if a stable API is identified; otherwise rely on the export preset and document that sequence scaling is basic.
7. Build an output path under `/Users/joshlevy/Movies/Edited`:
   - `<safe base name>-1080p.mp4`
   - If a file already exists, append the request short id or a numeric suffix.
   - The plugin should use the stored output-folder token to create/write the output entry when UXP requires token-based file access.
8. Resolve preset file:
   - `bridgeDir/presets/<presetFileName>`
   - Require real `.epr` files.
9. Queue the sequence in Adobe Media Encoder:
   - Use `QUEUE_TO_AME` export type if available.
   - Do not use any option that starts the AME queue immediately.
   - If using an API with `startQueueImmediately`, pass `false`.
10. Record one queued job per selected video in the completed request JSON.

Important MVP boundaries:

- Do not auto-start Media Encoder exports.
- Do not parse or modify `.prproj` files.
- Do not implement intelligent reframing, subject tracking, scene analysis, or smart editing.
- Do not build a queue dashboard in the Vite app yet.
- Do not remove or move the `Video Audit Exports` bin, imported items, or generated sequences after queueing to AME.

Risks/unknowns to validate early:

- Whether the current Premiere UXP API can reliably create a 1920x1080 sequence from imported media without using a sequence preset.
- Whether imported project items can be reliably found after `importFiles()` when the method returns only boolean.
- Exact constant names for AME queue export in the installed Premiere version.
- Whether `.epr` preset paths can be read from the selected bridge folder under `localFileSystem: "request"`.
- Whether AME accepts an output path in `/Users/joshlevy/Movies/Edited` through host APIs when the plugin has a persistent token for that folder.
- Whether AME must already be installed/open for queueing, and how `EncoderManager.isAMEInstalled` behaves when AME is closed.

## Stage 8: Preset Files And Preset Validation

Intelligence: Medium

Use real Adobe `.epr` export presets where practical. Do not invent bitrate/resolution encoding logic in JavaScript for the MVP.

Preset plan:

- Keep stable preset metadata in shared constants.
- Store actual `.epr` files in:

```txt
~/VideoAudit/premiere-bridge/presets/
  h264-1080p-12mbps.epr
```

- The UI shows friendly labels from backend status/preset response.
- The UI sends only `presetId`.
- The backend maps `presetId` to `presetFileName` and writes both into the request.
- The plugin reads `presetFileName` and resolves it under its selected bridge folder.
- If preset file is missing, backend should reject new requests before the plugin sees them.
- If preset file becomes inaccessible to UXP, plugin should fail the request with a clear message.

Future optional enhancement:

- Add `GET /api/premiere/presets` only if status responses get too large or if presets need independent refresh. For MVP, include presets in `GET /api/premiere/status`.

## Stage 9: Documentation And Developer Workflow

Intelligence: Low

Update docs only after implementation begins.

Add concise docs to:

```txt
README.md
premiere-uxp/README.md
```

Document:

- Required apps and versions:
  - Premiere Pro with UXP support
  - UXP Developer Tool
  - Adobe Media Encoder
- How to start backend/frontend:
  - `npm run dev`
- How to create bridge folders:
  - backend creates them on status/export calls
- How to select bridge folder in the plugin.
- How to select `/Users/joshlevy/Movies/Edited` as the output folder in the plugin.
- Where `.epr` presets must be placed.
- How to load the plugin in UXP Developer Tool.
- Known MVP limitations.

## Manual QA Checklist

Intelligence: Medium

1. Start backend and Vite UI with `npm run dev`.
2. Open the Vite app.
3. With Premiere Pro closed, confirm the banner says Premiere Pro is not open.
4. Click Retry and confirm the state remains clear and non-crashing.
5. Open Premiere Pro but do not load the UXP bridge plugin.
6. Click Retry and confirm the banner says Premiere Pro is open but the bridge/plugin is not connected.
7. Confirm Export to Premiere is disabled when no rows are selected.
8. Scan a folder and load flagged video rows.
9. Select one or more rows and confirm Export to Premiere remains disabled while the bridge is disconnected.
10. Load the plugin in UXP Developer Tool.
11. In the plugin panel, select `~/VideoAudit/premiere-bridge/` as the bridge folder if prompted.
12. In the plugin panel, select `/Users/joshlevy/Movies/Edited` as the output folder if prompted.
13. Confirm `status.json` appears and updates in `~/VideoAudit/premiere-bridge/status.json`.
14. Click Retry in the Vite UI and confirm the bridge ready state appears.
15. Confirm Export to Premiere enables only when selected videos exist and status is ready.
16. Select multiple rows and confirm the dialog reports the selected count.
17. Click Export to Premiere.
18. Choose the `H.264 1080p - 12 Mbps` preset.
19. Submit the dialog.
20. Confirm the backend returns a request ID and the UI shows a success toast.
21. Confirm request JSON appears in `~/VideoAudit/premiere-bridge/requests/` with `outputDirectory: "/Users/joshlevy/Movies/Edited"`.
22. Confirm the UXP plugin processes the request.
23. Confirm each selected video imports into the current Premiere project.
24. Confirm one sequence per video is created inside the `Video Audit Exports` bin.
25. Confirm a 1920x1080 export sequence/workflow is created or used.
26. Confirm Adobe Media Encoder receives one queued export job per selected video.
27. Confirm AME does not start exporting automatically.
28. Confirm queued output paths point to `/Users/joshlevy/Movies/Edited`.
29. Confirm the request moves to `completed/` with queued job details.
30. Test a bad source path and confirm the request moves to `failed/` with useful error info.
31. Remove or rename the preset file and confirm the backend rejects new export requests with a useful error.
32. Quit Premiere and confirm the backend eventually reports stale/disconnected after the heartbeat timeout.

## Source Notes Checked During Planning

- Adobe Premiere UXP introduction: the MVP targets Premiere Pro 26.0+ with UXP and Manifest v5 support, and UXP is not a normal browser environment.
- Adobe Premiere UXP manifest docs: Manifest v5 is required, and filesystem permissions must be declared.
- Adobe Premiere UXP filesystem docs: filesystem access is sandboxed; persistent folder tokens are the safer bridge-folder strategy.
- Adobe Premiere UXP Premiere API docs: active project, import, sequence, and encoder APIs exist, but exact workflow details should be prototyped in the installed Premiere version.
- Adobe Premiere UXP EncoderManager docs: queue/export APIs exist and include AME queue/export paths; avoid options that start the queue immediately.
