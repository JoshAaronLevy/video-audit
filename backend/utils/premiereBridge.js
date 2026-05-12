const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");

const {
  BRIDGE_DIRECTORY_NAMES,
  BRIDGE_FILE_NAMES,
  BRIDGE_STATUS,
  DEFAULT_BRIDGE_DIR,
  DEFAULT_EXPORT_OUTPUT_DIR,
  DEFAULT_HEARTBEAT_MAX_AGE_MS,
  getPresetById,
  isKnownPresetId,
  MAX_EXPORT_REQUEST_VIDEOS,
  PLUGIN_ID,
  PREMIERE_EXPORT_PRESETS,
  REQUEST_LIFECYCLE_STATE,
  REQUEST_TYPE_EXPORT_SELECTED_VIDEOS,
  REQUEST_TYPE_IMPORT_SELECTED_VIDEOS,
} = require("../../shared/premiereBridge.cjs");

const execFileAsync = promisify(execFile);

function getPremiereProcessNames() {
  const currentYear = new Date().getFullYear();
  const yearCandidates = [currentYear - 1, currentYear, currentYear + 1];

  return [
    "Adobe Premiere Pro",
    ...yearCandidates.map((year) => `Adobe Premiere Pro ${year}`),
  ];
}

function expandHomePath(value) {
  if (value === "~") {
    return os.homedir();
  }

  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }

  return value;
}

function getBridgeDir() {
  const configuredBridgeDir = process.env.PREMIERE_BRIDGE_DIR?.trim();
  return path.resolve(expandHomePath(configuredBridgeDir || DEFAULT_BRIDGE_DIR));
}

function getHeartbeatMaxAgeMs() {
  const configuredMaxAgeMs = Number(process.env.PREMIERE_BRIDGE_HEARTBEAT_MAX_MS);
  return Number.isFinite(configuredMaxAgeMs) && configuredMaxAgeMs > 0
    ? configuredMaxAgeMs
    : DEFAULT_HEARTBEAT_MAX_AGE_MS;
}

function getBridgePaths() {
  const bridgeDir = getBridgeDir();

  return {
    bridgeDir,
    statusPath: path.join(bridgeDir, BRIDGE_FILE_NAMES.status),
    requestsDir: path.join(bridgeDir, BRIDGE_DIRECTORY_NAMES.requests),
    completedDir: path.join(bridgeDir, BRIDGE_DIRECTORY_NAMES.completed),
    failedDir: path.join(bridgeDir, BRIDGE_DIRECTORY_NAMES.failed),
    presetsDir: path.join(bridgeDir, BRIDGE_DIRECTORY_NAMES.presets),
    importsDir: path.join(bridgeDir, BRIDGE_DIRECTORY_NAMES.imports),
    outputDirectory: DEFAULT_EXPORT_OUTPUT_DIR,
  };
}

async function ensurePremiereBridgeDirectories() {
  const paths = getBridgePaths();

  await Promise.all([
    fs.mkdir(paths.bridgeDir, { recursive: true }),
    fs.mkdir(paths.requestsDir, { recursive: true }),
    fs.mkdir(paths.completedDir, { recursive: true }),
    fs.mkdir(paths.failedDir, { recursive: true }),
    fs.mkdir(paths.presetsDir, { recursive: true }),
    fs.mkdir(paths.importsDir, { recursive: true }),
    fs.mkdir(paths.outputDirectory, { recursive: true }),
  ]);

  return paths;
}

async function isPremiereRunning() {
  const processNames = getPremiereProcessNames();

  console.log("[Premiere Bridge] Checking Premiere processes.", {
    processNames,
  });

  let lastUnexpectedError = null;

  for (const processName of processNames) {
    try {
      const { stdout } = await execFileAsync("pgrep", ["-x", processName]);
      const pids = stdout.trim().split(/\s+/).filter(Boolean);

      if (pids.length > 0) {
        console.log("[Premiere Bridge] Premiere process found.", {
          processName,
          pids,
        });
        return { running: true, processName, pids };
      }
    } catch (error) {
      if (error && error.code === 1) {
        continue;
      }

      lastUnexpectedError = error;
      break;
    }
  }

  if (lastUnexpectedError) {
    console.error("[Premiere Bridge] Premiere process check failed.", {
      code: lastUnexpectedError && lastUnexpectedError.code,
      message:
        lastUnexpectedError instanceof Error
          ? lastUnexpectedError.message
          : String(lastUnexpectedError),
    });

    return {
      running: null,
      reason: "process_check_failed",
      message:
        lastUnexpectedError instanceof Error
          ? lastUnexpectedError.message
          : "Unable to check whether Premiere Pro is running.",
    };
  }

  console.log("[Premiere Bridge] Premiere process not found.", {
    processNames,
  });
  return { running: false, checkedProcessNames: processNames };
}

