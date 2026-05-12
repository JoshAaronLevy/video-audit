const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const cors = require("cors");
const express = require("express");
const multer = require("multer");
require("dotenv").config();

const { auditSelectedVideoFiles, auditVideos } = require("./utils/fileAudit");
const {
  runAutoCrop,
  validateAutoCropRequest,
} = require("./utils/autoCrop");
const {
  executeMigration,
  scanMigration,
} = require("./utils/videoMigration");
const {
  createPremiereExportRequest,
  getPremiereStatus,
} = require("./utils/premiereBridge");

const DEFAULT_SEARCH_ROOTS = [
  "/Volumes/SanDisk SSD/Videos",
  "/Volumes/SanDisk SSD/Videos/Edited",
  "/Users/joshlevy/Movies",
  "/Users/joshlevy/Movies/Edited",
];
const SYSTEM_DIRECTORY_NAMES = new Set([
  ".Spotlight-V100",
  ".Trashes",
  ".fseventsd",
  ".TemporaryItems",
  "System Volume Information",
  "node_modules",
]);

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || "127.0.0.1";
const upload = multer({
  dest: path.join(os.tmpdir(), "video-audit-uploads"),
});
const jobs = new Map();
const autoCropJobs = new Map();
const migrationPlans = new Map();
const migrationJobs = new Map();

function getSearchRoots() {
  const configuredRoots = process.env.SEARCH_ROOTS
    ? process.env.SEARCH_ROOTS.split(",")
        .map((root) => root.trim())
        .filter(Boolean)
    : DEFAULT_SEARCH_ROOTS;

  return Array.from(new Set(configuredRoots));
}

function isSafeRelativePath(value) {
  if (!value || typeof value !== "string") return false;
  if (path.isAbsolute(value)) return false;
  if (value.split(/[\\/]+/).includes("..")) return false;

  const normalized = path.normalize(value);
  return normalized !== "." && normalized !== "..";
}

function getRelativePathSegments(value) {
  return value.split(/[\\/]+/).filter(Boolean);
}

function normalizeDisplayPath(value) {
  return value.split(/[\\/]+/).filter(Boolean).join("/");
}

function getCommonDirectory(filePaths) {
  if (filePaths.length === 0) {
    return null;
  }

  const directorySegments = filePaths.map((filePath) =>
    getRelativePathSegments(path.dirname(path.resolve(filePath)))
  );
  const firstSegments = directorySegments[0];
  const commonSegments = [];

  for (let index = 0; index < firstSegments.length; index += 1) {
    const segment = firstSegments[index];

    if (directorySegments.every((segments) => segments[index] === segment)) {
      commonSegments.push(segment);
      continue;
    }

    break;
  }

  const root = path.parse(path.resolve(filePaths[0])).root;
  return commonSegments.length > 0
    ? path.join(root, ...commonSegments)
    : root || null;
}

function getDisplayParts({ rootDirectory, filePath, fallbackRelativePath, fileName }) {
  const relativePath =
    rootDirectory && filePath
      ? path.relative(rootDirectory, filePath)
      : fallbackRelativePath || fileName;
  const normalizedRelativePath = normalizeDisplayPath(relativePath || fileName);
  const parts = normalizedRelativePath.split("/").filter(Boolean);

  return {
    displayFile: normalizedRelativePath || fileName,
    displayDirectory: parts.length > 1 ? parts.slice(0, -1).join("/") : "",
  };
}

function getResolvedDirectoryFromMatch({ matchedFilePath, relativePath, rootPath }) {
  const relativeSegments = getRelativePathSegments(relativePath);
  const matchedSegments = getRelativePathSegments(path.resolve(matchedFilePath));

  if (relativeSegments.length === 0) {
    return path.dirname(matchedFilePath);
  }

  const prefixSegments = matchedSegments.slice(0, -relativeSegments.length);
  return path.join(path.parse(matchedFilePath).root, ...prefixSegments, rootPath);
}

