const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const {
  isSupportedVideoExtension,
  normalizeVideoExtension,
} = require("./videoExtensions");

const DEFAULT_DESTINATION_ROOT = path.join(os.homedir(), "Movies", "Edited");
const OUTPUT_SUBDIRECTORY = "ffmpeg";
const MIN_VISIBLE_WIDTH = 640;
const MIN_VISIBLE_HEIGHT = 360;
const ASPECT_RATIO_16_9 = 16 / 9;
const AUTO_CROP_ASPECT_TOLERANCE = 0.03;

const NORMALIZE_FILTER =
  "scale=1920:1080:force_original_aspect_ratio=decrease:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,setdar=16/9";

const HIGH_QUALITY_PROFILE = Object.freeze({
  id: "high-quality",
  label: "High quality normalize",
  preset: "medium",
  crf: "18",
});

const STANDARD_PROFILE = Object.freeze({
  id: "standard",
  label: "Standard normalize",
  preset: "fast",
  crf: "20",
});

function nowIsoString() {
  return new Date().toISOString();
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

function getVideoPath(video) {
  const candidates = [video?.absolutePath, video?.path, video?.sourcePath];

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

function getOutputFileName(fileName, sourcePath) {
  const parsed = path.parse(fileName || path.basename(sourcePath));
  const baseName = parsed.name || path.basename(sourcePath, path.extname(sourcePath));
  const extension = normalizeVideoExtension(parsed.ext || sourcePath);

  if (extension === ".mp4") {
    return `${baseName}.mp4`;
  }

  return `${baseName}.mp4`;
}

function getBitRate(video) {
  const directBitRate =
    readFiniteNumber(video?.bitRate) ??
    readFiniteNumber(video?.bit_rate) ??
    readFiniteNumber(video?.formatBitRate) ??
    readFiniteNumber(video?.streamBitRate);

  if (directBitRate !== null) {
    return directBitRate;
  }

  const bitRateMbps = readFiniteNumber(video?.bitRateMbps);
  return bitRateMbps === null ? null : bitRateMbps * 1_000_000;
}

function chooseNormalizeProfile(video) {
  const width = readFiniteNumber(video?.width);
  const height = readFiniteNumber(video?.height);
  const bitRate = getBitRate(video);

  if (height !== null && height < 720) return STANDARD_PROFILE;
  if (width !== null && width < 1280) return STANDARD_PROFILE;

  if (bitRate !== null) {
    if (height !== null && height >= 1000 && bitRate < 3_000_000) {
      return STANDARD_PROFILE;
    }

    if (height !== null && height >= 700 && height < 1000 && bitRate < 1_500_000) {
      return STANDARD_PROFILE;
    }
  }

  return HIGH_QUALITY_PROFILE;
}

function getBlackBorderAdjustment(video) {
  return video?.adjustments?.blackBorder || null;
}

function isFinitePositiveNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isFiniteNonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function getSourceDimensions(video) {
  const blackBorder = getBlackBorderAdjustment(video);
  const source = blackBorder?.source || {};
  const width = readFiniteNumber(source.width) ?? readFiniteNumber(video?.width);
  const height = readFiniteNumber(source.height) ?? readFiniteNumber(video?.height);

  return { width, height };
}

function normalizeCrop(visibleArea) {
  if (
    !visibleArea ||
    !isFinitePositiveNumber(visibleArea.width) ||
    !isFinitePositiveNumber(visibleArea.height) ||
    !isFiniteNonNegativeNumber(visibleArea.x) ||
    !isFiniteNonNegativeNumber(visibleArea.y)
  ) {
    return null;
  }

  return {
    width: Math.round(visibleArea.width),
    height: Math.round(visibleArea.height),
    x: Math.round(visibleArea.x),
    y: Math.round(visibleArea.y),
  };
}

function cropFitsSource({ crop, sourceWidth, sourceHeight }) {
  if (sourceWidth === null || sourceHeight === null) {
    return true;
  }

  return (
    crop.x + crop.width <= sourceWidth &&
    crop.y + crop.height <= sourceHeight
  );
}

function getSafeCrop(video) {
  const blackBorder = getBlackBorderAdjustment(video);
  const visibleArea = blackBorder?.visibleArea;
  const recommendedFix = blackBorder?.recommendedFix;

  if (
    blackBorder?.classification !== "nested_borders" ||
    blackBorder?.confidence !== "high" ||
    recommendedFix?.eligible !== true ||
    recommendedFix?.type !== "crop-scale"
  ) {
    return null;
  }

  const crop = normalizeCrop(visibleArea);

  if (!crop) return null;
  if (crop.width < MIN_VISIBLE_WIDTH || crop.height < MIN_VISIBLE_HEIGHT) return null;

  const visibleAspectRatio = crop.width / crop.height;
  if (Math.abs(visibleAspectRatio - ASPECT_RATIO_16_9) > AUTO_CROP_ASPECT_TOLERANCE) {
    return null;
  }

  const { width: sourceWidth, height: sourceHeight } = getSourceDimensions(video);

  if (!cropFitsSource({ crop, sourceWidth, sourceHeight })) {
    return null;
  }

  return crop;
}

function buildFfmpegFilter(crop) {
  if (!crop) return NORMALIZE_FILTER;

  return `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},${NORMALIZE_FILTER}`;
}

function getConciseFfmpegError(stderr, code) {
  const lines = String(stderr || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const usefulLine = [...lines]
    .reverse()
    .find((line) => !line.startsWith("frame=") && !line.startsWith("size="));

  return usefulLine || `FFmpeg exited with code ${code}.`;
}

function runFfmpegAutoFix({ inputPath, outputPath, filter, profile, signal }) {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({
        ok: false,
        canceled: true,
        error: "Auto-Fix canceled.",
      });
      return;
    }

    const args = [
      "-y",
      "-i",
      inputPath,
      "-vf",
      filter,
      "-c:v",
      "libx264",
      "-preset",
      profile.preset,
      "-crf",
      profile.crf,
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      outputPath,
    ];

    const child = spawn("ffmpeg", args);
    let stderr = "";
    let didCancel = false;
    let didSettle = false;
    let forceKillTimeout = null;

    const settle = (result) => {
      if (didSettle) return;

      didSettle = true;
      if (forceKillTimeout) {
        clearTimeout(forceKillTimeout);
      }
      signal?.removeEventListener("abort", handleAbort);
      resolve(result);
    };

    const handleAbort = () => {
      didCancel = true;
      child.kill("SIGTERM");
      forceKillTimeout = setTimeout(() => {
        if (!didSettle) {
          child.kill("SIGKILL");
        }
      }, 5000);
    };

    signal?.addEventListener("abort", handleAbort, { once: true });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (error) => {
      settle({
        ok: false,
        error: error.message,
      });
    });

    child.on("close", (code) => {
      if (didCancel || signal?.aborted) {
        settle({
          ok: false,
          canceled: true,
          error: "Auto-Fix canceled.",
        });
        return;
      }

      if (code !== 0) {
        settle({
          ok: false,
          error: getConciseFfmpegError(stderr, code),
        });
        return;
      }

      settle({ ok: true });
    });
  });
}