async function readStatusFile(statusPath) {
  let rawStatus;

  try {
    rawStatus = await fs.readFile(statusPath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return {
        ok: false,
        reason: "missing_status",
      };
    }

    return {
      ok: false,
      reason: "status_read_failed",
      message:
        error instanceof Error ? error.message : "Unable to read bridge status.",
    };
  }

  try {
    const status = JSON.parse(rawStatus);
    return { ok: true, status };
  } catch {
    return {
      ok: false,
      reason: "invalid_status_json",
    };
  }
}

function getStatusFreshness(status, heartbeatMaxAgeMs) {
  if (!status || typeof status.updatedAt !== "string") {
    return {
      fresh: false,
      ageMs: null,
      reason: "missing_updated_at",
    };
  }

  const updatedAtMs = Date.parse(status.updatedAt);

  if (!Number.isFinite(updatedAtMs)) {
    return {
      fresh: false,
      ageMs: null,
      reason: "invalid_updated_at",
    };
  }

  const ageMs = Date.now() - updatedAtMs;

  return {
    fresh: ageMs >= 0 && ageMs <= heartbeatMaxAgeMs,
    ageMs,
    reason: ageMs >= 0 && ageMs <= heartbeatMaxAgeMs ? null : "stale_status",
  };
}

async function getPresetFileState(paths, preset) {
  const presetPath = path.join(paths.presetsDir, preset.presetFileName);

  try {
    const stat = await fs.stat(presetPath);

    if (!stat.isFile()) {
      return {
        available: false,
        reason: "not_file",
        message: `Premiere export preset file is not a file: ${preset.presetFileName}`,
        presetPath,
      };
    }

    return {
      available: true,
      presetPath,
    };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return {
        available: false,
        reason: "missing",
        message: `Premiere export preset file is missing: ${preset.presetFileName}`,
        presetPath,
      };
    }

    return {
      available: false,
      reason: "unavailable",
      message: `Unable to read Premiere export preset file: ${preset.presetFileName}`,
      presetPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function serializePresets(paths) {
  return Promise.all(
    PREMIERE_EXPORT_PRESETS.map(async ({ id, label, resolution, presetFileName }) => {
      const presetFileState = await getPresetFileState(paths, {
        id,
        presetFileName,
      });

      return {
        id,
        label,
        resolution,
        presetFileName,
        available: presetFileState.available,
        ...(presetFileState.available
          ? {}
          : {
              unavailableReason: presetFileState.reason,
              unavailableMessage: presetFileState.message,
            }),
      };
    })
  );
}

function serializeReadyBridge(status, ageMs) {
  return {
    connected: true,
    status: status.status,
    updatedAt: status.updatedAt,
    ageMs,
    activeProjectName:
      typeof status.activeProjectName === "string"
        ? status.activeProjectName
        : null,
    activeProjectPath:
      typeof status.activeProjectPath === "string"
        ? status.activeProjectPath
        : null,
    outputDirectory: status.outputDirectory,
  };
}

function serializeDisconnectedBridge(reason, statusFileResult, freshness) {
  const bridge = {
    connected: false,
    reason,
  };

  if (statusFileResult?.ok && statusFileResult.status) {
    bridge.status =
      typeof statusFileResult.status.status === "string"
        ? statusFileResult.status.status
        : null;
    bridge.updatedAt =
      typeof statusFileResult.status.updatedAt === "string"
        ? statusFileResult.status.updatedAt
        : null;
    bridge.activeProjectName =
      typeof statusFileResult.status.activeProjectName === "string"
        ? statusFileResult.status.activeProjectName
        : null;
    bridge.outputDirectory =
      typeof statusFileResult.status.outputDirectory === "string"
        ? statusFileResult.status.outputDirectory
        : null;
  }

  if (freshness) {
    bridge.ageMs = freshness.ageMs;
  }

  return bridge;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNumberOrNull(value) {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function validationError(message, details) {
  return {
    ok: false,
    statusCode: 400,
    payload: {
      status: "invalid_request",
      message,
      ...(details ? { details } : {}),
    },
  };
}

function conflictError(status, message, details) {
  return {
    ok: false,
    statusCode: 409,
    payload: {
      status,
      message,
      ...(details ? { details } : {}),
    },
  };
}

function validateExportRequestBody(body) {
  if (!isPlainObject(body)) {
    return validationError("Request body is required.");
  }

  if (!isKnownPresetId(body.presetId)) {
    return validationError("presetId must be a known Premiere export preset.");
  }

  if (!Array.isArray(body.videos)) {
    return validationError("videos must be an array.");
  }

  if (body.videos.length === 0) {
    return validationError("At least one selected video is required.");
  }

  if (body.videos.length > MAX_EXPORT_REQUEST_VIDEOS) {
    return validationError(
      `No more than ${MAX_EXPORT_REQUEST_VIDEOS} videos can be queued at once.`
    );
  }

  for (const [index, video] of body.videos.entries()) {
    if (!isPlainObject(video)) {
      return validationError(`videos[${index}] must be an object.`);
    }

    if (typeof video.id !== "string" || video.id.trim() === "") {
      return validationError(`videos[${index}].id is required.`);
    }

    if (typeof video.fileName !== "string" || video.fileName.trim() === "") {
      return validationError(`videos[${index}].fileName is required.`);
    }

    if (
      typeof video.absolutePath !== "string" ||
      video.absolutePath.trim() === ""
    ) {
      return validationError(`videos[${index}].absolutePath is required.`);
    }

    if (!path.isAbsolute(video.absolutePath)) {
      return validationError(`videos[${index}].absolutePath must be absolute.`);
    }

    if (typeof video.directory !== "string") {
      return validationError(`videos[${index}].directory is required.`);
    }

    for (const field of ["durationSeconds", "width", "height", "frameRate"]) {
      if (!isNumberOrNull(video[field])) {
        return validationError(`videos[${index}].${field} must be a number or null.`);
      }
    }

    if (
      typeof video.displayAspectRatio !== "string" &&
      video.displayAspectRatio !== null
    ) {
      return validationError(
        `videos[${index}].displayAspectRatio must be a string or null.`
      );
    }
  }

  return { ok: true };
}

function validateImportRequestBody(body) {
  if (!isPlainObject(body)) {
    return validationError("Request body is required.");
  }

  if (!Array.isArray(body.videos)) {
    return validationError("videos must be an array.");
  }

  if (body.videos.length === 0) {
    return validationError("At least one selected video is required.");
  }

  if (body.videos.length > MAX_EXPORT_REQUEST_VIDEOS) {
    return validationError(
      `No more than ${MAX_EXPORT_REQUEST_VIDEOS} videos can be imported at once.`
    );
  }

  for (const [index, video] of body.videos.entries()) {
    if (!isPlainObject(video)) {
      return validationError(`videos[${index}] must be an object.`);
    }

    if (typeof video.id !== "string" || video.id.trim() === "") {
      return validationError(`videos[${index}].id is required.`);
    }

    if (typeof video.fileName !== "string" || video.fileName.trim() === "") {
      return validationError(`videos[${index}].fileName is required.`);
    }

    if (
      typeof video.absolutePath !== "string" ||
      video.absolutePath.trim() === ""
    ) {
      return validationError(`videos[${index}].absolutePath is required.`);
    }

    if (!path.isAbsolute(video.absolutePath)) {
      return validationError(`videos[${index}].absolutePath must be absolute.`);
    }

    if (typeof video.directory !== "string") {
      return validationError(`videos[${index}].directory is required.`);
    }

    for (const field of ["durationSeconds", "width", "height", "frameRate"]) {
      if (!isNumberOrNull(video[field])) {
        return validationError(`videos[${index}].${field} must be a number or null.`);
      }
    }

    if (
      typeof video.displayAspectRatio !== "string" &&
      video.displayAspectRatio !== null
    ) {
      return validationError(
        `videos[${index}].displayAspectRatio must be a string or null.`
      );
    }
  }

  return { ok: true };
}

function toExportRequestVideo(video) {
  return {
    id: video.id.trim(),
    fileName: video.fileName.trim(),
    absolutePath: video.absolutePath,
    directory: video.directory,
    durationSeconds: video.durationSeconds,
    width: video.width,
    height: video.height,
    displayAspectRatio: video.displayAspectRatio,
    frameRate: video.frameRate,
  };
}

function sanitizeImportFileName(fileName, index) {
  const parsed = path.parse(fileName || "");
  const baseName = parsed.name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .trim()
    .slice(0, 180);
  const extension = parsed.ext.toLowerCase();

  return `${String(index + 1).padStart(3, "0")}-${baseName || "video"}${extension}`;
}

async function linkOrCopyFile(sourcePath, destinationPath) {
  try {
    await fs.link(sourcePath, destinationPath);
    return;
  } catch (error) {
    if (error && error.code === "EEXIST") {
      await fs.unlink(destinationPath);
      try {
        await fs.link(sourcePath, destinationPath);
        return;
      } catch {
        await fs.copyFile(sourcePath, destinationPath);
        return;
      }
    }

    await fs.copyFile(sourcePath, destinationPath);
  }
}

async function preparePremiereImportVideos({ paths, requestId, videos }) {
  const importRunDir = path.join(paths.importsDir, requestId);
  let createdImportRunDir = false;

  const preparedVideos = [];

  for (const [index, video] of videos.entries()) {
    const sourceExtension = path.extname(video.absolutePath);
    const fileNameExtension = path.extname(video.fileName);

    if (sourceExtension || !fileNameExtension) {
      preparedVideos.push(video);
      continue;
    }

    if (!createdImportRunDir) {
      await fs.mkdir(importRunDir, { recursive: true });
      createdImportRunDir = true;
    }

    const importFileName = sanitizeImportFileName(video.fileName, index);
    const importPath = path.join(importRunDir, importFileName);

    await linkOrCopyFile(video.absolutePath, importPath);

    preparedVideos.push({
      ...video,
      absolutePath: importPath,
      directory: importRunDir,
      originalAbsolutePath: video.absolutePath,
    });
  }

  return preparedVideos;
}

async function validatePresetFile(paths, preset) {
  const presetFileState = await getPresetFileState(paths, preset);

  if (presetFileState.available) {
    return { ok: true, presetPath: presetFileState.presetPath };
  }

  return conflictError(
    presetFileState.reason === "unavailable" ? "preset_unavailable" : "preset_missing",
    presetFileState.message,
    {
      presetPath: presetFileState.presetPath,
      ...(presetFileState.error ? { error: presetFileState.error } : {}),
    }
  );
}

async function validateSelectedVideoFiles(videos) {
  const invalidVideos = [];

  await Promise.all(
    videos.map(async (video, index) => {
      try {
        const stat = await fs.stat(video.absolutePath);

        if (!stat.isFile()) {
          invalidVideos.push({
            index,
            fileName: video.fileName,
            absolutePath: video.absolutePath,
            reason: "not_file",
          });
        }
      } catch (error) {
        invalidVideos.push({
          index,
          fileName: video.fileName,
          absolutePath: video.absolutePath,
          reason: error && error.code === "ENOENT" ? "missing" : "unavailable",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })
  );

  if (invalidVideos.length > 0) {
    invalidVideos.sort((first, second) => first.index - second.index);
    return validationError("One or more selected video files could not be read.", {
      videos: invalidVideos,
    });
  }

  return { ok: true };
}

function buildPremiereExportRequest({ preset, videos }) {
  return {
    id: crypto.randomUUID(),
    type: REQUEST_TYPE_EXPORT_SELECTED_VIDEOS,
    status: REQUEST_LIFECYCLE_STATE.queued,
    createdAt: new Date().toISOString(),
    presetId: preset.id,
    presetFileName: preset.presetFileName,
    outputDirectory: DEFAULT_EXPORT_OUTPUT_DIR,
    videos,
  };
}

function buildPremiereImportRequest({ id, videos }) {
  return {
    id,
    type: REQUEST_TYPE_IMPORT_SELECTED_VIDEOS,
    status: REQUEST_LIFECYCLE_STATE.queued,
    createdAt: new Date().toISOString(),
    videos,
  };
}

async function writeExportRequest(paths, request) {
  const requestPath = path.join(paths.requestsDir, `${request.id}.json`);
  const tempRequestPath = `${requestPath}.tmp`;

  await fs.writeFile(tempRequestPath, `${JSON.stringify(request, null, 2)}\n`);
  await fs.rename(tempRequestPath, requestPath);

  return requestPath;
}

async function createPremiereExportRequest(body) {
  const bodyValidation = validateExportRequestBody(body);

  if (!bodyValidation.ok) {
    return bodyValidation;
  }

  const paths = await ensurePremiereBridgeDirectories();
  const preset = getPresetById(body.presetId);
  const presetValidation = await validatePresetFile(paths, preset);

  if (!presetValidation.ok) {
    return presetValidation;
  }

  const videos = body.videos.map(toExportRequestVideo);
  const videoValidation = await validateSelectedVideoFiles(videos);

  if (!videoValidation.ok) {
    return videoValidation;
  }

  const premiereStatus = await getPremiereStatus();

  if (premiereStatus.status !== "ready") {
    return {
      ok: false,
      statusCode: 409,
      payload: {
        status: "bridge_not_ready",
        message: premiereStatus.message,
        premiereStatus,
      },
    };
  }

  const request = buildPremiereExportRequest({ preset, videos });
  await writeExportRequest(paths, request);

  return {
    ok: true,
    statusCode: 202,
    payload: {
      status: "queued",
      requestId: request.id,
      message: "Export request queued for Premiere.",
    },
  };
}

async function createPremiereImportRequest(body) {
  const bodyValidation = validateImportRequestBody(body);

  if (!bodyValidation.ok) {
    return bodyValidation;
  }

  const paths = await ensurePremiereBridgeDirectories();
  const videos = body.videos.map(toExportRequestVideo);
  const videoValidation = await validateSelectedVideoFiles(videos);

  if (!videoValidation.ok) {
    return videoValidation;
  }

  const premiereStatus = await getPremiereStatus();

  if (premiereStatus.status !== "ready") {
    return {
      ok: false,
      statusCode: 409,
      payload: {
        status: "bridge_not_ready",
        message: premiereStatus.message,
        premiereStatus,
      },
    };
  }

  const requestId = crypto.randomUUID();
  const importVideos = await preparePremiereImportVideos({
    paths,
    requestId,
    videos,
  });
  const request = buildPremiereImportRequest({
    id: requestId,
    videos: importVideos,
  });
  await writeExportRequest(paths, request);

  return {
    ok: true,
    statusCode: 202,
    payload: {
      status: "queued",
      requestId: request.id,
      message: "Import request queued for Premiere.",
    },
  };
}

async function getPremiereStatus() {
  const paths = await ensurePremiereBridgeDirectories();
  const [premiere, statusFileResult, presets] = await Promise.all([
    isPremiereRunning(),
    readStatusFile(paths.statusPath),
    serializePresets(paths),
  ]);
  const baseResponse = {
    premiere,
    bridgeDir: paths.bridgeDir,
    outputDirectory: paths.outputDirectory,
    presets,
  };

  if (premiere.running === false) {
    return {
      ...baseResponse,
      status: "premiere_not_running",
      bridge: { connected: false },
      message: "Premiere Pro is not open.",
    };
  }

  if (!statusFileResult.ok) {
    return {
      ...baseResponse,
      status: "bridge_disconnected",
      bridge: serializeDisconnectedBridge(
        statusFileResult.reason,
        statusFileResult,
        null
      ),
      message:
        premiere.running === null
          ? "Unable to confirm Premiere Pro is running, and the Video Audit bridge plugin is not connected."
          : "Premiere Pro is open, but the Video Audit bridge plugin is not connected.",
    };
  }

  const status = statusFileResult.status;
  const heartbeatMaxAgeMs = getHeartbeatMaxAgeMs();
  const freshness = getStatusFreshness(status, heartbeatMaxAgeMs);

  let disconnectedReason = null;

  if (!status || status.plugin !== PLUGIN_ID) {
    disconnectedReason = "plugin_mismatch";
  } else if (status.status !== BRIDGE_STATUS.ready) {
    disconnectedReason = "plugin_not_ready";
  } else if (status.outputDirectory !== DEFAULT_EXPORT_OUTPUT_DIR) {
    disconnectedReason = "output_directory_mismatch";
  } else if (!freshness.fresh) {
    disconnectedReason = freshness.reason || "stale_status";
  } else if (premiere.running !== true) {
    disconnectedReason = "premiere_process_unknown";
  }

  if (disconnectedReason) {
    return {
      ...baseResponse,
      status: "bridge_disconnected",
      bridge: serializeDisconnectedBridge(
        disconnectedReason,
        statusFileResult,
        freshness
      ),
      message:
        disconnectedReason === "premiere_process_unknown"
          ? "Unable to confirm Premiere Pro is running."
          : "Premiere Pro is open, but the Video Audit bridge plugin is not connected.",
    };
  }

  return {
    ...baseResponse,
    status: "ready",
    bridge: serializeReadyBridge(status, freshness.ageMs),
    message: "Premiere bridge is ready.",
  };
}

module.exports = {
  createPremiereExportRequest,
  createPremiereImportRequest,
  ensurePremiereBridgeDirectories,
  getBridgeDir,
  getBridgePaths,
  getPremiereStatus,
  isPremiereRunning,
};
