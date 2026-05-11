const PLUGIN_ID = "video-audit-premiere-bridge";
const PLUGIN_VERSION = "0.1.0";
const DEFAULT_BRIDGE_DIR = "~/VideoAudit/premiere-bridge";
const DEFAULT_EXPORT_OUTPUT_DIR = "/Users/joshlevy/Movies/Edited";
const REQUEST_TYPE_EXPORT_SELECTED_VIDEOS = "export-selected-videos";

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
  processing: "processing",
  completed: "completed",
  failed: "failed",
});

const PREMIERE_EXPORT_PRESETS = Object.freeze([
  Object.freeze({
    id: "h264-1080p-12mbps",
    label: "H.264 1080p - 12 Mbps",
    resolution: "1920x1080",
    presetFileName: "h264-1080p-12mbps.epr",
  }),
]);

const TOKEN_KEYS = Object.freeze({
  bridgeFolder: "videoAuditBridgeFolderToken",
  outputFolder: "videoAuditOutputFolderToken",
});

const state = {
  bridgeFolder: null,
  outputFolder: null,
  bridgePath: null,
  outputPath: null,
  activeProjectName: null,
  activeProjectPath: null,
  heartbeatTimer: null,
  requestTimer: null,
  processingRequestIds: new Set(),
};

const ui = {};

function getLocalFileSystem() {
  return require("uxp").storage.localFileSystem;
}

function getPremiereApp() {
  try {
    return require("premierepro");
  } catch (error) {
    return null;
  }
}

function setText(key, value) {
  if (ui[key]) {
    ui[key].textContent = value;
  }
}

function setLastActivity(message) {
  setText("lastActivity", message);
}

function normalizeNativePath(value) {
  return String(value || "").replace(/\/+$/, "");
}

function getEntryPath(entry) {
  if (!entry) {
    return "";
  }

  try {
    const localFileSystem = getLocalFileSystem();
    if (typeof localFileSystem.getNativePath === "function") {
      return localFileSystem.getNativePath(entry);
    }
  } catch (error) {
    // Fall back to nativePath below.
  }

  return entry.nativePath || "";
}

function isExpectedOutputFolder(entry) {
  const nativePath = normalizeNativePath(getEntryPath(entry));

  if (!nativePath) {
    return true;
  }

  return nativePath === DEFAULT_EXPORT_OUTPUT_DIR;
}

async function createPersistentToken(entry) {
  const localFileSystem = getLocalFileSystem();
  return localFileSystem.createPersistentToken(entry);
}

async function restoreEntry(tokenKey) {
  const token = localStorage.getItem(tokenKey);

  if (!token) {
    return null;
  }

  try {
    const localFileSystem = getLocalFileSystem();
    return await localFileSystem.getEntryForPersistentToken(token);
  } catch (error) {
    localStorage.removeItem(tokenKey);
    return null;
  }
}

async function selectBridgeFolder() {
  const localFileSystem = getLocalFileSystem();
  const folder = await localFileSystem.getFolder();

  if (!folder) {
    return;
  }

  localStorage.setItem(TOKEN_KEYS.bridgeFolder, await createPersistentToken(folder));
  state.bridgeFolder = folder;
  state.bridgePath = getEntryPath(folder);
  await ensureBridgeSubfolders();
  await refreshPanel();
  setLastActivity(`Bridge folder connected: ${state.bridgePath || DEFAULT_BRIDGE_DIR}`);
}

async function selectOutputFolder() {
  const localFileSystem = getLocalFileSystem();
  const folder = await localFileSystem.getFolder();

  if (!folder) {
    return;
  }

  if (!isExpectedOutputFolder(folder)) {
    setLastActivity(`Choose ${DEFAULT_EXPORT_OUTPUT_DIR} as the output folder.`);
    return;
  }

  localStorage.setItem(TOKEN_KEYS.outputFolder, await createPersistentToken(folder));
  state.outputFolder = folder;
  state.outputPath = getEntryPath(folder) || DEFAULT_EXPORT_OUTPUT_DIR;
  await refreshPanel();
  setLastActivity(`Output folder connected: ${state.outputPath}`);
}

