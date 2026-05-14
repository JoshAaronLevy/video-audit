const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { isSupportedVideoExtension } = require("./videoExtensions");

function expandHomeDir(value) {
  if (typeof value !== "string") {
    return value;
  }

  if (value === "~") {
    return os.homedir();
  }

  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }

  return value;
}

const configuredThumbnailDir = expandHomeDir(
  process.env.VIDEO_AUDIT_THUMBNAIL_DIR
);
const THUMBNAIL_DIR =
  configuredThumbnailDir && path.isAbsolute(configuredThumbnailDir)
    ? configuredThumbnailDir
    : path.join(os.homedir(), "VideoAudit", "thumbnails");

function nowIsoString() {
  return new Date().toISOString();
}

function getVideoPath(video) {
  const candidates = [video?.path, video?.absolutePath, video?.sourcePath];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim() !== "") {
      return candidate.trim();
    }
  }

  return "";
}

function getOriginalFileName(video, sourcePath) {
  const candidates = [video?.fileName, video?.displayFile];

  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }

    const fileName = path.basename(candidate.trim().replace(/\\/g, "/"));

    if (fileName && fileName !== "." && fileName !== path.sep) {
      return fileName;
    }
  }

  return sourcePath ? path.basename(sourcePath) : "";
}

function readFiniteNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function createRequestError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function pickThumbnailTimestamp(durationSeconds) {
  const duration = Number(durationSeconds);

  if (!Number.isFinite(duration) || duration <= 0) {
    return 1;
  }

  if (duration <= 3) {
    return Math.max(duration / 2, 0);
  }

  return Math.min(Math.max(duration * 0.1, 3), Math.max(duration - 1, 0));
}

function getMaxPreviewFrameCount(durationSeconds) {
  const duration = Number(durationSeconds);

  if (!Number.isFinite(duration) || duration <= 0) return 4;
  if (duration <= 30) return 4;
  if (duration <= 120) return 6;
  if (duration <= 600) return 10;
  if (duration <= 1800) return 14;
  if (duration <= 2700) return 18;
  if (duration <= 3600) return 22;
  return 26;
}

