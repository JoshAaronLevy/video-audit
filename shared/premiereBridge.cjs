const PLUGIN_ID = "video-audit-premiere-bridge";
const DEFAULT_BRIDGE_DIR = "~/VideoAudit/premiere-bridge";
const DEFAULT_EXPORT_OUTPUT_DIR = "/Users/joshlevy/Movies/Edited";
const EXPORT_PROJECT_BIN_NAME = "Video Audit Exports";

const REQUEST_TYPE_EXPORT_SELECTED_VIDEOS = "export-selected-videos";

const BRIDGE_FILE_NAMES = Object.freeze({
  status: "status.json",
});

const BRIDGE_DIRECTORY_NAMES = Object.freeze({
  requests: "requests",
  completed: "completed",
  failed: "failed",
  presets: "presets",
});

const BRIDGE_STATUS = Object.freeze({
  ready: "ready",
  notReady: "not_ready",
  error: "error",
});

const REQUEST_LIFECYCLE_STATE = Object.freeze({
  queued: "queued",
  processing: "processing",
  completed: "completed",
  failed: "failed",
});

const DEFAULT_HEARTBEAT_MAX_AGE_MS = 30_000;
const MAX_EXPORT_REQUEST_VIDEOS = 100;

const PREMIERE_EXPORT_PRESETS = Object.freeze([
  Object.freeze({
    id: "h264-1080p-10mbps",
    label: "H.264 1080p - 10 Mbps",
    resolution: "1920x1080",
    presetFileName: "1920x1080 - 10.epr",
  }),
]);

const PREMIERE_EXPORT_PRESETS_BY_ID = new Map(
  PREMIERE_EXPORT_PRESETS.map((preset) => [preset.id, preset])
);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isKnownPresetId(presetId) {
  return typeof presetId === "string" && PREMIERE_EXPORT_PRESETS_BY_ID.has(presetId);
}

function getPresetById(presetId) {
  return PREMIERE_EXPORT_PRESETS_BY_ID.get(presetId) || null;
}

function isFiniteNumberOrNull(value) {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isExportRequestVideo(value) {
  if (!isPlainObject(value)) {
    return false;
  }

  if (typeof value.id !== "string" || value.id.trim() === "") {
    return false;
  }

  if (typeof value.fileName !== "string" || value.fileName.trim() === "") {
    return false;
  }

  if (typeof value.absolutePath !== "string" || value.absolutePath.trim() === "") {
    return false;
  }

  if (typeof value.directory !== "string") {
    return false;
  }

  return (
    isFiniteNumberOrNull(value.durationSeconds) &&
    isFiniteNumberOrNull(value.width) &&
    isFiniteNumberOrNull(value.height) &&
    (typeof value.displayAspectRatio === "string" || value.displayAspectRatio === null) &&
    isFiniteNumberOrNull(value.frameRate)
  );
}

function isExportSelectedVideosRequest(value) {
  if (!isPlainObject(value)) {
    return false;
  }

  if (typeof value.id !== "string" || value.id.trim() === "") {
    return false;
  }

  if (value.type !== REQUEST_TYPE_EXPORT_SELECTED_VIDEOS) {
    return false;
  }

  if (!Object.values(REQUEST_LIFECYCLE_STATE).includes(value.status)) {
    return false;
  }

  if (typeof value.createdAt !== "string" || Number.isNaN(Date.parse(value.createdAt))) {
    return false;
  }

  const preset = getPresetById(value.presetId);
  if (!preset || value.presetFileName !== preset.presetFileName) {
    return false;
  }

  if (value.outputDirectory !== DEFAULT_EXPORT_OUTPUT_DIR) {
    return false;
  }

  if (
    !Array.isArray(value.videos) ||
    value.videos.length === 0 ||
    value.videos.length > MAX_EXPORT_REQUEST_VIDEOS
  ) {
    return false;
  }

  return value.videos.every(isExportRequestVideo);
}

module.exports = {
  BRIDGE_DIRECTORY_NAMES,
  BRIDGE_FILE_NAMES,
  BRIDGE_STATUS,
  DEFAULT_BRIDGE_DIR,
  DEFAULT_EXPORT_OUTPUT_DIR,
  DEFAULT_HEARTBEAT_MAX_AGE_MS,
  EXPORT_PROJECT_BIN_NAME,
  MAX_EXPORT_REQUEST_VIDEOS,
  PLUGIN_ID,
  PREMIERE_EXPORT_PRESETS,
  REQUEST_LIFECYCLE_STATE,
  REQUEST_TYPE_EXPORT_SELECTED_VIDEOS,
  getPresetById,
  isExportRequestVideo,
  isExportSelectedVideosRequest,
  isKnownPresetId,
};