function emitProgress(onProgress, update) {
  if (typeof onProgress !== "function") return;
  onProgress(update);
}

function createAutoFixCancelError() {
  const error = new Error("Auto-Fix canceled.");
  error.name = "AbortError";
  return error;
}

function assertNotCanceled(signal) {
  if (signal?.aborted) {
    throw createAutoFixCancelError();
  }
}

function createFailedItem({ video, sourcePath, fileName, outputPath, error, startedAt }) {
  return {
    id: typeof video?.id === "string" ? video.id : null,
    sourcePath: sourcePath || null,
    outputPath: outputPath || null,
    fileName: fileName || "",
    outputFileName: outputPath ? path.basename(outputPath) : null,
    status: "failed",
    profileId: null,
    profileLabel: null,
    cropped: false,
    action: null,
    filter: null,
    startedAt,
    completedAt: nowIsoString(),
    error,
  };
}

async function validateAutoFixRequest(body) {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Request body is required." };
  }

  if (!Array.isArray(body.videos) || body.videos.length === 0) {
    return { ok: false, error: "videos must be a non-empty array." };
  }

  const destinationRoot = body.destinationRoot || DEFAULT_DESTINATION_ROOT;

  if (typeof destinationRoot !== "string" || !path.isAbsolute(destinationRoot)) {
    return {
      ok: false,
      error: "destinationRoot must be an absolute path when provided.",
    };
  }

  const outputDirectory = path.join(destinationRoot, OUTPUT_SUBDIRECTORY);

  try {
    await fs.mkdir(outputDirectory, { recursive: true });
  } catch (error) {
    return {
      ok: false,
      error: `Unable to create output directory: ${error.message}`,
    };
  }

  return {
    ok: true,
    videos: body.videos,
    destinationRoot,
    outputDirectory,
  };
}

async function validateAutoFixVideo(video) {
  const sourcePath = getVideoPath(video);

  if (!sourcePath || !path.isAbsolute(sourcePath)) {
    return {
      ok: false,
      sourcePath,
      fileName: getOriginalFileName(video, sourcePath),
      error: "Video must include an absolute source path.",
    };
  }

  let stat;

  try {
    stat = await fs.stat(sourcePath);
  } catch {
    return {
      ok: false,
      sourcePath,
      fileName: getOriginalFileName(video, sourcePath),
      error: "Source video does not exist or is unreadable.",
    };
  }

  if (!stat.isFile()) {
    return {
      ok: false,
      sourcePath,
      fileName: getOriginalFileName(video, sourcePath),
      error: "Source path must point to a file.",
    };
  }

  const extension = normalizeVideoExtension(sourcePath);

  if (!isSupportedVideoExtension(extension)) {
    return {
      ok: false,
      sourcePath,
      fileName: getOriginalFileName(video, sourcePath),
      error: "Unsupported video file extension.",
    };
  }

  return {
    ok: true,
    sourcePath,
    fileName: getOriginalFileName(video, sourcePath),
    sourceSizeBytes: stat.size,
  };
}