function formatTimestampLabel(timestampSeconds) {
  const totalSeconds = Math.max(0, Math.floor(Number(timestampSeconds) || 0));
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const parts =
    hours > 0
      ? [hours, minutes, seconds]
      : [minutes, seconds];

  return parts
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

function buildVideoCacheHash({ filePath, modifiedAtMs, sizeBytes }) {
  const key = `${filePath}:${modifiedAtMs ?? ""}:${sizeBytes ?? ""}`;
  return crypto.createHash("sha1").update(key).digest("hex");
}

function buildThumbnailFileName({ filePath, modifiedAtMs, sizeBytes }) {
  const hash = buildVideoCacheHash({ filePath, modifiedAtMs, sizeBytes });
  return `${hash}.jpg`;
}

function sanitizeCacheSegment(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function buildPreviewFrameFileName({
  batchId,
  filePath,
  index,
  modifiedAtMs,
  sizeBytes,
  timestampSeconds,
  videoHash,
}) {
  const safeBatchId = sanitizeCacheSegment(batchId) || "default";
  const paddedIndex = String(index).padStart(3, "0");
  const frameKey = [
    filePath,
    modifiedAtMs ?? "",
    sizeBytes ?? "",
    batchId,
    index,
    timestampSeconds,
  ].join(":");
  const frameHash = crypto
    .createHash("sha1")
    .update(frameKey)
    .digest("hex")
    .slice(0, 12);

  return `${videoHash}-preview-${safeBatchId}-${paddedIndex}-${frameHash}.jpg`;
}

function getModifiedAtMs(video, stat) {
  const directValue =
    readFiniteNumber(video?.modifiedAtMs) ?? readFiniteNumber(video?.mtimeMs);

  if (directValue !== null) {
    return directValue;
  }

  if (typeof video?.modifiedAt === "string") {
    const parsed = Date.parse(video.modifiedAt);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return stat.mtimeMs;
}

function createThumbnailMetadata({
  cached,
  generated,
  thumbnailFileName,
  thumbnailPath,
  timestampSeconds,
}) {
  return {
    generated,
    cached,
    fileName: thumbnailFileName,
    url: `/api/thumbnails/${encodeURIComponent(thumbnailFileName)}`,
    path: thumbnailPath,
    timestampSeconds,
  };
}

function createPreviewFrameThumbnailMetadata({
  cached,
  generated,
  thumbnailFileName,
  thumbnailPath,
}) {
  return {
    generated,
    cached,
    fileName: thumbnailFileName,
    url: `/api/thumbnails/${encodeURIComponent(thumbnailFileName)}`,
    path: thumbnailPath,
  };
}

function runFfmpegThumbnail({
  inputPath,
  outputPath,
  scaleFilter = "scale=320:-1",
  timestampSeconds,
}) {
  return new Promise((resolve) => {
    const args = [
      "-y",
      "-ss",
      String(timestampSeconds),
      "-i",
      inputPath,
      "-frames:v",
      "1",
      "-vf",
      scaleFilter,
      "-q:v",
      "3",
      outputPath,
    ];

    const child = spawn("ffmpeg", args);
    let stderr = "";

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (error) => {
      resolve({
        ok: false,
        error: error.message,
      });
    });

    child.on("close", (code) => {
      if (code !== 0) {
        resolve({
          ok: false,
          error: stderr || `ffmpeg exited with code ${code}`,
        });
        return;
      }

      resolve({ ok: true });
    });
  });
}

function createFailedItem({ video, filePath, fileName, error }) {
  return {
    id: video?.id,
    fileName,
    path: filePath,
    thumbnail: {
      generated: false,
      error,
    },
  };
}

async function readPreviewVideoInput(video) {
  if (!video || typeof video !== "object" || Array.isArray(video)) {
    throw createRequestError("video is required.");
  }

  const filePath = getVideoPath(video);
  const fileName = getOriginalFileName(video, filePath);

  if (!filePath || !path.isAbsolute(filePath)) {
    throw createRequestError("Video path must be an absolute path.");
  }

  const extension = path.extname(filePath).toLowerCase();

  if (!isSupportedVideoExtension(extension)) {
    throw createRequestError("Unsupported video file extension.");
  }

  let stat;

  try {
    stat = await fs.stat(filePath);
  } catch {
    throw createRequestError("Video file does not exist or is unreadable.");
  }

  if (!stat.isFile()) {
    throw createRequestError("Video path must point to a file.");
  }

  const durationSeconds = readFiniteNumber(video?.durationSeconds);
  const sizeBytes =
    readFiniteNumber(video?.sizeBytes) ??
    readFiniteNumber(video?.fileSystemSizeBytes) ??
    stat.size;
  const modifiedAtMs = getModifiedAtMs(video, stat);

  return {
    id: video?.id,
    fileName,
    filePath,
    durationSeconds,
    modifiedAtMs,
    sizeBytes,
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeTimestamp(value) {
  return Number(value.toFixed(3));
}

function getFreshOffset({ count, seed }) {
  if (!Number.isFinite(seed) || count <= 0) {
    return 0;
  }

  const normalized = (seed % 997) / 997;
  return ((normalized - 0.5) * 0.9) / count;
}

function buildPreviewTimestamps({
  batchKind,
  count,
  durationSeconds,
  seed = 0,
}) {
  const duration = Number(durationSeconds);

  if (!Number.isFinite(duration) || duration <= 0) {
    return Array.from({ length: count }, (_item, index) =>
      normalizeTimestamp(0.5 + index * 0.75)
    );
  }

  const startPercent = batchKind === "fresh" ? 0.05 : 0.1;
  const endPercent = batchKind === "fresh" ? 0.95 : 0.9;
  const start = Math.max(duration * startPercent, 0.1);
  const end = Math.max(start, duration * endPercent);
  const span = Math.max(end - start, 0);
  const freshOffset =
    batchKind === "fresh" ? getFreshOffset({ count, seed }) : 0;

  return Array.from({ length: count }, (_item, index) => {
    const basePosition =
      batchKind === "fresh"
        ? clamp((index + 0.5) / count + freshOffset, 0.01, 0.99)
        : (index + 1) / (count + 1);
    return normalizeTimestamp(start + span * basePosition);
  });
}

function normalizePreviewMode(value) {
  if (value === undefined || value === null || value === "") {
    return "additional";
  }

  if (value === "additional" || value === "fresh") {
    return value;
  }

  throw createRequestError("mode must be either additional or fresh.");
}

function createFailedPreviewFrame({ batchId, index, timestampSeconds }) {
  return {
    index,
    timestampSeconds,
    timestampLabel: formatTimestampLabel(timestampSeconds),
    batchId,
    thumbnail: {
      generated: false,
      cached: false,
      error: "Unable to generate preview frame.",
    },
  };
}

async function fileExists(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function generatePreviewFrames({ video, mode: requestedMode }) {
  const mode = normalizePreviewMode(requestedMode);
  const source = await readPreviewVideoInput(video);
  const maxPreviewFrameCount = getMaxPreviewFrameCount(source.durationSeconds);
  const batchKind = mode === "fresh" ? "fresh" : "default";
  const batchSeed = mode === "fresh" ? Date.now() : 0;
  const batchId =
    mode === "fresh" ? `fresh-${batchSeed.toString(36)}` : "default";
  const timestamps = buildPreviewTimestamps({
    batchKind,
    count: maxPreviewFrameCount,
    durationSeconds: source.durationSeconds,
    seed: batchSeed,
  });
  const videoHash = buildVideoCacheHash({
    filePath: source.filePath,
    modifiedAtMs: source.modifiedAtMs,
    sizeBytes: source.sizeBytes,
  });
  const frames = [];
  const summary = {
    requested: maxPreviewFrameCount,
    existing: 0,
    generated: 0,
    cached: 0,
    failed: 0,
    returned: 0,
  };

  await fs.mkdir(THUMBNAIL_DIR, { recursive: true });

  for (let index = 0; index < timestamps.length; index += 1) {
    const timestampSeconds = timestamps[index];
    const thumbnailFileName = buildPreviewFrameFileName({
      batchId,
      filePath: source.filePath,
      index,
      modifiedAtMs: source.modifiedAtMs,
      sizeBytes: source.sizeBytes,
      timestampSeconds,
      videoHash,
    });
    const thumbnailPath = path.join(THUMBNAIL_DIR, thumbnailFileName);
    const existing = await fileExists(thumbnailPath);

    if (existing) {
      summary.existing += 1;
      summary.cached += 1;
      frames.push({
        index,
        timestampSeconds,
        timestampLabel: formatTimestampLabel(timestampSeconds),
        batchId,
        thumbnail: createPreviewFrameThumbnailMetadata({
          cached: true,
          generated: true,
          thumbnailFileName,
          thumbnailPath,
        }),
      });
      continue;
    }

    const result = await runFfmpegThumbnail({
      inputPath: source.filePath,
      outputPath: thumbnailPath,
      scaleFilter: "scale=640:-1",
      timestampSeconds,
    });

    if (!result.ok) {
      try {
        await fs.rm(thumbnailPath, { force: true });
      } catch {
        // Best-effort cleanup only; source files are never touched.
      }

      summary.failed += 1;
      frames.push(
        createFailedPreviewFrame({ batchId, index, timestampSeconds })
      );
      continue;
    }

    summary.generated += 1;
    frames.push({
      index,
      timestampSeconds,
      timestampLabel: formatTimestampLabel(timestampSeconds),
      batchId,
      thumbnail: createPreviewFrameThumbnailMetadata({
        cached: false,
        generated: true,
        thumbnailFileName,
        thumbnailPath,
      }),
    });
  }

  summary.returned = frames.length;

  return {
    video: {
      id: source.id,
      fileName: source.fileName,
      path: source.filePath,
    },
    durationSeconds: source.durationSeconds,
    maxPreviewFrameCount,
    mode,
    batchId,
    thumbnailDir: THUMBNAIL_DIR,
    summary,
    frames,
  };
}

function emitProgress(onProgress, update) {
  if (typeof onProgress !== "function") return;
  onProgress(update);
}

function dedupeVideos(videos) {
  const byPath = new Map();

  for (let index = 0; index < videos.length; index += 1) {
    const video = videos[index];
    const filePath = getVideoPath(video);
    const dedupeKey = filePath
      ? path.resolve(filePath)
      : `missing-path:${index}`;

    if (byPath.has(dedupeKey)) {
      continue;
    }

    byPath.set(dedupeKey, video);
  }

  return Array.from(byPath.values());
}

async function ensureThumbnailForVideo(video) {
  const filePath = getVideoPath(video);
  const fileName = getOriginalFileName(video, filePath);

  if (!filePath || !path.isAbsolute(filePath)) {
    return createFailedItem({
      video,
      filePath,
      fileName,
      error: "Video path must be an absolute path.",
    });
  }

  const extension = path.extname(filePath).toLowerCase();

  if (!isSupportedVideoExtension(extension)) {
    return createFailedItem({
      video,
      filePath,
      fileName,
      error: "Unsupported video file extension.",
    });
  }

  let stat;

  try {
    stat = await fs.stat(filePath);
  } catch {
    return createFailedItem({
      video,
      filePath,
      fileName,
      error: "Video file does not exist or is unreadable.",
    });
  }

  if (!stat.isFile()) {
    return createFailedItem({
      video,
      filePath,
      fileName,
      error: "Video path must point to a file.",
    });
  }

  await fs.mkdir(THUMBNAIL_DIR, { recursive: true });

  const durationSeconds = readFiniteNumber(video?.durationSeconds);
  const timestampSeconds = pickThumbnailTimestamp(durationSeconds);
  const sizeBytes =
    readFiniteNumber(video?.sizeBytes) ??
    readFiniteNumber(video?.fileSystemSizeBytes) ??
    stat.size;
  const modifiedAtMs =
    readFiniteNumber(video?.modifiedAtMs) ??
    readFiniteNumber(video?.mtimeMs) ??
    getModifiedAtMs(video, stat);
  const thumbnailFileName = buildThumbnailFileName({
    filePath,
    modifiedAtMs,
    sizeBytes,
  });
  const thumbnailPath = path.join(THUMBNAIL_DIR, thumbnailFileName);

  try {
    const thumbnailStat = await fs.stat(thumbnailPath);

    if (thumbnailStat.isFile()) {
      return {
        id: video?.id,
        fileName,
        path: filePath,
        thumbnail: createThumbnailMetadata({
          cached: true,
          generated: true,
          thumbnailFileName,
          thumbnailPath,
          timestampSeconds,
        }),
      };
    }
  } catch {
    // Missing cache entries are generated below.
  }

  const result = await runFfmpegThumbnail({
    inputPath: filePath,
    outputPath: thumbnailPath,
    timestampSeconds,
  });

  if (!result.ok) {
    try {
      await fs.rm(thumbnailPath, { force: true });
    } catch {
      // Best-effort cleanup only; source files are never touched.
    }

    return createFailedItem({
      video,
      filePath,
      fileName,
      error: "Unable to generate thumbnail.",
    });
  }

  return {
    id: video?.id,
    fileName,
    path: filePath,
    thumbnail: createThumbnailMetadata({
      cached: false,
      generated: true,
      thumbnailFileName,
      thumbnailPath,
      timestampSeconds,
    }),
  };
}

async function generateThumbnails({ videos, onProgress }) {
  const uniqueVideos = dedupeVideos(videos);
  const summary = {
    requested: uniqueVideos.length,
    generated: 0,
    cached: 0,
    failed: 0,
  };
  const items = [];

  emitProgress(onProgress, {
    phase: "generating_thumbnails",
    totalVideos: uniqueVideos.length,
    processedVideos: 0,
    generatedCount: 0,
    cachedCount: 0,
    failedCount: 0,
    currentFile: "",
    message: "Generating thumbnails...",
  });

  for (let index = 0; index < uniqueVideos.length; index += 1) {
    const video = uniqueVideos[index];
    const filePath = getVideoPath(video);
    const fileName = getOriginalFileName(video, filePath);

    emitProgress(onProgress, {
      phase: "generating_thumbnails",
      totalVideos: uniqueVideos.length,
      processedVideos: index,
      generatedCount: summary.generated,
      cachedCount: summary.cached,
      failedCount: summary.failed,
      currentFile: fileName,
      message: "Generating thumbnails...",
    });

    const item = await ensureThumbnailForVideo(video);
    items.push(item);

    if (item.thumbnail?.generated && item.thumbnail?.cached) {
      summary.cached += 1;
    } else if (item.thumbnail?.generated) {
      summary.generated += 1;
    } else {
      summary.failed += 1;
    }

    emitProgress(onProgress, {
      phase: "generating_thumbnails",
      totalVideos: uniqueVideos.length,
      processedVideos: index + 1,
      generatedCount: summary.generated,
      cachedCount: summary.cached,
      failedCount: summary.failed,
      currentFile: fileName,
      message: item.thumbnail?.generated
        ? "Thumbnail ready."
        : "Thumbnail generation failed.",
    });
  }

  emitProgress(onProgress, {
    phase: "complete",
    totalVideos: uniqueVideos.length,
    processedVideos: uniqueVideos.length,
    generatedCount: summary.generated,
    cachedCount: summary.cached,
    failedCount: summary.failed,
    currentFile: "",
    message: "Thumbnail generation complete.",
  });

  return {
    createdAt: nowIsoString(),
    completedAt: nowIsoString(),
    thumbnailDir: THUMBNAIL_DIR,
    summary,
    items,
  };
}

module.exports = {
  THUMBNAIL_DIR,
  dedupeThumbnailVideos: dedupeVideos,
  generateThumbnails,
  generatePreviewFrames,
  ensureThumbnailForVideo,
  formatTimestampLabel,
  getMaxPreviewFrameCount,
  pickThumbnailTimestamp,
};