async function restoreFolders() {
  state.bridgeFolder = await restoreEntry(TOKEN_KEYS.bridgeFolder);
  state.outputFolder = await restoreEntry(TOKEN_KEYS.outputFolder);
  state.bridgePath = getEntryPath(state.bridgeFolder);
  state.outputPath = getEntryPath(state.outputFolder) || null;

  if (state.bridgeFolder) {
    await ensureBridgeSubfolders();
  }

  if (state.outputFolder && !isExpectedOutputFolder(state.outputFolder)) {
    localStorage.removeItem(TOKEN_KEYS.outputFolder);
    state.outputFolder = null;
    state.outputPath = null;
    setLastActivity(`Stored output folder is not ${DEFAULT_EXPORT_OUTPUT_DIR}. Select it again.`);
  }
}

async function getFolderEntries(folder) {
  if (!folder) {
    return [];
  }

  return folder.getEntries();
}

async function getChildEntry(folder, name) {
  const entries = await getFolderEntries(folder);
  return entries.find((entry) => entry.name === name) || null;
}

async function getOrCreateFolder(folder, name) {
  const existingEntry = await getChildEntry(folder, name);

  if (existingEntry) {
    if (!existingEntry.isFolder) {
      throw new Error(`${name} exists but is not a folder.`);
    }

    return existingEntry;
  }

  if (typeof folder.createFolder === "function") {
    return folder.createFolder(name);
  }

  return folder.createEntry(name, { type: require("uxp").storage.types.folder });
}

async function ensureBridgeSubfolders() {
  if (!state.bridgeFolder) {
    return null;
  }

  const folders = {};

  for (const name of Object.values(BRIDGE_DIRECTORY_NAMES)) {
    folders[name] = await getOrCreateFolder(state.bridgeFolder, name);
  }

  return folders;
}

async function createOrOverwriteFile(folder, name, contents) {
  const file = await folder.createFile(name, { overwrite: true });
  await file.write(contents);
  return file;
}

async function deleteEntry(entry) {
  if (entry && typeof entry.delete === "function") {
    await entry.delete();
  }
}

function getPresetById(presetId) {
  return PREMIERE_EXPORT_PRESETS.find((preset) => preset.id === presetId) || null;
}

async function getActiveProjectInfo() {
  const premiereApp = getPremiereApp();

  if (!premiereApp || !premiereApp.Project || !premiereApp.Project.getActiveProject) {
    return {
      activeProjectName: null,
      activeProjectPath: null,
    };
  }

  try {
    const project = await premiereApp.Project.getActiveProject();

    if (!project) {
      return {
        activeProjectName: null,
        activeProjectPath: null,
      };
    }

    return {
      activeProjectName: project.name || project.documentName || "Open project",
      activeProjectPath: project.path || project.documentPath || null,
    };
  } catch (error) {
    return {
      activeProjectName: null,
      activeProjectPath: null,
    };
  }
}

function getCurrentStatus(projectInfo) {
  if (!state.bridgeFolder) {
    return {
      status: BRIDGE_STATUS.notReady,
      message: "Bridge folder is not connected.",
    };
  }

  if (!state.outputFolder) {
    return {
      status: BRIDGE_STATUS.notReady,
      message: "Export output folder is not connected.",
    };
  }

  if (!projectInfo.activeProjectName) {
    return {
      status: BRIDGE_STATUS.notReady,
      message: "No active Premiere project is open.",
    };
  }

  return {
    status: BRIDGE_STATUS.ready,
    message: "Premiere bridge is ready.",
  };
}