function getDirectResolutionCandidates({ searchRoot, rootPath, sampleFile }) {
  const candidates = [
    path.join(searchRoot, sampleFile.relativePath),
  ];
  const relativeSegments = getRelativePathSegments(sampleFile.relativePath);
  const searchRootName = path.basename(searchRoot);

  if (relativeSegments[0] === searchRootName && relativeSegments.length > 1) {
    candidates.push(path.join(searchRoot, ...relativeSegments.slice(1)));
  }

  if (relativeSegments[0] === rootPath && path.basename(searchRoot) === rootPath) {
    candidates.push(path.join(searchRoot, ...relativeSegments.slice(1)));
  }

  return Array.from(new Set(candidates));
}

function pathEndsWithSegments(filePath, tailSegments) {
  const fileSegments = getRelativePathSegments(path.resolve(filePath));

  if (tailSegments.length > fileSegments.length) {
    return false;
  }

  const endSegments = fileSegments.slice(-tailSegments.length);
  return endSegments.every((segment, index) => segment === tailSegments[index]);
}

async function findMatchingFilesUnderRoot({ searchRoot, sampleFile }) {
  const matches = [];
  const relativeSegments = getRelativePathSegments(sampleFile.relativePath);

  async function walk(currentDir) {
    let entries;

    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (SYSTEM_DIRECTORY_NAMES.has(entry.name)) {
          continue;
        }

        await walk(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;
      if (entry.name !== sampleFile.fileName) continue;
      if (!pathEndsWithSegments(fullPath, relativeSegments)) continue;

      matches.push(fullPath);
    }
  }

  await walk(searchRoot);
  return matches;
}

function validateAuditRequest(body) {
  if (!body || typeof body !== "object") {
    return "Request body is required.";
  }

  if (!isSafeRelativePath(body.rootPath)) {
    return "rootPath must be a relative folder path.";
  }

  if (!body.sampleFile || typeof body.sampleFile !== "object") {
    return "sampleFile is required.";
  }

  if (!body.sampleFile.fileName || typeof body.sampleFile.fileName !== "string") {
    return "sampleFile.fileName is required.";
  }

  if (!isSafeRelativePath(body.sampleFile.relativePath)) {
    return "sampleFile.relativePath must be a relative file path.";
  }

  if (
    body.includeBlackBorderAnalysis !== undefined &&
    typeof body.includeBlackBorderAnalysis !== "boolean"
  ) {
    return "includeBlackBorderAnalysis must be a boolean when provided.";
  }

  if (
    body.includeLowResolutionAnalysis !== undefined &&
    typeof body.includeLowResolutionAnalysis !== "boolean"
  ) {
    return "includeLowResolutionAnalysis must be a boolean when provided.";
  }

  if (
    body.includeLowResolutionAnalysis === false &&
    body.includeBlackBorderAnalysis !== true
  ) {
    return "At least one audit option must be selected.";
  }

  return null;
}

function parseRequestBoolean(value, defaultValue) {
  if (value === undefined) {
    return { value: defaultValue };
  }

  if (value === true || value === "true") {
    return { value: true };
  }

  if (value === false || value === "false") {
    return { value: false };
  }

  return { error: "Audit option values must be boolean." };
}

function parseFileMetadata(value) {
  if (value === undefined) {
    return [];
  }

  if (typeof value !== "string") {
    throw new Error("metadata must be a JSON string.");
  }

  const parsed = JSON.parse(value);

  if (!Array.isArray(parsed)) {
    throw new Error("metadata must be a JSON array.");
  }

  return parsed;
}

function validateFileAuditRequest({ files, includeLowResolutionAnalysis, includeBlackBorderAnalysis }) {
  if (!Array.isArray(files) || files.length === 0) {
    return "At least one file is required.";
  }

  if (includeLowResolutionAnalysis === false && includeBlackBorderAnalysis !== true) {
    return "At least one audit option must be selected.";
  }

  return null;
}

