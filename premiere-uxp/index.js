const PLUGIN_ID = "video-audit-premiere-bridge";
const PLUGIN_VERSION = "0.1.0";
const DEFAULT_BRIDGE_DIR = "~/VideoAudit/premiere-bridge";
const DEFAULT_EXPORT_OUTPUT_DIR = "/Users/joshlevy/Movies/Edited";
const EXPORT_PROJECT_BIN_NAME = "Video Audit Exports";
const REQUEST_TYPE_EXPORT_SELECTED_VIDEOS = "export-selected-videos";
const EXPORT_FRAME_WIDTH = 1920;
const EXPORT_FRAME_HEIGHT = 1080;

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

const PREMIERE_EXPORT_PRESETS = Object.freeze([
  Object.freeze({
    id: "h264-1080p-10mbps",
    label: "1920x1080 - 10",
    resolution: "1920x1080",
    presetFileName: "/Users/joshlevy/VideoAudit/premiere-bridge/presets/1920x1080 - 10.epr",
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

function normalizeComparablePath(value) {
  return normalizeNativePath(value).replace(/\\/g, "/");
}

function isAbsoluteFilePath(value) {
  return typeof value === "string" && (/^\//.test(value) || /^[A-Za-z]:[\\/]/.test(value));
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

function getRequestShortId(request) {
  return String(request && request.id ? request.id : "request").slice(0, 8);
}

function getFileBaseName(fileName) {
  const cleanName = String(fileName || "video").split(/[\\/]/).pop() || "video";
  const extensionIndex = cleanName.lastIndexOf(".");
  return extensionIndex > 0 ? cleanName.slice(0, extensionIndex) : cleanName;
}

function toSafeFileNamePart(value) {
  const safeValue = String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return safeValue || "video";
}

function getSequenceName(fileName, request) {
  return `Video Audit - ${getFileBaseName(fileName)} - ${getRequestShortId(request)}`;
}

function getOutputDirectoryPath() {
  const outputPath = normalizeNativePath(state.outputPath || getEntryPath(state.outputFolder));

  if (!outputPath) {
    throw new Error("Unable to resolve the native output folder path from the UXP token.");
  }

  if (outputPath !== DEFAULT_EXPORT_OUTPUT_DIR) {
    throw new Error(`Output folder must be ${DEFAULT_EXPORT_OUTPUT_DIR}.`);
  }

  return outputPath;
}

function getPremiereConstants(premiereApp) {
  return premiereApp && premiereApp.Constants ? premiereApp.Constants : {};
}

function getQueueToAmeExportType(premiereApp) {
  const constants = getPremiereConstants(premiereApp);

  if (constants.ExportType && constants.ExportType.QUEUE_TO_AME !== undefined) {
    return constants.ExportType.QUEUE_TO_AME;
  }

  if (
    premiereApp.EncoderManager &&
    premiereApp.EncoderManager.EXPORT_QUEUE_TO_AME !== undefined
  ) {
    return premiereApp.EncoderManager.EXPORT_QUEUE_TO_AME;
  }

  throw new Error("Premiere QUEUE_TO_AME export type is unavailable.");
}

async function getActiveProject() {
  const premiereApp = getPremiereApp();

  if (!premiereApp || !premiereApp.Project || !premiereApp.Project.getActiveProject) {
    throw new Error("Premiere UXP Project API is unavailable.");
  }

  const project = await premiereApp.Project.getActiveProject();

  if (!project) {
    throw new Error("No active Premiere project is open.");
  }

  return project;
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

function executeProjectAction(project, createAction, undoString) {
  if (!project || typeof project.executeTransaction !== "function") {
    throw new Error("Premiere project transactions are unavailable.");
  }

  const execute = () => {
    const transactionResult = project.executeTransaction((compoundAction) => {
      const action = createAction();

      if (!action) {
        throw new Error("Premiere did not create the requested action.");
      }

      const actionAdded = compoundAction.addAction(action);

      if (actionAdded === false) {
        throw new Error("Premiere could not add the action to the transaction.");
      }
    }, undoString);

    if (transactionResult === false) {
      throw new Error(`Premiere transaction failed: ${undoString}`);
    }
  };

  if (typeof project.lockedAccess === "function") {
    project.lockedAccess(execute);
    return;
  }

  execute();
}

async function getProjectItemId(projectItem) {
  try {
    return typeof projectItem.getId === "function" ? projectItem.getId() : null;
  } catch (error) {
    return null;
  }
}

function asFolderItem(projectItem) {
  if (!projectItem) {
    return null;
  }

  if (typeof projectItem.getItems === "function") {
    return projectItem;
  }

  const premiereApp = getPremiereApp();

  if (premiereApp && premiereApp.FolderItem && premiereApp.FolderItem.cast) {
    try {
      const folderItem = premiereApp.FolderItem.cast(projectItem);
      return folderItem && typeof folderItem.getItems === "function" ? folderItem : null;
    } catch (error) {
      return null;
    }
  }

  return null;
}

function asClipProjectItem(projectItem) {
  if (!projectItem) {
    return null;
  }

  if (typeof projectItem.getMediaFilePath === "function") {
    return projectItem;
  }

  const premiereApp = getPremiereApp();

  if (premiereApp && premiereApp.ClipProjectItem && premiereApp.ClipProjectItem.cast) {
    try {
      const clipProjectItem = premiereApp.ClipProjectItem.cast(projectItem);
      return clipProjectItem && typeof clipProjectItem.getMediaFilePath === "function"
        ? clipProjectItem
        : null;
    } catch (error) {
      return null;
    }
  }

  return null;
}

async function getProjectFolderItems(folderItem) {
  if (!folderItem || typeof folderItem.getItems !== "function") {
    return [];
  }

  return folderItem.getItems();
}

async function findProjectBinByName(folderItem, binName) {
  const items = await getProjectFolderItems(folderItem);
  const match = items.find((item) => item && item.name === binName);

  if (!match) {
    return null;
  }

  const folderMatch = asFolderItem(match);

  if (!folderMatch) {
    throw new Error(`Project item "${binName}" already exists but is not a bin.`);
  }

  return folderMatch;
}

async function getOrCreateExportBin(project) {
  if (!project || typeof project.getRootItem !== "function") {
    throw new Error("Premiere getRootItem API is unavailable.");
  }

  const rootItem = await project.getRootItem();
  const existingBin = await findProjectBinByName(rootItem, EXPORT_PROJECT_BIN_NAME);

  if (existingBin) {
    return existingBin;
  }

  if (!rootItem || typeof rootItem.createBinAction !== "function") {
    throw new Error("Premiere cannot create a project bin from the root item.");
  }

  executeProjectAction(
    project,
    () => rootItem.createBinAction(EXPORT_PROJECT_BIN_NAME, false),
    "Create Video Audit Exports bin"
  );

  const refreshedRootItem = await project.getRootItem();
  const createdBin = await findProjectBinByName(refreshedRootItem, EXPORT_PROJECT_BIN_NAME);

  if (!createdBin) {
    throw new Error(`Unable to create or find the "${EXPORT_PROJECT_BIN_NAME}" bin.`);
  }

  return createdBin;
}

async function collectProjectItemIds(folderItem, depth) {
  if (depth < 0) {
    return new Set();
  }

  const ids = new Set();
  const items = await getProjectFolderItems(folderItem);

  for (const item of items) {
    const itemId = await getProjectItemId(item);

    if (itemId) {
      ids.add(itemId);
    }

    const childFolder = asFolderItem(item);

    if (childFolder) {
      const childIds = await collectProjectItemIds(childFolder, depth - 1);
      childIds.forEach((childId) => ids.add(childId));
    }
  }

  return ids;
}

async function getProjectItemMediaPath(projectItem) {
  const clipProjectItem = asClipProjectItem(projectItem);

  if (!clipProjectItem) {
    return null;
  }

  try {
    return await clipProjectItem.getMediaFilePath();
  } catch (error) {
    return null;
  }
}

async function findClipProjectItemByPath(folderItem, absolutePath, ignoredIds, depth) {
  if (depth < 0) {
    return null;
  }

  const targetPath = normalizeComparablePath(absolutePath);
  const items = await getProjectFolderItems(folderItem);
  let fallbackMatch = null;

  for (const item of items) {
    const itemId = await getProjectItemId(item);
    const mediaPath = await getProjectItemMediaPath(item);

    if (mediaPath && normalizeComparablePath(mediaPath) === targetPath) {
      const clipProjectItem = asClipProjectItem(item);

      if (!ignoredIds.has(itemId)) {
        return clipProjectItem;
      }

      fallbackMatch = fallbackMatch || clipProjectItem;
    }

    const childFolder = asFolderItem(item);

    if (childFolder) {
      const childMatch = await findClipProjectItemByPath(
        childFolder,
        absolutePath,
        ignoredIds,
        depth - 1
      );

      if (childMatch) {
        return childMatch;
      }
    }
  }

  return fallbackMatch;
}

async function importVideoIntoBin(project, targetBin, video) {
  if (!project || typeof project.importFiles !== "function") {
    throw new Error("Premiere importFiles API is unavailable.");
  }

  const existingIds = await collectProjectItemIds(targetBin, 2);
  const importSucceeded = await project.importFiles(
    [video.absolutePath],
    true,
    targetBin,
    false
  );

  if (importSucceeded === false) {
    throw new Error(`Premiere could not import ${video.fileName}.`);
  }

  const importedClip = await findClipProjectItemByPath(
    targetBin,
    video.absolutePath,
    existingIds,
    2
  );

  if (!importedClip) {
    throw new Error(`Imported clip could not be resolved in the project bin: ${video.fileName}`);
  }

  return importedClip;
}

function applyScaleToFrameSize(project, clipProjectItem) {
  if (!clipProjectItem || typeof clipProjectItem.createSetScaleToFrameSizeAction !== "function") {
    return {
      applied: false,
      message: "Scale-to-frame action is unavailable; relying on the export preset.",
    };
  }

  try {
    executeProjectAction(
      project,
      () => clipProjectItem.createSetScaleToFrameSizeAction(),
      "Set Video Audit clip scale to frame size"
    );

    return { applied: true };
  } catch (error) {
    return {
      applied: false,
      message:
        error && error.message
          ? error.message
          : "Scale-to-frame action failed; relying on the export preset.",
    };
  }
}

async function applySequenceFrameSettings(project, sequence) {
  if (!sequence || typeof sequence.getSettings !== "function") {
    return {
      width: null,
      height: null,
      adjusted: false,
      message: "Sequence settings API is unavailable; relying on the export preset.",
    };
  }

  const premiereApp = getPremiereApp();
  const sequenceSettingsStatic = premiereApp ? premiereApp.SequenceSettings : null;
  const settings = await sequence.getSettings();
  let adjusted = false;

  if (
    settings &&
    typeof settings.getVideoFrameRect === "function" &&
    typeof settings.setVideoFrameRect === "function"
  ) {
    const frameRect = await settings.getVideoFrameRect();

    if (frameRect) {
      frameRect.width = EXPORT_FRAME_WIDTH;
      frameRect.height = EXPORT_FRAME_HEIGHT;
      await settings.setVideoFrameRect(frameRect);
      adjusted = true;
    }
  }

  if (settings && typeof settings.getPreviewFrameRect === "function") {
    const previewRect = await settings.getPreviewFrameRect();

    if (previewRect && typeof settings.setPreviewFrameRect === "function") {
      previewRect.width = EXPORT_FRAME_WIDTH;
      previewRect.height = EXPORT_FRAME_HEIGHT;
      await settings.setPreviewFrameRect(previewRect);
    }
  }

  if (
    settings &&
    typeof settings.setVideoPixelAspectRatio === "function" &&
    sequenceSettingsStatic &&
    sequenceSettingsStatic.PAR_SQUARE
  ) {
    await settings.setVideoPixelAspectRatio(sequenceSettingsStatic.PAR_SQUARE);
  }

  if (
    settings &&
    typeof settings.setVideoFieldType === "function" &&
    sequenceSettingsStatic &&
    sequenceSettingsStatic.VIDEO_FIELDTYPE_PROGRESSIVE !== undefined
  ) {
    await settings.setVideoFieldType(sequenceSettingsStatic.VIDEO_FIELDTYPE_PROGRESSIVE);
  }

  if (settings && typeof settings.setMaxRenderQuality === "function") {
    await settings.setMaxRenderQuality(true);
  }

  if (adjusted && typeof sequence.createSetSettingsAction === "function") {
    executeProjectAction(
      project,
      () => sequence.createSetSettingsAction(settings),
      "Set Video Audit sequence settings"
    );
  }

  if (typeof sequence.getFrameSize === "function") {
    const frameSize = await sequence.getFrameSize();

    return {
      width: frameSize && typeof frameSize.width === "number" ? frameSize.width : EXPORT_FRAME_WIDTH,
      height:
        frameSize && typeof frameSize.height === "number" ? frameSize.height : EXPORT_FRAME_HEIGHT,
      adjusted,
    };
  }

  return {
    width: EXPORT_FRAME_WIDTH,
    height: EXPORT_FRAME_HEIGHT,
    adjusted,
  };
}

async function createExportSequence(project, targetBin, clipProjectItem, request, video) {
  if (typeof project.createSequenceFromMedia !== "function") {
    throw new Error("Premiere createSequenceFromMedia API is unavailable.");
  }

  const sequenceName = getSequenceName(video.fileName, request);
  const sequence = await project.createSequenceFromMedia(
    sequenceName,
    [clipProjectItem],
    targetBin
  );

  if (!sequence) {
    throw new Error(`Premiere could not create a sequence for ${video.fileName}.`);
  }

  if (typeof project.openSequence === "function") {
    await project.openSequence(sequence);
  }

  const frameSize = await applySequenceFrameSettings(project, sequence);

  return {
    sequence,
    sequenceName,
    frameSize,
  };
}

function joinNativePath(directoryPath, fileName) {
  return `${normalizeNativePath(directoryPath)}/${fileName}`;
}

async function getOutputFileNames() {
  const entries = await getFolderEntries(state.outputFolder);
  return new Set(entries.filter((entry) => entry.isFile).map((entry) => entry.name));
}

async function buildOutputFilePath(video, request, reservedOutputNames) {
  const outputDirectory = getOutputDirectoryPath();
  const existingOutputNames = await getOutputFileNames();
  const safeBaseName = toSafeFileNamePart(getFileBaseName(video.fileName));
  const shortRequestId = getRequestShortId(request);
  const candidates = [
    `${safeBaseName}-1080p.mp4`,
    `${safeBaseName}-1080p-${shortRequestId}.mp4`,
  ];

  for (let index = 2; index < 1000; index += 1) {
    candidates.push(`${safeBaseName}-1080p-${shortRequestId}-${index}.mp4`);
  }

  const outputFileName = candidates.find(
    (candidate) => !existingOutputNames.has(candidate) && !reservedOutputNames.has(candidate)
  );

  if (!outputFileName) {
    throw new Error(`Unable to find an available output file name for ${video.fileName}.`);
  }

  reservedOutputNames.add(outputFileName);

  return {
    outputFileName,
    outputFilePath: joinNativePath(outputDirectory, outputFileName),
  };
}

function getEncoderManager(premiereApp) {
  if (!premiereApp || !premiereApp.EncoderManager || !premiereApp.EncoderManager.getManager) {
    throw new Error("Premiere EncoderManager API is unavailable.");
  }

  const encoderManager = premiereApp.EncoderManager.getManager();

  if (!encoderManager) {
    throw new Error("Premiere could not create an EncoderManager.");
  }

  if (encoderManager.isAMEInstalled === false) {
    throw new Error("Adobe Media Encoder is not installed.");
  }

  if (typeof encoderManager.exportSequence !== "function") {
    throw new Error("Premiere EncoderManager.exportSequence API is unavailable.");
  }

  return encoderManager;
}

async function queueSequenceInMediaEncoder(sequence, outputFilePath, presetFilePath) {
  const premiereApp = getPremiereApp();
  const encoderManager = getEncoderManager(premiereApp);
  const exportType = getQueueToAmeExportType(premiereApp);
  const exportQueued = await encoderManager.exportSequence(
    sequence,
    exportType,
    outputFilePath,
    presetFilePath,
    true
  );

  if (exportQueued === false) {
    throw new Error("Premiere did not queue the sequence in Adobe Media Encoder.");
  }

  return {
    exportType: "QUEUE_TO_AME",
    queuedAt: new Date().toISOString(),
  };
}

function validateRequest(request) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new Error("Request JSON must be an object.");
  }

  if (request.type !== REQUEST_TYPE_EXPORT_SELECTED_VIDEOS) {
    throw new Error(`Unsupported request type: ${request.type}`);
  }

  if (typeof request.id !== "string" || request.id.trim() === "") {
    throw new Error("Request is missing an id.");
  }

  if (request.status && !Object.values(REQUEST_LIFECYCLE_STATE).includes(request.status)) {
    throw new Error(`Unsupported request status: ${request.status}`);
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

    if (!isAbsoluteFilePath(video.absolutePath)) {
      throw new Error(`videos[${index}].absolutePath must be absolute.`);
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

  const presetPath = getEntryPath(presetEntry);

  if (!presetPath) {
    throw new Error(`Unable to resolve native path for preset: ${preset.presetFileName}`);
  }

  return {
    presetEntry,
    presetPath,
  };
}

async function writeFailedRequest(requestFile, request, error, partialResult) {
  const folders = await ensureBridgeSubfolders();
  const failedRequest = Object.assign({}, request || {}, {
    id: request && request.id ? request.id : requestFile.name.replace(/\.json$/, ""),
    status: REQUEST_LIFECYCLE_STATE.failed,
    failedAt: new Date().toISOString(),
    error: {
      message: error && error.message ? error.message : String(error),
    },
  });

  if (partialResult) {
    failedRequest.partialResult = partialResult;
  }

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

async function queueVideoExport({
  project,
  exportBin,
  presetFilePath,
  request,
  reservedOutputNames,
  video,
  videoIndex,
}) {
  setLastActivity(`Importing ${video.fileName} (${videoIndex + 1}/${request.videos.length}).`);

  const clipProjectItem = await importVideoIntoBin(project, exportBin, video);
  const scaleToFrame = applyScaleToFrameSize(project, clipProjectItem);
  const sequenceResult = await createExportSequence(
    project,
    exportBin,
    clipProjectItem,
    request,
    video
  );
  const output = await buildOutputFilePath(video, request, reservedOutputNames);

  setLastActivity(`Queueing ${output.outputFileName} in Adobe Media Encoder.`);

  const queueResult = await queueSequenceInMediaEncoder(
    sequenceResult.sequence,
    output.outputFilePath,
    presetFilePath
  );

  return {
    videoId: video.id,
    fileName: video.fileName,
    sourcePath: video.absolutePath,
    sequenceName: sequenceResult.sequenceName,
    sequenceGuid: sequenceResult.sequence.guid ? String(sequenceResult.sequence.guid) : null,
    outputFileName: output.outputFileName,
    outputPath: output.outputFilePath,
    presetId: request.presetId,
    presetFileName: request.presetFileName,
    frameSize: sequenceResult.frameSize,
    scaleToFrame,
    ...queueResult,
  };
}

async function processExportRequest(request, presetFilePath, partialResult) {
  const project = await getActiveProject();
  const exportBin = await getOrCreateExportBin(project);
  const reservedOutputNames = new Set();
  const queuedJobs = partialResult.queuedJobs;

  for (const [videoIndex, video] of request.videos.entries()) {
    const queuedJob = await queueVideoExport({
      project,
      exportBin,
      presetFilePath,
      request,
      reservedOutputNames,
      video,
      videoIndex,
    });

    queuedJobs.push(queuedJob);
  }

  return {
    queuedCount: queuedJobs.length,
    queuedJobs,
    outputDirectory: DEFAULT_EXPORT_OUTPUT_DIR,
    presetId: request.presetId,
    presetFileName: request.presetFileName,
  };
}

async function processRequestFile(requestFile) {
  const requestId = requestFile.name.replace(/\.json$/, "");

  if (state.processingRequestIds.has(requestId)) {
    return;
  }

  state.processingRequestIds.add(requestId);
  let request = null;
  let partialResult = null;

  try {
    const rawRequest = await requestFile.read();
    request = JSON.parse(rawRequest);
    const preset = validateRequest(request);
    const presetFile = await ensurePresetFile(preset);

    partialResult = {
      queuedJobs: [],
      outputDirectory: DEFAULT_EXPORT_OUTPUT_DIR,
      presetId: request.presetId,
      presetFileName: request.presetFileName,
    };

    const result = await processExportRequest(request, presetFile.presetPath, partialResult);

    await writeCompletedRequest(requestFile, request, result);
    setLastActivity(`Request ${requestId} queued ${result.queuedCount} AME job(s).`);
  } catch (error) {
    let parsedRequest = null;

    try {
      parsedRequest = JSON.parse(await requestFile.read());
    } catch (parseError) {
      parsedRequest = { id: requestId, type: REQUEST_TYPE_EXPORT_SELECTED_VIDEOS };
    }

    if (partialResult && partialResult.queuedJobs.length > 0) {
      partialResult.note = "Some Premiere or AME changes were already made before this failure.";
    } else {
      partialResult = null;
    }

    await writeFailedRequest(requestFile, parsedRequest, error, partialResult);
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