async function writeHeartbeat() {
  if (!state.bridgeFolder) {
    return;
  }

  const projectInfo = await getActiveProjectInfo();
  state.activeProjectName = projectInfo.activeProjectName;
  state.activeProjectPath = projectInfo.activeProjectPath;

  const currentStatus = getCurrentStatus(projectInfo);
  const payload = {
    plugin: PLUGIN_ID,
    status: currentStatus.status,
    message: currentStatus.message,
    updatedAt: new Date().toISOString(),
    activeProjectName: projectInfo.activeProjectName,
    activeProjectPath: projectInfo.activeProjectPath,
    bridgeDir: state.bridgePath || DEFAULT_BRIDGE_DIR,
    outputDirectory: DEFAULT_EXPORT_OUTPUT_DIR,
    version: PLUGIN_VERSION,
  };

  await createOrOverwriteFile(state.bridgeFolder, "status.json", `${JSON.stringify(payload, null, 2)}\n`);
  updateStatusText(currentStatus.message);
}

function updateStatusText(activityMessage) {
  setText(
    "bridgeStatus",
    state.bridgeFolder ? state.bridgePath || "Connected" : "Not connected"
  );
  setText(
    "outputStatus",
    state.outputFolder ? state.outputPath || DEFAULT_EXPORT_OUTPUT_DIR : "Not connected"
  );
  setText("projectStatus", state.activeProjectName || "No active project");
  setText("heartbeatStatus", new Date().toLocaleTimeString());

  if (activityMessage) {
    setLastActivity(activityMessage);
  }
}

async function refreshPanel() {
  try {
    await writeHeartbeat();
  } catch (error) {
    setLastActivity(error.message || "Unable to write bridge heartbeat.");
  }

  updateStatusText();
}

function validateRequest(request) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new Error("Request JSON must be an object.");
  }

  if (request.type !== REQUEST_TYPE_EXPORT_SELECTED_VIDEOS) {
    throw new Error(`Unsupported request type: ${request.type}`);
  }

  if (request.outputDirectory !== DEFAULT_EXPORT_OUTPUT_DIR) {
    throw new Error(`Unsupported output directory: ${request.outputDirectory}`);
  }

  const preset = getPresetById(request.presetId);
  if (!preset || preset.presetFileName !== request.presetFileName) {
    throw new Error(`Unknown preset: ${request.presetId}`);
  }

  if (!Array.isArray(request.videos) || request.videos.length === 0) {
    throw new Error("Request must include selected videos.");
  }

  request.videos.forEach((video, index) => {
    if (!video || typeof video !== "object" || Array.isArray(video)) {
      throw new Error(`videos[${index}] must be an object.`);
    }

    if (!video.fileName || !video.absolutePath) {
      throw new Error(`videos[${index}] is missing fileName or absolutePath.`);
    }
  });

  return preset;
}

async function ensurePresetFile(preset) {
  const folders = await ensureBridgeSubfolders();
  const presetsFolder = folders[BRIDGE_DIRECTORY_NAMES.presets];
  const presetEntry = await getChildEntry(presetsFolder, preset.presetFileName);

  if (!presetEntry || !presetEntry.isFile) {
    throw new Error(`Preset file is missing: ${preset.presetFileName}`);
  }
}

async function writeFailedRequest(requestFile, request, error) {
  const folders = await ensureBridgeSubfolders();
  const failedRequest = Object.assign({}, request || {}, {
    id: request && request.id ? request.id : requestFile.name.replace(/\.json$/, ""),
    status: REQUEST_LIFECYCLE_STATE.failed,
    failedAt: new Date().toISOString(),
    error: {
      message: error && error.message ? error.message : String(error),
    },
  });

  await createOrOverwriteFile(
    folders[BRIDGE_DIRECTORY_NAMES.failed],
    requestFile.name,
    `${JSON.stringify(failedRequest, null, 2)}\n`
  );
  await deleteEntry(requestFile);
}