function buildSelectedFilesFromUpload({ uploadedFiles, metadata }) {
  const sourcePaths = metadata
    .map((item) =>
      item && typeof item.sourcePath === "string" && path.isAbsolute(item.sourcePath)
        ? item.sourcePath
        : null
    );
  const allFilesHaveSourcePaths =
    uploadedFiles.length > 0 &&
    sourcePaths.length === uploadedFiles.length &&
    sourcePaths.every(Boolean);
  const rootDirectory = allFilesHaveSourcePaths
    ? getCommonDirectory(sourcePaths)
    : "Selected files";

  const selectedFiles = uploadedFiles.map((file, index) => {
    const item =
      metadata[index] && typeof metadata[index] === "object" ? metadata[index] : {};
    const sourcePath = allFilesHaveSourcePaths ? sourcePaths[index] : null;
    const fileName =
      typeof item.fileName === "string" && item.fileName
        ? item.fileName
        : file.originalname;
    const relativePath =
      typeof item.relativePath === "string" && item.relativePath
        ? item.relativePath
        : fileName;
    const displayParts = getDisplayParts({
      rootDirectory: allFilesHaveSourcePaths ? rootDirectory : null,
      filePath: sourcePath,
      fallbackRelativePath: relativePath,
      fileName,
    });

    return {
      analysisPath: sourcePath || file.path,
      resultPath: sourcePath || file.path,
      fileName,
      ...displayParts,
    };
  });

  return {
    rootDirectory,
    selectedFiles,
  };
}

async function resolveSelectedFolder({ rootPath, sampleFile }) {
  const matches = new Map();
  const searchRoots = getSearchRoots();

  for (const searchRoot of searchRoots) {
    const directCandidates = getDirectResolutionCandidates({
      searchRoot,
      rootPath,
      sampleFile,
    });

    for (const matchedFilePath of directCandidates) {
      let stat;

      try {
        stat = await fs.stat(matchedFilePath);
      } catch {
        continue;
      }

      if (!stat.isFile()) continue;
      if (path.basename(matchedFilePath) !== sampleFile.fileName) continue;

      const resolvedDirectory = getResolvedDirectoryFromMatch({
        matchedFilePath,
        relativePath: sampleFile.relativePath,
        rootPath,
      });

      matches.set(`${matchedFilePath}::${resolvedDirectory}`, {
        matchedFilePath,
        resolvedDirectory,
        confidence: 100,
      });
    }
  }

  if (matches.size > 0) {
    return Array.from(matches.values());
  }

  for (const searchRoot of searchRoots) {
    const matchingFiles = await findMatchingFilesUnderRoot({
      searchRoot,
      sampleFile,
    });

    for (const matchedFilePath of matchingFiles) {
      const resolvedDirectory = getResolvedDirectoryFromMatch({
        matchedFilePath,
        relativePath: sampleFile.relativePath,
        rootPath,
      });

      matches.set(`${matchedFilePath}::${resolvedDirectory}`, {
        matchedFilePath,
        resolvedDirectory,
        confidence: 90,
      });
    }
  }

  return Array.from(matches.values());
}

function createJob({
  resolvedDirectory,
  selectedFiles = null,
  includeLowResolutionAnalysis = true,
  includeBlackBorderAnalysis = false,
}) {
  const id = crypto.randomUUID();
  const job = {
    id,
    status: "queued",
    phase: "resolve",
    resolvedDirectory,
    totalFiles: 0,
    processedFiles: 0,
    skippedFiles: 0,
    flaggedCount: 0,
    errorCount: 0,
    currentFile: "",
    message: "Selected folder resolved.",
    result: null,
    error: null,
    includeLowResolutionAnalysis,
    includeBlackBorderAnalysis,
    selectedFiles,
    listeners: new Set(),
  };

  jobs.set(id, job);
  return job;
}

function serializeJob(job) {
  return {
    jobId: job.id,
    status: job.status,
    phase: job.phase,
    resolvedDirectory: job.resolvedDirectory,
    totalFiles: job.totalFiles,
    processedFiles: job.processedFiles,
    skippedFiles: job.skippedFiles,
    flaggedCount: job.flaggedCount,
    errorCount: job.errorCount,
    currentFile: job.currentFile,
    message: job.message,
    error: job.error,
    includeLowResolutionAnalysis: job.includeLowResolutionAnalysis,
    includeBlackBorderAnalysis: job.includeBlackBorderAnalysis,
    selectedFileCount: Array.isArray(job.selectedFiles)
      ? job.selectedFiles.length
      : null,
  };
}

