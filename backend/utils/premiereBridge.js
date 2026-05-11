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
  PLUGIN_ID,
  PREMIERE_EXPORT_PRESETS,
} = require("../../shared/premiereBridge.cjs");

const execFileAsync = promisify(execFile);

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
    fs.mkdir(paths.outputDirectory, { recursive: true }),
  ]);

  return paths;
}

async function isPremiereRunning() {
  try {
    await execFileAsync("pgrep", ["-x", "Adobe Premiere Pro"]);
    return { running: true };
  } catch (error) {
    if (error && error.code === 1) {
      return { running: false };
    }

    return {
      running: null,
      reason: "process_check_failed",
      message:
        error instanceof Error
          ? error.message
          : "Unable to check whether Premiere Pro is running.",
    };
  }
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

function serializePresets() {
  return PREMIERE_EXPORT_PRESETS.map(({ id, label, resolution }) => ({
    id,
    label,
    resolution,
  }));
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

async function getPremiereStatus() {
  const paths = await ensurePremiereBridgeDirectories();
  const [premiere, statusFileResult] = await Promise.all([
    isPremiereRunning(),
    readStatusFile(paths.statusPath),
  ]);
  const baseResponse = {
    premiere,
    bridgeDir: paths.bridgeDir,
    outputDirectory: paths.outputDirectory,
    presets: serializePresets(),
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
  ensurePremiereBridgeDirectories,
  getBridgeDir,
  getBridgePaths,
  getPremiereStatus,
  isPremiereRunning,
};
