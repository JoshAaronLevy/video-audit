#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const cliProgress = require("cli-progress");
const {
  analyzeBlackBorders,
  isHighConfidenceNestedBorderCandidate,
} = require("./blackBorderAnalysis");

const VIDEO_EXTENSIONS = new Set([".mp4", ".m4v", ".mov"]);
const DEFAULT_TARGET_ASPECT_RATIO = 16 / 9;
const DEFAULT_ASPECT_RATIO_TOLERANCE = 0.01;
const DEFAULT_MIN_HEIGHT = 720;
const SYSTEM_DIRECTORY_NAMES = new Set([
  ".Spotlight-V100",
  ".Trashes",
  ".fseventsd",
  ".TemporaryItems",
  "System Volume Information",
  "node_modules",
]);

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function emitProgress(onProgress, update) {
  if (typeof onProgress !== "function") return;

  onProgress(update);
}

async function findVideoFiles(dir, onProgress) {
  const results = [];
  let skippedFiles = 0;

  emitProgress(onProgress, {
    phase: "walking",
    totalFiles: 0,
    processedFiles: 0,
    skippedFiles,
    flaggedCount: 0,
    errorCount: 0,
    currentFile: "",
    message: "Finding video files...",
  });

  async function walk(currentDir) {
    let entries;

    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      skippedFiles += 1;
      emitProgress(onProgress, {
        phase: "walking",
        totalFiles: results.length,
        processedFiles: 0,
        skippedFiles,
        flaggedCount: 0,
        errorCount: 0,
        currentFile: path.basename(currentDir),
        message: "Skipping unreadable directory...",
      });
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (SYSTEM_DIRECTORY_NAMES.has(entry.name)) {
          skippedFiles += 1;
          continue;
        }

        await walk(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;

      const fileName = entry.name;

      if (fileName.startsWith("._") || fileName === ".DS_Store") {
        skippedFiles += 1;
        continue;
      }

      const ext = path.extname(fileName).toLowerCase();

      if (VIDEO_EXTENSIONS.has(ext)) {
        results.push(fullPath);
        emitProgress(onProgress, {
          phase: "walking",
          totalFiles: results.length,
          processedFiles: 0,
          skippedFiles,
          flaggedCount: 0,
          errorCount: 0,
          currentFile: fileName,
          message: "Finding video files...",
        });
      }
    }
  }

  await walk(dir);

  emitProgress(onProgress, {
    phase: "walking",
    totalFiles: results.length,
    processedFiles: 0,
    skippedFiles,
    flaggedCount: 0,
    errorCount: 0,
    currentFile: "",
    message: `Found ${results.length} video files.`,
  });

  return { files: results, skippedFiles };
}

function runFfprobe(filePath) {
  return new Promise((resolve) => {
    const args = [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      [
        "stream=width",
        "height",
        "duration",
        "display_aspect_ratio",
        "sample_aspect_ratio",
        "codec_name",
        "codec_long_name",
        "profile",
        "pix_fmt",
        "level",
        "bit_rate",
        "avg_frame_rate",
        "r_frame_rate",
        "nb_frames",
      ].join(","),
      "-show_entries",
      "format=duration,size,bit_rate,format_name,format_long_name",
      "-of",
      "json",
      filePath,
    ];

    const child = spawn("ffprobe", args);

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

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
          error: stderr || `ffprobe exited with code ${code}`,
        });
        return;
      }

      try {
        const parsed = JSON.parse(stdout);
        const stream = parsed.streams?.[0];

        if (!stream) {
          resolve({
            ok: false,
            error: "No video stream found",
          });
          return;
        }

        resolve({
          ok: true,
          stream,
          format: parsed.format || {},
        });
      } catch (error) {
        resolve({
          ok: false,
          error: `Failed to parse ffprobe JSON: ${error.message}`,
        });
      }
    });
  });
}

function parseRatioString(value) {
  if (!value || typeof value !== "string" || value === "0:1") {
    return null;
  }

  const [left, right] = value.split(":").map(Number);

  if (!left || !right) {
    return null;
  }

  return left / right;
}

function getEffectiveAspectRatio(stream) {
  const displayAspectRatio = parseRatioString(stream.display_aspect_ratio);

  if (displayAspectRatio) {
    return displayAspectRatio;
  }

  const width = Number(stream.width);
  const height = Number(stream.height);

  if (!width || !height) {
    return null;
  }

  const sampleAspectRatio = parseRatioString(stream.sample_aspect_ratio) || 1;

  return (width / height) * sampleAspectRatio;
}