async function writeCompletedRequest(requestFile, request, result) {
  const folders = await ensureBridgeSubfolders();
  const completedRequest = Object.assign({}, request, {
    status: REQUEST_LIFECYCLE_STATE.completed,
    completedAt: new Date().toISOString(),
    result,
  });

  await createOrOverwriteFile(
    folders[BRIDGE_DIRECTORY_NAMES.completed],
    requestFile.name,
    `${JSON.stringify(completedRequest, null, 2)}\n`
  );
  await deleteEntry(requestFile);
}

async function processRequestFile(requestFile) {
  const requestId = requestFile.name.replace(/\.json$/, "");

  if (state.processingRequestIds.has(requestId)) {
    return;
  }

  state.processingRequestIds.add(requestId);

  try {
    const rawRequest = await requestFile.read();
    const request = JSON.parse(rawRequest);
    const preset = validateRequest(request);
    await ensurePresetFile(preset);

    throw new Error("Premiere import, sequence creation, and AME queueing are implemented in Stage 7.");
  } catch (error) {
    let parsedRequest = null;

    try {
      parsedRequest = JSON.parse(await requestFile.read());
    } catch (parseError) {
      parsedRequest = { id: requestId, type: REQUEST_TYPE_EXPORT_SELECTED_VIDEOS };
    }

    await writeFailedRequest(requestFile, parsedRequest, error);
    setLastActivity(`Request ${requestId} failed: ${error.message || error}`);
  } finally {
    state.processingRequestIds.delete(requestId);
  }
}

async function processRequests() {
  if (!state.bridgeFolder) {
    setLastActivity("Select a bridge folder before processing requests.");
    return;
  }

  const projectInfo = await getActiveProjectInfo();
  const currentStatus = getCurrentStatus(projectInfo);

  state.activeProjectName = projectInfo.activeProjectName;
  state.activeProjectPath = projectInfo.activeProjectPath;

  if (currentStatus.status !== BRIDGE_STATUS.ready) {
    setLastActivity(currentStatus.message);
    return;
  }

  const folders = await ensureBridgeSubfolders();
  const requestsFolder = folders[BRIDGE_DIRECTORY_NAMES.requests];
  const entries = await getFolderEntries(requestsFolder);
  const requestFiles = entries
    .filter((entry) => entry.isFile && entry.name.endsWith(".json"))
    .sort((first, second) => first.name.localeCompare(second.name));

  if (requestFiles.length === 0) {
    setLastActivity("No pending Premiere requests.");
    return;
  }

  await processRequestFile(requestFiles[0]);
}

function startTimers() {
  if (!state.heartbeatTimer) {
    state.heartbeatTimer = setInterval(refreshPanel, 5000);
  }

  if (!state.requestTimer) {
    state.requestTimer = setInterval(() => {
      processRequests().catch((error) => {
        setLastActivity(error.message || "Unable to process Premiere request.");
      });
    }, 4000);
  }
}

async function initialize() {
  ui.bridgeStatus = document.getElementById("bridgeStatus");
  ui.outputStatus = document.getElementById("outputStatus");
  ui.projectStatus = document.getElementById("projectStatus");
  ui.heartbeatStatus = document.getElementById("heartbeatStatus");
  ui.lastActivity = document.getElementById("lastActivity");

  document
    .getElementById("selectBridgeFolder")
    .addEventListener("click", () => selectBridgeFolder().catch((error) => {
      setLastActivity(error.message || "Unable to select bridge folder.");
    }));
  document
    .getElementById("selectOutputFolder")
    .addEventListener("click", () => selectOutputFolder().catch((error) => {
      setLastActivity(error.message || "Unable to select output folder.");
    }));
  document
    .getElementById("processNow")
    .addEventListener("click", () => processRequests().catch((error) => {
      setLastActivity(error.message || "Unable to process requests.");
    }));

  await restoreFolders();
  await refreshPanel();
  startTimers();
}

document.addEventListener("DOMContentLoaded", () => {
  initialize().catch((error) => {
    setLastActivity(error.message || "Unable to initialize Video Audit Bridge.");
  });
});
