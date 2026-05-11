const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const cors = require("cors");
const express = require("express");
require("dotenv").config();

const { auditVideos } = require("./utils/fileAudit");
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
const jobs = new Map();

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

  return null;
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

function createJob({ resolvedDirectory }) {
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
    const result = await auditVideos({
      directoryPath: job.resolvedDirectory,
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
    console.log("[Premiere Bridge] GET /api/premiere/status");
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

app.post("/api/audits", async (req, res) => {
  const validationError = validateAuditRequest(req.body);

  if (validationError) {
    res.status(400).json({
      status: "invalid_request",
      message: validationError,
    });
    return;
  }

  const { rootPath, sampleFile } = req.body;
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