function isApproximatelyTargetAspectRatio(ratio, targetAspectRatio, tolerance) {
  if (!ratio) return false;
  return Math.abs(ratio - targetAspectRatio) <= tolerance;
}

function truncateMiddle(value, maxLength = 54) {
  const str = String(value ?? "");

  if (str.length <= maxLength) return str;

  const keep = Math.floor((maxLength - 3) / 2);
  return `${str.slice(0, keep)}...${str.slice(str.length - keep)}`;
}

function createProgressBar(total) {
  const bar = new cliProgress.SingleBar(
    {
      format:
        "Scanning [{bar}] {percentage}% | {value}/{total} | flagged: {flagged} | errors: {errors} | ETA: {eta_formatted} | {currentFile}",
      barCompleteChar: "█",
      barIncompleteChar: "░",
      hideCursor: true,
      clearOnComplete: false,
      stopOnComplete: true,
      formatValue(value, options, type) {
        if (type === "percentage") {
          return Number(value).toFixed(2);
        }

        return value;
      },
    },
    cliProgress.Presets.shades_classic
  );

  bar.start(total, 0, {
    flagged: 0,
    errors: 0,
    currentFile: "Starting...",
  });

  return bar;
}

function safeNumber(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}

function bytesToMB(bytes) {
  if (!Number.isFinite(bytes)) return null;
  return Number((bytes / 1024 / 1024).toFixed(2));
}

function bytesToGB(bytes) {
  if (!Number.isFinite(bytes)) return null;
  return Number((bytes / 1024 / 1024 / 1024).toFixed(3));
}

function bitRateToMbps(bitRate) {
  const value = safeNumber(bitRate);

  if (value === null) return null;

  return Number((value / 1_000_000).toFixed(3));
}

function parseFrameRate(value) {
  if (!value || typeof value !== "string") return null;

  const [numerator, denominator] = value.split("/").map(Number);

  if (!numerator || !denominator) return null;

  return Number((numerator / denominator).toFixed(3));
}

