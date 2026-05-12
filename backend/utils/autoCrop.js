const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const DEFAULT_OUTPUT_ROOT_DIR = path.join(
  os.homedir(),
  "Movies",
  "Edited",
  "AutoCropped"
);
const TARGET_WIDTH = 1920;
const TARGET_HEIGHT = 1080;
const TARGET_ASPECT_RATIO = TARGET_WIDTH / TARGET_HEIGHT;
const AUTO_CROP_ASPECT_TOLERANCE = 0.03;
const MIN_VISIBLE_WIDTH = 640;
const MIN_VISIBLE_HEIGHT = 360;

function nowIsoString() {
  return new Date().toISOString();
}

function timestampForRunId(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");

  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("-");
}

function isFinitePositiveNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isFiniteNonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function getBlackBorderAdjustment(video) {
  return video?.adjustments?.blackBorder || null;
}

function getVisibleArea(video) {
  return getBlackBorderAdjustment(video)?.visibleArea || null;
}

function getRecommendedFix(video) {
  return getBlackBorderAdjustment(video)?.recommendedFix || null;
}

function getSourceDimensions(video) {
  const blackBorder = getBlackBorderAdjustment(video);
  const source = blackBorder?.source || {};
  const width =
    typeof source.width === "number" ? source.width : video?.width ?? null;
  const height =
    typeof source.height === "number" ? source.height : video?.height ?? null;

  return { width, height };
}

function validateCropInsideSource({ crop, sourceWidth, sourceHeight }) {
  if (
    typeof sourceWidth !== "number" ||
    typeof sourceHeight !== "number" ||
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight)
  ) {
    return true;
  }

  return (
    crop.x + crop.width <= sourceWidth &&
    crop.y + crop.height <= sourceHeight
  );
}

function isAutoCropEligible(video) {
  const blackBorder = getBlackBorderAdjustment(video);
  const visibleArea = getVisibleArea(video);
  const recommendedFix = getRecommendedFix(video);

  if (
    blackBorder?.classification !== "nested_borders" ||
    blackBorder?.confidence !== "high" ||
    recommendedFix?.eligible !== true
  ) {
    return false;
  }

  if (
    !visibleArea ||
    !isFinitePositiveNumber(visibleArea.width) ||
    !isFinitePositiveNumber(visibleArea.height) ||
    !isFiniteNonNegativeNumber(visibleArea.x) ||
    !isFiniteNonNegativeNumber(visibleArea.y)
  ) {
    return false;
  }

  const aspectRatio = visibleArea.width / visibleArea.height;

  return (
    Math.abs(aspectRatio - TARGET_ASPECT_RATIO) <= AUTO_CROP_ASPECT_TOLERANCE &&
    visibleArea.width >= MIN_VISIBLE_WIDTH &&
    visibleArea.height >= MIN_VISIBLE_HEIGHT
  );
}

async function validateAutoCropRequest(body) {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Request body is required." };
  }

  if (!Array.isArray(body.videos) || body.videos.length === 0) {
    return { ok: false, error: "videos must be a non-empty array." };
  }

  const outputRootDir = body.outputRootDir || DEFAULT_OUTPUT_ROOT_DIR;

  if (typeof outputRootDir !== "string" || !path.isAbsolute(outputRootDir)) {
    return {
      ok: false,
      error: "outputRootDir must be an absolute path when provided.",
    };
  }

  const videos = [];

  for (let index = 0; index < body.videos.length; index++) {
    const video = body.videos[index];
    const sourcePath = video?.path;

    if (typeof sourcePath !== "string" || !path.isAbsolute(sourcePath)) {
      return {
        ok: false,
        error: `videos[${index}].path must be an absolute source path.`,
      };
    }

    let stat;

    try {
      stat = await fs.stat(sourcePath);
    } catch {
      return {
        ok: false,
        error: `videos[${index}].path does not exist or is unreadable.`,
      };
    }

    if (!stat.isFile()) {
      return {
        ok: false,
        error: `videos[${index}].path must point to a file.`,
      };
    }

    const visibleArea = getVisibleArea(video);

    if (
      !visibleArea ||
      !isFinitePositiveNumber(visibleArea.width) ||
      !isFinitePositiveNumber(visibleArea.height) ||
      !isFiniteNonNegativeNumber(visibleArea.x) ||
      !isFiniteNonNegativeNumber(visibleArea.y)
    ) {
      return {
        ok: false,
        error: `videos[${index}] must include finite positive crop dimensions and non-negative crop offsets.`,
      };
    }

    const { width: sourceWidth, height: sourceHeight } =
      getSourceDimensions(video);

    if (
      !validateCropInsideSource({
        crop: visibleArea,
        sourceWidth,
        sourceHeight,
      })
    ) {
      return {
        ok: false,
        error: `videos[${index}] crop rectangle is outside the source dimensions.`,
      };
    }

    videos.push({
      ...video,
      path: sourcePath,
      fileName:
        typeof video.fileName === "string" && video.fileName
          ? video.fileName
          : path.basename(sourcePath),
      sourceSizeBytes: stat.size,
    });
  }

  try {
    await fs.mkdir(outputRootDir, { recursive: true });
  } catch (error) {
    return {
      ok: false,
      error: `Unable to create outputRootDir: ${error.message}`,
    };
  }

  return {
    ok: true,
    videos,
    outputRootDir,
  };
}