function broadcast(job, eventName, data = serializeJob(job)) {
  for (const listener of job.listeners) {
    listener(eventName, data);
  }
}

function updateJobFromProgress(job, progress) {
  job.status = "running";
  job.phase = progress.phase ?? job.phase;
  job.totalFiles = progress.totalFiles ?? job.totalFiles;
  job.processedFiles = progress.processedFiles ?? job.processedFiles;
  job.skippedFiles = progress.skippedFiles ?? job.skippedFiles;
  job.flaggedCount = progress.flaggedCount ?? job.flaggedCount;
  job.errorCount = progress.errorCount ?? job.errorCount;
  job.currentFile = progress.currentFile ?? job.currentFile;
  job.message = progress.message ?? job.message;
}

async function runAuditJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;

  job.status = "running";
  job.phase = "walking";
  job.message = "Finding video files...";
  broadcast(job, "progress");

  try {
    const result = Array.isArray(job.selectedFiles)
      ? await auditSelectedVideoFiles({
          files: job.selectedFiles,
          rootDirectoryPath: job.resolvedDirectory,
          includeLowResolutionAnalysis: job.includeLowResolutionAnalysis,
          includeBlackBorderAnalysis: job.includeBlackBorderAnalysis,
          onProgress(progress) {
            updateJobFromProgress(job, progress);

            if (progress.phase !== "complete") {
              broadcast(job, "progress");
            }
          },
        })
      : await auditVideos({
          directoryPath: job.resolvedDirectory,
          includeLowResolutionAnalysis: job.includeLowResolutionAnalysis,
          includeBlackBorderAnalysis: job.includeBlackBorderAnalysis,
          onProgress(progress) {
            updateJobFromProgress(job, progress);

            if (progress.phase !== "complete") {
              broadcast(job, "progress");
            }
          },
        });

    job.status = "complete";
    job.phase = "complete";
    job.totalFiles = result.summary.totalFiles;
    job.processedFiles = result.summary.scannedVideos;
    job.flaggedCount = result.summary.flaggedCount;
    job.errorCount = result.summary.errorCount;
    job.currentFile = "";
    job.message = "Audit complete.";
    job.result = result;

    broadcast(job, "complete", {
      jobId: job.id,
      status: job.status,
      phase: job.phase,
      flaggedCount: job.flaggedCount,
      errorCount: job.errorCount,
      totalFiles: job.totalFiles,
      processedFiles: job.processedFiles,
      message: job.message,
    });
  } catch (error) {
    job.status = "error";
    job.phase = "error";
    job.error = error.message;
    job.message = error.message;

    broadcast(job, "error", {
      jobId: job.id,
      status: job.status,
      phase: job.phase,
      message: job.message,
    });
  }
}