function formatDuration(seconds) {
  const value = safeNumber(seconds);

  if (value === null) return "";

  const rounded = Math.round(value);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const secs = rounded % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(
      2,
      "0"
    )}`;
  }

  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function toIsoStringOrNull(value) {
  if (!(value instanceof Date)) return null;

  const timestamp = value.getTime();

  if (!Number.isFinite(timestamp)) return null;

  return value.toISOString();
}

async function getFileInfo(filePath) {
  const stat = await fs.stat(filePath);

  const sizeBytes = stat.size;

  return {
    directory: path.dirname(filePath),
    extension: path.extname(filePath).toLowerCase(),
    sizeBytes,
    sizeMB: bytesToMB(sizeBytes),
    sizeGB: bytesToGB(sizeBytes),
    createdAt: toIsoStringOrNull(stat.birthtime),
    modifiedAt: toIsoStringOrNull(stat.mtime),
    createdAtMs: stat.birthtimeMs,
    modifiedAtMs: stat.mtimeMs,
  };
}

function formatTargetAspectRatio(targetAspectRatio) {
  if (Math.abs(targetAspectRatio - DEFAULT_TARGET_ASPECT_RATIO) < 0.000001) {
    return "16:9";
  }

  return Number(targetAspectRatio.toFixed(6));
}

function buildFlaggedVideoRecord({
  filePath,
  fileName,
  fileInfo,
  stream,
  format,
  minHeight,
  targetAspectRatio,
  aspectRatioTolerance,
  includeLowResolutionAnalysis,
  blackBorder,
}) {
  const width = safeNumber(stream.width);
  const height = safeNumber(stream.height);

  const streamDurationSeconds = safeNumber(stream.duration);
  const formatDurationSeconds = safeNumber(format.duration);
  const durationSeconds = streamDurationSeconds ?? formatDurationSeconds;

  const streamBitRate = safeNumber(stream.bit_rate);
  const formatBitRate = safeNumber(format.bit_rate);
  const bitRate = streamBitRate ?? formatBitRate;

  const formatSizeBytes = safeNumber(format.size);
  const sizeBytes = fileInfo.sizeBytes ?? formatSizeBytes;

  const aspectRatio = getEffectiveAspectRatio(stream);

  const isLowResolution = height === null || height < minHeight;
  const isWrongAspectRatio = !isApproximatelyTargetAspectRatio(
    aspectRatio,
    targetAspectRatio,
    aspectRatioTolerance
  );

  const nestedBlackBordersDetected =
    isHighConfidenceNestedBorderCandidate(blackBorder);
  const record = {
    path: filePath,
    directory: fileInfo.directory,
    fileName,
    extension: fileInfo.extension,

    sizeBytes,
    sizeMB: bytesToMB(sizeBytes),
    sizeGB: bytesToGB(sizeBytes),

    fileSystemSizeBytes: fileInfo.sizeBytes,
    ffprobeFormatSizeBytes: formatSizeBytes,

    createdAt: fileInfo.createdAt,
    modifiedAt: fileInfo.modifiedAt,
    createdAtMs: fileInfo.createdAtMs,
    modifiedAtMs: fileInfo.modifiedAtMs,

    durationSeconds:
      durationSeconds === null ? null : Number(durationSeconds.toFixed(3)),
    durationFormatted: formatDuration(durationSeconds),

    streamDurationSeconds:
      streamDurationSeconds === null
        ? null
        : Number(streamDurationSeconds.toFixed(3)),
    formatDurationSeconds:
      formatDurationSeconds === null
        ? null
        : Number(formatDurationSeconds.toFixed(3)),

    width,
    height,
    resolution: width && height ? `${width}x${height}` : "",

    displayAspectRatio: stream.display_aspect_ratio || "",
    sampleAspectRatio: stream.sample_aspect_ratio || "",
    calculatedAspectRatio: aspectRatio ? Number(aspectRatio.toFixed(6)) : null,
    targetAspectRatio: formatTargetAspectRatio(targetAspectRatio),

    codecName: stream.codec_name || "",
    codecLongName: stream.codec_long_name || "",
    profile: stream.profile || "",
    pixFmt: stream.pix_fmt || "",
    level: safeNumber(stream.level),

    bitRate,
    bitRateMbps: bitRateToMbps(bitRate),

    streamBitRate,
    formatBitRate,

    avgFrameRate: stream.avg_frame_rate || "",
    rawFrameRate: stream.r_frame_rate || "",
    frameRate: parseFrameRate(stream.avg_frame_rate || stream.r_frame_rate),

    nbFrames: safeNumber(stream.nb_frames),

    formatName: format.format_name || "",
    formatLongName: format.format_long_name || "",

    isLowResolution,
    isWrongAspectRatio,
    reasons: [
      includeLowResolutionAnalysis && isLowResolution
        ? `height below ${minHeight}`
        : null,
      includeLowResolutionAnalysis && isWrongAspectRatio
        ? "not 16:9 aspect ratio"
        : null,
      nestedBlackBordersDetected ? "nested black borders detected" : null,
    ]
      .filter(Boolean)
      .join("; "),
  };

  if (blackBorder) {
    record.adjustments = {
      blackBorder,
    };
  }

  return record;
}

async function auditVideos({
  directoryPath,
  minHeight = DEFAULT_MIN_HEIGHT,
  targetAspectRatio = DEFAULT_TARGET_ASPECT_RATIO,
  aspectRatioTolerance = DEFAULT_ASPECT_RATIO_TOLERANCE,
  includeLowResolutionAnalysis = true,
  includeBlackBorderAnalysis = false,
  onProgress,
}) {
  if (!directoryPath) {
    throw new Error("directoryPath is required");
  }

  const absoluteDirectoryPath = path.resolve(directoryPath);
  const directoryStat = await fs.stat(absoluteDirectoryPath);

  if (!directoryStat.isDirectory()) {
    throw new Error(`Not a directory: ${absoluteDirectoryPath}`);
  }

  const { files, skippedFiles } = await findVideoFiles(
    absoluteDirectoryPath,
    onProgress
  );
  const flagged = [];
  const errors = [];

  emitProgress(onProgress, {
    phase: "analyzing",
    totalFiles: files.length,
    processedFiles: 0,
    skippedFiles,
    flaggedCount: 0,
    errorCount: 0,
    currentFile: "",
    message:
      files.length === 0 ? "No matching video files found." : "Analyzing videos...",
  });

  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];
    const fileName = path.basename(filePath);

    emitProgress(onProgress, {
      phase: "analyzing",
      totalFiles: files.length,
      processedFiles: i,
      skippedFiles,
      flaggedCount: flagged.length,
      errorCount: errors.length,
      currentFile: fileName,
      message: "Analyzing videos...",
    });

    let fileInfo;

    try {
      fileInfo = await getFileInfo(filePath);
    } catch (error) {
      errors.push({
        path: filePath,
        fileName,
        error: `Failed to read file info: ${error.message}`,
      });

      emitProgress(onProgress, {
        phase: "analyzing",
        totalFiles: files.length,
        processedFiles: i + 1,
        skippedFiles,
        flaggedCount: flagged.length,
        errorCount: errors.length,
        currentFile: fileName,
        message: "Analyzing videos...",
      });

      continue;
    }

    const result = await runFfprobe(filePath);

    if (!result.ok) {
      errors.push({
        path: filePath,
        fileName,
        ...fileInfo,
        error: result.error,
      });

      emitProgress(onProgress, {
        phase: "analyzing",
        totalFiles: files.length,
        processedFiles: i + 1,
        skippedFiles,
        flaggedCount: flagged.length,
        errorCount: errors.length,
        currentFile: fileName,
        message: "Analyzing videos...",
      });

      continue;
    }

    const streamDurationSeconds = safeNumber(result.stream.duration);
    const formatDurationSeconds = safeNumber(result.format.duration);
    const durationSeconds = streamDurationSeconds ?? formatDurationSeconds;
    const width = safeNumber(result.stream.width);
    const height = safeNumber(result.stream.height);
    const blackBorder = includeBlackBorderAnalysis
      ? await analyzeBlackBorders({
          filePath,
          width,
          height,
          durationSeconds,
        })
      : null;

    const record = buildFlaggedVideoRecord({
      filePath,
      fileName,
      fileInfo,
      stream: result.stream,
      format: result.format,
      minHeight,
      targetAspectRatio,
      aspectRatioTolerance,
      includeLowResolutionAnalysis,
      blackBorder,
      status: "Pending",
    });

    const lowResolutionDetected =
      includeLowResolutionAnalysis &&
      (record.isLowResolution || record.isWrongAspectRatio);
    const blackBorderDetected =
      includeBlackBorderAnalysis &&
      isHighConfidenceNestedBorderCandidate(blackBorder);

    if (
      lowResolutionDetected ||
      blackBorderDetected
    ) {
      flagged.push(record);
    }

    emitProgress(onProgress, {
      phase: "analyzing",
      totalFiles: files.length,
      processedFiles: i + 1,
      skippedFiles,
      flaggedCount: flagged.length,
      errorCount: errors.length,
      currentFile: fileName,
      message: "Analyzing videos...",
    });
  }

  const summary = {
    directoryPath: absoluteDirectoryPath,
    totalFiles: files.length,
    scannedVideos: files.length,
    flaggedCount: flagged.length,
    errorCount: errors.length,
  };

  emitProgress(onProgress, {
    phase: "complete",
    totalFiles: files.length,
    processedFiles: files.length,
    skippedFiles,
    flaggedCount: flagged.length,
    errorCount: errors.length,
    currentFile: "",
    message: "Audit complete.",
  });

  return {
    summary,
    videos: flagged,
    errors,
  };
}

async function runCli() {
  const inputDir = process.argv[2];
  const outputBase = process.argv[3] || "video-audit-report";

  if (!inputDir) {
    console.error("Usage: node audit-videos.js <directory> [outputBaseName]");
    process.exit(1);
  }

  const absoluteInputDir = path.resolve(inputDir);

  if (!(await pathExists(absoluteInputDir))) {
    console.error(`Directory does not exist: ${absoluteInputDir}`);
    process.exit(1);
  }

  console.log(`Scanning directory: ${absoluteInputDir}`);
  console.log("Finding video files...");

  let progressBar = null;

  const result = await auditVideos({
    directoryPath: absoluteInputDir,
    onProgress(progress) {
      if (progress.phase !== "analyzing") return;

      if (!progressBar && progress.totalFiles > 0) {
        progressBar = createProgressBar(progress.totalFiles);
      }

      if (!progressBar) return;

      progressBar.update(progress.processedFiles, {
        flagged: progress.flaggedCount,
        errors: progress.errorCount,
        currentFile: truncateMiddle(progress.currentFile),
      });
    },
  });

  if (progressBar) {
    progressBar.stop();
  }

  const jsonPath = `${outputBase}.json`;
  const errorPath = `${outputBase}.errors.json`;

  await fs.writeFile(jsonPath, JSON.stringify(result.videos, null, 2));

  if (result.errors.length > 0) {
    await fs.writeFile(errorPath, JSON.stringify(result.errors, null, 2));
  }

  console.log("");
  console.log("Done.");
  console.log(`Scanned videos: ${result.summary.scannedVideos}`);
  console.log(`Flagged videos: ${result.summary.flaggedCount}`);
  console.log(`Errors: ${result.summary.errorCount}`);
  console.log(`JSON: ${jsonPath}`);

  if (result.errors.length > 0) {
    console.log(`Errors file: ${errorPath}`);
  }
}

if (require.main === module) {
  runCli().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  auditVideos,
};