async function createUniqueRunFolder(outputRootDir) {
  const baseRunId = `video-audit-crop-${timestampForRunId()}`;

  for (let index = 0; index < 100; index++) {
    const runId = index === 0 ? baseRunId : `${baseRunId}-${index + 1}`;
    const outputDir = path.join(outputRootDir, runId);

    try {
      await fs.mkdir(outputDir, { recursive: false });
      return { runId, outputDir };
    } catch (error) {
      if (error.code === "EEXIST") {
        continue;
      }

      throw error;
    }
  }

  throw new Error("Unable to create a unique auto-crop run folder.");
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function getUniqueOutputPath({ outputDir, fileName }) {
  const extension = ".mp4";
  const parsed = path.parse(fileName);
  const baseName = parsed.name || "video";

  for (let index = 0; index < 1000; index++) {
    const suffix = index === 0 ? "" : `-${index + 1}`;
    const candidate = path.join(outputDir, `${baseName}${suffix}${extension}`);

    if (!(await pathExists(candidate))) {
      return candidate;
    }
  }

  throw new Error(`Unable to allocate output filename for ${fileName}.`);
}

function buildFfmpegFilter({ crop, target }) {
  return `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},scale=${target.width}:${target.height}:flags=lanczos`;
}

function runFfmpegCrop({ inputPath, outputPath, filter }) {
  return new Promise((resolve) => {
    const args = [
      "-y",
      "-i",
      inputPath,
      "-vf",
      filter,
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "18",
      "-c:a",
      "copy",
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

async function writeManifest(manifestPath, manifest) {
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
}

function emitProgress(onProgress, update) {
  if (typeof onProgress !== "function") return;
  onProgress(update);
}

function createSkippedItem({ video, reason, startedAt }) {
  return {
    fileName: video.fileName,
    sourcePath: video.path,
    outputPath: null,
    status: "skipped",
    crop: null,
    target: null,
    ffmpegFilter: null,
    sourceSizeBytes: video.sourceSizeBytes,
    outputSizeBytes: null,
    startedAt,
    completedAt: nowIsoString(),
    error: reason,
  };
}

async function runAutoCrop({ videos, outputRootDir, onProgress }) {
  const { runId, outputDir } = await createUniqueRunFolder(outputRootDir);
  const manifestInProgressPath = path.join(
    outputDir,
    "manifest.in-progress.json"
  );
  const manifestPath = path.join(outputDir, "manifest.json");
  const manifest = {
    schemaVersion: 1,
    runId,
    createdAt: nowIsoString(),
    completedAt: null,
    mode: "ffmpeg-auto-crop",
    outputDir,
    summary: {
      requested: videos.length,
      eligible: 0,
      skipped: 0,
      succeeded: 0,
      failed: 0,
      sourceBytes: videos.reduce(
        (total, video) => total + (video.sourceSizeBytes || 0),
        0
      ),
      outputBytes: 0,
    },
    items: [],
  };

  await writeManifest(manifestInProgressPath, manifest);

  emitProgress(onProgress, {
    phase: "cropping",
    totalFiles: videos.length,
    processedFiles: 0,
    succeededCount: 0,
    skippedCount: 0,
    errorCount: 0,
    currentFile: "",
    message: "Cropping selected videos...",
    outputDir,
  });

  for (let index = 0; index < videos.length; index++) {
    const video = videos[index];
    const startedAt = nowIsoString();

    emitProgress(onProgress, {
      phase: "cropping",
      totalFiles: videos.length,
      processedFiles: index,
      succeededCount: manifest.summary.succeeded,
      skippedCount: manifest.summary.skipped,
      errorCount: manifest.summary.failed,
      currentFile: video.fileName,
      message: "Cropping selected videos...",
      outputDir,
    });

    if (!isAutoCropEligible(video)) {
      manifest.summary.skipped += 1;
      manifest.items.push(
        createSkippedItem({
          video,
          startedAt,
          reason:
            "Video is not an eligible high-confidence 16:9 nested-border candidate.",
        })
      );
      await writeManifest(manifestInProgressPath, manifest);

      emitProgress(onProgress, {
        phase: "cropping",
        totalFiles: videos.length,
        processedFiles: index + 1,
        succeededCount: manifest.summary.succeeded,
        skippedCount: manifest.summary.skipped,
        errorCount: manifest.summary.failed,
        currentFile: video.fileName,
        message: "Skipped ineligible video.",
        outputDir,
      });
      continue;
    }

    manifest.summary.eligible += 1;

    const cropSource = getVisibleArea(video);
    const crop = {
      width: Math.round(cropSource.width),
      height: Math.round(cropSource.height),
      x: Math.round(cropSource.x),
      y: Math.round(cropSource.y),
    };
    const target = { width: TARGET_WIDTH, height: TARGET_HEIGHT };
    const outputPath = await getUniqueOutputPath({
      outputDir,
      fileName: video.fileName,
    });
    const ffmpegFilter = buildFfmpegFilter({ crop, target });
    const item = {
      fileName: video.fileName,
      sourcePath: video.path,
      outputPath,
      status: "running",
      crop,
      target,
      ffmpegFilter,
      sourceSizeBytes: video.sourceSizeBytes,
      outputSizeBytes: null,
      startedAt,
      completedAt: null,
      error: null,
    };

    manifest.items.push(item);
    await writeManifest(manifestInProgressPath, manifest);

    const result = await runFfmpegCrop({
      inputPath: video.path,
      outputPath,
      filter: ffmpegFilter,
    });

    item.completedAt = nowIsoString();

    if (result.ok) {
      let outputStat = null;

      try {
        outputStat = await fs.stat(outputPath);
      } catch {
        outputStat = null;
      }

      item.status = "success";
      item.outputSizeBytes = outputStat?.size ?? null;
      manifest.summary.succeeded += 1;
      manifest.summary.outputBytes += item.outputSizeBytes || 0;
    } else {
      item.status = "failed";
      item.error = result.error;
      manifest.summary.failed += 1;
    }

    await writeManifest(manifestInProgressPath, manifest);

    emitProgress(onProgress, {
      phase: "cropping",
      totalFiles: videos.length,
      processedFiles: index + 1,
      succeededCount: manifest.summary.succeeded,
      skippedCount: manifest.summary.skipped,
      errorCount: manifest.summary.failed,
      currentFile: video.fileName,
      message: result.ok ? "Cropped video." : "Auto-crop failed.",
      outputDir,
    });
  }

  manifest.completedAt = nowIsoString();
  await writeManifest(manifestInProgressPath, manifest);
  await fs.rename(manifestInProgressPath, manifestPath);

  emitProgress(onProgress, {
    phase: "complete",
    totalFiles: videos.length,
    processedFiles: videos.length,
    succeededCount: manifest.summary.succeeded,
    skippedCount: manifest.summary.skipped,
    errorCount: manifest.summary.failed,
    currentFile: "",
    message: "Auto-crop complete.",
    outputDir,
  });

  return {
    ...manifest,
    manifestPath,
  };
}

module.exports = {
  DEFAULT_OUTPUT_ROOT_DIR,
  runAutoCrop,
  validateAutoCropRequest,
};