function sendSse(res, eventName, data) {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function createAutoCropJob({ videos, outputRootDir }) {
  const id = crypto.randomUUID();
  const job = {
    id,
    status: "queued",
    phase: "queued",
    outputRootDir,
    outputDir: null,
    totalFiles: videos.length,
    processedFiles: 0,
    succeededCount: 0,
    skippedCount: 0,
    errorCount: 0,
    currentFile: "",
    message: "Auto-crop job queued.",
    videos,
    result: null,
    error: null,
    listeners: new Set(),
  };

  autoCropJobs.set(id, job);
  return job;
}

function serializeAutoCropJob(job) {
  return {
    jobId: job.id,
    status: job.status,
    phase: job.phase,
    outputRootDir: job.outputRootDir,
    outputDir: job.outputDir,
    totalFiles: job.totalFiles,
    processedFiles: job.processedFiles,
    succeededCount: job.succeededCount,
    skippedCount: job.skippedCount,
    errorCount: job.errorCount,
    currentFile: job.currentFile,
    message: job.message,
    error: job.error,
  };
}

function broadcastAutoCrop(job, eventName, data = serializeAutoCropJob(job)) {
  for (const listener of job.listeners) {
    listener(eventName, data);
  }
}

function updateAutoCropJobFromProgress(job, progress) {
  job.status = "running";
  job.phase = progress.phase ?? job.phase;
  job.outputDir = progress.outputDir ?? job.outputDir;
  job.totalFiles = progress.totalFiles ?? job.totalFiles;
  job.processedFiles = progress.processedFiles ?? job.processedFiles;
  job.succeededCount = progress.succeededCount ?? job.succeededCount;
  job.skippedCount = progress.skippedCount ?? job.skippedCount;
  job.errorCount = progress.errorCount ?? job.errorCount;
  job.currentFile = progress.currentFile ?? job.currentFile;
  job.message = progress.message ?? job.message;
}

async function runAutoCropJob(jobId) {
  const job = autoCropJobs.get(jobId);
  if (!job) return;

  job.status = "running";
  job.phase = "cropping";
  job.message = "Cropping selected videos...";
  broadcastAutoCrop(job, "progress");

  try {
    const result = await runAutoCrop({
      videos: job.videos,
      outputRootDir: job.outputRootDir,
      onProgress(progress) {
        updateAutoCropJobFromProgress(job, progress);

        if (progress.phase !== "complete") {
          broadcastAutoCrop(job, "progress");
        }
      },
    });

    job.status = "complete";
    job.phase = "complete";
    job.outputDir = result.outputDir;
    job.totalFiles = result.summary.requested;
    job.processedFiles = result.summary.requested;
    job.succeededCount = result.summary.succeeded;
    job.skippedCount = result.summary.skipped;
    job.errorCount = result.summary.failed;
    job.currentFile = "";
    job.message = "Auto-crop complete.";
    job.result = result;

    broadcastAutoCrop(job, "complete", serializeAutoCropJob(job));
  } catch (error) {
    job.status = "error";
    job.phase = "error";
    job.error = error.message;
    job.message = error.message;

    broadcastAutoCrop(job, "error", serializeAutoCropJob(job));
  }
}

function createMigrationJob(plan) {
  const job = {
    id: plan.migrationId,
    status: "queued",
    phase: "planning",
    totalFiles: plan.items.length,
    processedFiles: 0,
    copiedCount: 0,
    archivedCount: 0,
    failedCount: 0,
    currentFile: "",
    message: "Migration job queued.",
    plan,
    result: null,
    error: null,
    listeners: new Set(),
  };

  migrationJobs.set(job.id, job);
  return job;
}

function serializeMigrationJob(job) {
  return {
    migrationId: job.id,
    status: job.status,
    phase: job.phase,
    totalFiles: job.totalFiles,
    processedFiles: job.processedFiles,
    copiedCount: job.copiedCount,
    archivedCount: job.archivedCount,
    failedCount: job.failedCount,
    currentFile: job.currentFile,
    message: job.message,
    error: job.error,
  };
}

function broadcastMigration(job, eventName, data = serializeMigrationJob(job)) {
  for (const listener of job.listeners) {
    listener(eventName, data);
  }
}

function updateMigrationJobFromProgress(job, progress) {
  job.status = progress.status === "complete" ? "complete" : "running";
  job.phase = progress.phase ?? job.phase;
  job.totalFiles = progress.totalFiles ?? job.totalFiles;
  job.processedFiles = progress.processedFiles ?? job.processedFiles;
  job.copiedCount = progress.copiedCount ?? job.copiedCount;
  job.archivedCount = progress.archivedCount ?? job.archivedCount;
  job.failedCount = progress.failedCount ?? job.failedCount;
  job.currentFile = progress.currentFile ?? job.currentFile;
  job.message = progress.message ?? job.message;
}

async function runMigrationJob(migrationId) {
  const job = migrationJobs.get(migrationId);
  if (!job) return;

  job.status = "running";
  job.phase = "copying_temp";
  job.message = "Starting migration...";
  broadcastMigration(job, "progress");

  try {
    const result = await executeMigration(job.plan, {
      onProgress(progress) {
        updateMigrationJobFromProgress(job, progress);

        if (progress.phase !== "complete") {
          broadcastMigration(job, "progress");
        }
      },
    });

    job.status = "complete";
    job.phase = "complete";
    job.processedFiles = job.totalFiles;
    job.copiedCount = result.summary.filesCopiedToDestination;
    job.archivedCount = result.summary.destinationMatchesArchived;
    job.failedCount = result.summary.failedItems;
    job.currentFile = "";
    job.message = "Migration complete.";
    job.result = result;

    broadcastMigration(job, "complete", serializeMigrationJob(job));
  } catch (error) {
    job.status = "error";
    job.phase = "error";
    job.error = error.message;
    job.message = error.message;

    broadcastMigration(job, "error", serializeMigrationJob(job));
  }
}

const app = express();

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
  })
);
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/premiere/status", async (req, res) => {
  try {
    const status = await getPremiereStatus();
    console.log("[Premiere Bridge] Status result.", {
      status: status.status,
      message: status.message,
      premiereRunning: status.premiere?.running,
      bridgeConnected: status.bridge?.connected,
      bridgeReason: status.bridge?.reason,
    });
    res.json(status);
  } catch (error) {
    console.error("[Premiere Bridge] Status endpoint failed.", {
      message:
        error instanceof Error
          ? error.message
          : "Unable to check Premiere bridge status.",
    });
    res.status(500).json({
      status: "error",
      message:
        error instanceof Error
          ? error.message
          : "Unable to check Premiere bridge status.",
    });
  }
});