async function runAutoFix({ videos, outputDirectory, onProgress, signal }) {
  assertNotCanceled(signal);

  await fs.mkdir(outputDirectory, { recursive: true });

  const items = [];
  const summary = {
    requested: videos.length,
    succeeded: 0,
    failed: 0,
    standardProfileCount: 0,
    highQualityProfileCount: 0,
    croppedCount: 0,
    normalizedOnlyCount: 0,
  };

  emitProgress(onProgress, {
    phase: "normalizing",
    totalVideos: videos.length,
    processedVideos: 0,
    succeeded: 0,
    failed: 0,
    currentFile: "",
    currentProfile: null,
    currentAction: null,
    message: "Auto-Fix started.",
    outputDirectory,
  });

  for (let index = 0; index < videos.length; index++) {
    assertNotCanceled(signal);

    const video = videos[index];
    const startedAt = nowIsoString();
    const validation = await validateAutoFixVideo(video);
    const sourcePath = validation.sourcePath;
    const fileName = validation.fileName;

    if (!validation.ok) {
      summary.failed += 1;
      items.push(
        createFailedItem({
          video,
          sourcePath,
          fileName,
          outputPath: null,
          error: validation.error,
          startedAt,
        })
      );

      emitProgress(onProgress, {
        phase: "normalizing",
        totalVideos: videos.length,
        processedVideos: index + 1,
        succeeded: summary.succeeded,
        failed: summary.failed,
        currentFile: fileName,
        currentProfile: null,
        currentAction: null,
        message: validation.error,
        outputDirectory,
      });
      continue;
    }

    const outputFileName = getOutputFileName(fileName, sourcePath);
    const outputPath = path.join(outputDirectory, outputFileName);
    const profile = chooseNormalizeProfile(video);
    const crop = getSafeCrop(video);
    const filter = buildFfmpegFilter(crop);
    const action = crop ? "crop-normalize" : "normalize";

    if (path.resolve(sourcePath) === path.resolve(outputPath)) {
      summary.failed += 1;
      items.push(
        createFailedItem({
          video,
          sourcePath,
          fileName,
          outputPath,
          error: "Output path matches the source path; source videos are never overwritten.",
          startedAt,
        })
      );

      emitProgress(onProgress, {
        phase: "normalizing",
        totalVideos: videos.length,
        processedVideos: index + 1,
        succeeded: summary.succeeded,
        failed: summary.failed,
        currentFile: fileName,
        currentProfile: null,
        currentAction: null,
        message: "Skipped source-overwrite risk.",
        outputDirectory,
      });
      continue;
    }

    if (profile.id === STANDARD_PROFILE.id) {
      summary.standardProfileCount += 1;
    } else {
      summary.highQualityProfileCount += 1;
    }

    if (crop) {
      summary.croppedCount += 1;
    } else {
      summary.normalizedOnlyCount += 1;
    }

    emitProgress(onProgress, {
      phase: "normalizing",
      totalVideos: videos.length,
      processedVideos: index,
      succeeded: summary.succeeded,
      failed: summary.failed,
      currentFile: fileName,
      currentProfile: profile.id,
      currentAction: action,
      message: `Auto-fixing ${fileName}...`,
      outputDirectory,
    });

    const item = {
      id: typeof video?.id === "string" ? video.id : null,
      sourcePath,
      outputPath,
      fileName,
      outputFileName,
      status: "running",
      profileId: profile.id,
      profileLabel: profile.label,
      cropped: Boolean(crop),
      crop,
      action,
      filter,
      sourceSizeBytes: validation.sourceSizeBytes,
      outputSizeBytes: null,
      outputExtensionConverted: path.extname(fileName).toLowerCase() !== ".mp4",
      startedAt,
      completedAt: null,
      error: null,
    };

    items.push(item);

    const result = await runFfmpegAutoFix({
      inputPath: sourcePath,
      outputPath,
      filter,
      profile,
      signal,
    });

    if (result.canceled) {
      throw createAutoFixCancelError();
    }

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
      summary.succeeded += 1;
    } else {
      item.status = "failed";
      item.error = result.error;
      summary.failed += 1;
    }

    emitProgress(onProgress, {
      phase: "normalizing",
      totalVideos: videos.length,
      processedVideos: index + 1,
      succeeded: summary.succeeded,
      failed: summary.failed,
      currentFile: fileName,
      currentProfile: profile.id,
      currentAction: action,
      message: result.ok ? "Auto-Fix output written." : "Auto-Fix failed.",
      outputDirectory,
    });
  }

  emitProgress(onProgress, {
    phase: "complete",
    totalVideos: videos.length,
    processedVideos: videos.length,
    succeeded: summary.succeeded,
    failed: summary.failed,
    currentFile: "",
    currentProfile: null,
    currentAction: null,
    message: "Auto-Fix complete.",
    outputDirectory,
  });

  return {
    status: "complete",
    outputDirectory,
    summary,
    items,
  };
}

module.exports = {
  DEFAULT_DESTINATION_ROOT,
  HIGH_QUALITY_PROFILE,
  STANDARD_PROFILE,
  buildFfmpegFilter,
  chooseNormalizeProfile,
  runAutoFix,
  validateAutoFixRequest,
};