app.post("/api/premiere/export-requests", async (req, res) => {
  try {
    const result = await createPremiereExportRequest(req.body);
    res.status(result.statusCode).json(result.payload);
  } catch (error) {
    res.status(500).json({
      status: "error",
      message:
        error instanceof Error
          ? error.message
          : "Unable to queue Premiere export request.",
    });
  }
});

app.post("/api/adjustments/auto-crop", async (req, res) => {
  const validation = await validateAutoCropRequest(req.body);

  if (!validation.ok) {
    res.status(400).json({
      status: "invalid_request",
      message: validation.error,
    });
    return;
  }

  const job = createAutoCropJob({
    videos: validation.videos,
    outputRootDir: validation.outputRootDir,
  });

  setImmediate(() => {
    runAutoCropJob(job.id);
  });

  res.status(202).json({
    jobId: job.id,
    status: "started",
    outputRootDir: job.outputRootDir,
  });
});

app.get("/api/adjustments/auto-crop/:jobId", (req, res) => {
  const job = autoCropJobs.get(req.params.jobId);

  if (!job) {
    res.status(404).json({
      status: "not_found",
      message: "Auto-crop job not found.",
    });
    return;
  }

  res.json(serializeAutoCropJob(job));
});

app.get("/api/adjustments/auto-crop/:jobId/events", (req, res) => {
  const job = autoCropJobs.get(req.params.jobId);

  if (!job) {
    res.status(404).json({
      status: "not_found",
      message: "Auto-crop job not found.",
    });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const listener = (eventName, data) => {
    sendSse(res, eventName, data);

    if (eventName === "complete" || eventName === "error") {
      job.listeners.delete(listener);
      res.end();
    }
  };

  job.listeners.add(listener);
  sendSse(res, "progress", serializeAutoCropJob(job));

  if (job.status === "complete") {
    listener("complete", serializeAutoCropJob(job));
    return;
  }

  if (job.status === "error") {
    listener("error", serializeAutoCropJob(job));
    return;
  }

  req.on("close", () => {
    job.listeners.delete(listener);
  });
});

app.get("/api/adjustments/auto-crop/:jobId/result", (req, res) => {
  const job = autoCropJobs.get(req.params.jobId);

  if (!job) {
    res.status(404).json({
      status: "not_found",
      message: "Auto-crop job not found.",
    });
    return;
  }

  if (job.status !== "complete") {
    res.json({
      jobId: job.id,
      status: job.status,
      message: "Auto-crop is not complete yet.",
    });
    return;
  }

  res.json({
    jobId: job.id,
    status: job.status,
    summary: job.result.summary,
    outputDir: job.result.outputDir,
    manifestPath: job.result.manifestPath,
    items: job.result.items,
  });
});

app.post("/api/migrations/scan", async (req, res) => {
  try {
    const result = await scanMigration(req.body);

    if (!result.ok) {
      res.status(400).json({
        status: "invalid_request",
        message: result.error,
      });
      return;
    }

    migrationPlans.set(result.plan.migrationId, result.plan);
    res.json(result.plan);
  } catch (error) {
    res.status(500).json({
      status: "error",
      message:
        error instanceof Error
          ? error.message
          : "Unable to create migration scan.",
    });
  }
});

app.post("/api/migrations/execute", (req, res) => {
  const migrationId = req.body?.migrationId;

  if (typeof migrationId !== "string" || migrationId.trim() === "") {
    res.status(400).json({
      status: "invalid_request",
      message: "migrationId is required.",
    });
    return;
  }

  const plan = migrationPlans.get(migrationId);

  if (!plan) {
    res.status(404).json({
      status: "not_found",
      message: "Migration plan not found. Run /api/migrations/scan first.",
    });
    return;
  }

  if (migrationJobs.has(migrationId)) {
    res.status(409).json({
      migrationId,
      status: "already_started",
      message: "Migration has already been started.",
    });
    return;
  }

  const job = createMigrationJob(plan);

  setImmediate(() => {
    runMigrationJob(job.id);
  });

  res.status(202).json({
    migrationId: job.id,
    status: "started",
  });
});

app.get("/api/migrations/:migrationId/events", (req, res) => {
  const job = migrationJobs.get(req.params.migrationId);

  if (!job) {
    res.status(404).json({
      status: "not_found",
      message: "Migration job not found.",
    });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const listener = (eventName, data) => {
    sendSse(res, eventName, data);

    if (eventName === "complete" || eventName === "error") {
      job.listeners.delete(listener);
      res.end();
    }
  };

  job.listeners.add(listener);
  sendSse(res, "progress", serializeMigrationJob(job));

  if (job.status === "complete") {
    listener("complete", serializeMigrationJob(job));
    return;
  }

  if (job.status === "error") {
    listener("error", serializeMigrationJob(job));
    return;
  }

  req.on("close", () => {
    job.listeners.delete(listener);
  });
});

app.get("/api/migrations/:migrationId/result", (req, res) => {
  const job = migrationJobs.get(req.params.migrationId);

  if (!job) {
    res.status(404).json({
      status: "not_found",
      message: "Migration job not found.",
    });
    return;
  }

  if (job.status !== "complete") {
    res.json({
      migrationId: job.id,
      status: job.status,
      message: "Migration is not complete yet.",
    });
    return;
  }

  res.json({
    migrationId: job.id,
    status: job.status,
    summary: job.result.summary,
    manifestPath: job.result.manifestPath,
    operationLogPath: job.result.operationLogPath,
    items: job.result.items,
  });
});

app.post("/api/audits", async (req, res) => {
  const validationError = validateAuditRequest(req.body);

  if (validationError) {
    res.status(400).json({
      status: "invalid_request",
      message: validationError,
    });
    return;
  }

  const {
    rootPath,
    sampleFile,
    includeLowResolutionAnalysis = true,
    includeBlackBorderAnalysis = false,
  } = req.body;
  const matches = await resolveSelectedFolder({ rootPath, sampleFile });

  if (matches.length === 0) {
    res.status(404).json({
      status: "not_found",
      message: "Could not resolve selected folder from sample file.",
    });
    return;
  }

  if (matches.length > 1) {
    res.status(409).json({
      status: "multiple_matches",
      message: "Multiple possible folders were found.",
      matches,
    });
    return;
  }

  const job = createJob({
    resolvedDirectory: matches[0].resolvedDirectory,
    includeLowResolutionAnalysis,
    includeBlackBorderAnalysis,
  });

  setImmediate(() => {
    runAuditJob(job.id);
  });

  res.status(202).json({
    jobId: job.id,
    status: "started",
    resolvedDirectory: job.resolvedDirectory,
  });
});

app.post("/api/audits/files", upload.array("files"), async (req, res) => {
  const includeLowResolution = parseRequestBoolean(
    req.body.includeLowResolutionAnalysis,
    true
  );
  const includeBlackBorder = parseRequestBoolean(
    req.body.includeBlackBorderAnalysis,
    false
  );

  if (includeLowResolution.error || includeBlackBorder.error) {
    res.status(400).json({
      status: "invalid_request",
      message: includeLowResolution.error || includeBlackBorder.error,
    });
    return;
  }

  let metadata;

  try {
    metadata = parseFileMetadata(req.body.metadata);
  } catch (error) {
    res.status(400).json({
      status: "invalid_request",
      message: error.message,
    });
    return;
  }

  const uploadedFiles = Array.isArray(req.files) ? req.files : [];
  const validationError = validateFileAuditRequest({
    files: uploadedFiles,
    includeLowResolutionAnalysis: includeLowResolution.value,
    includeBlackBorderAnalysis: includeBlackBorder.value,
  });

  if (validationError) {
    res.status(400).json({
      status: "invalid_request",
      message: validationError,
    });
    return;
  }

  const { rootDirectory, selectedFiles } = buildSelectedFilesFromUpload({
    uploadedFiles,
    metadata,
  });
  const job = createJob({
    resolvedDirectory: rootDirectory,
    selectedFiles,
    includeLowResolutionAnalysis: includeLowResolution.value,
    includeBlackBorderAnalysis: includeBlackBorder.value,
  });

  job.message = "Selected files prepared.";

  setImmediate(() => {
    runAuditJob(job.id);
  });

  res.status(202).json({
    jobId: job.id,
    status: "started",
    resolvedDirectory: job.resolvedDirectory,
  });
});

app.get("/api/audits/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);

  if (!job) {
    res.status(404).json({
      status: "not_found",
      message: "Audit job not found.",
    });
    return;
  }

  res.json(serializeJob(job));
});

app.get("/api/audits/:jobId/events", (req, res) => {
  const job = jobs.get(req.params.jobId);

  if (!job) {
    res.status(404).json({
      status: "not_found",
      message: "Audit job not found.",
    });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const listener = (eventName, data) => {
    sendSse(res, eventName, data);

    if (eventName === "complete" || eventName === "error") {
      job.listeners.delete(listener);
      res.end();
    }
  };

  job.listeners.add(listener);
  sendSse(res, "progress", serializeJob(job));

  if (job.status === "complete") {
    listener("complete", {
      jobId: job.id,
      status: job.status,
      phase: job.phase,
      flaggedCount: job.flaggedCount,
      errorCount: job.errorCount,
      totalFiles: job.totalFiles,
      processedFiles: job.processedFiles,
      message: job.message,
    });
    return;
  }

  if (job.status === "error") {
    listener("error", {
      jobId: job.id,
      status: job.status,
      phase: job.phase,
      message: job.message,
    });
    return;
  }

  req.on("close", () => {
    job.listeners.delete(listener);
  });
});

app.get("/api/audits/:jobId/result", (req, res) => {
  const job = jobs.get(req.params.jobId);

  if (!job) {
    res.status(404).json({
      status: "not_found",
      message: "Audit job not found.",
    });
    return;
  }

  if (job.status !== "complete") {
    res.json({
      jobId: job.id,
      status: job.status,
      message: "Audit is not complete yet.",
    });
    return;
  }

  res.json({
    jobId: job.id,
    status: job.status,
    summary: {
      resolvedDirectory: job.resolvedDirectory,
      totalFiles: job.result.summary.totalFiles,
      flaggedCount: job.result.summary.flaggedCount,
      errorCount: job.result.summary.errorCount,
    },
    videos: job.result.videos,
  });
});

app.listen(PORT, HOST, () => {
  console.log(`Backend running on http://${HOST}:${PORT}`);
});
