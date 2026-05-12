const { spawn } = require("node:child_process");

const SAMPLE_FRACTIONS = [0.1, 0.25, 0.5, 0.75, 0.9];
const CROPDETECT_LIMIT = 24;
const CROPDETECT_ROUND = 2;
const CROPDETECT_SECONDS = 2;
const MIN_BORDER_PIXELS = 12;
const MIN_BORDER_RATIO = 0.006;
const RECT_AGREEMENT_PIXELS = 8;
const ASPECT_RATIO_16_9 = 16 / 9;
const AUTO_CROP_ASPECT_TOLERANCE = 0.03;
const MIN_VISIBLE_WIDTH = 640;
const MIN_VISIBLE_HEIGHT = 360;
const DEFAULT_TARGET_WIDTH = 1920;
const DEFAULT_TARGET_HEIGHT = 1080;

function safeNumber(value) {
  if (value === undefined || value === null || value === "") return null;

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundNumber(value, fractionDigits = 6) {
  return Number(value.toFixed(fractionDigits));
}

function getAspectRatioLabel(ratio) {
  if (!Number.isFinite(ratio) || ratio <= 0) return "";

  const knownRatios = [
    { label: "16:9", value: 16 / 9 },
    { label: "4:3", value: 4 / 3 },
    { label: "9:16", value: 9 / 16 },
    { label: "1:1", value: 1 },
    { label: "21:9", value: 21 / 9 },
  ];

  const match = knownRatios.find(
    (candidate) => Math.abs(ratio - candidate.value) <= 0.03
  );

  return match ? match.label : ratio.toFixed(3);
}

function getSampleTimestamps(durationSeconds) {
  const duration = safeNumber(durationSeconds);

  if (!duration || duration <= 0) {
    return SAMPLE_FRACTIONS.map(() => 0);
  }

  const maxSeek = Math.max(0, duration - 0.25);

  return SAMPLE_FRACTIONS.map((fraction) =>
    roundNumber(Math.min(maxSeek, Math.max(0, duration * fraction)), 3)
  );
}

function parseCropdetectOutput(stderr) {
  const matches = Array.from(
    stderr.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)
  );

  if (matches.length === 0) return null;

  const lastMatch = matches[matches.length - 1];
  const [, width, height, x, y] = lastMatch;

  return {
    width: Number(width),
    height: Number(height),
    x: Number(x),
    y: Number(y),
  };
}

function runCropdetectSample({ filePath, timestampSeconds }) {
  return new Promise((resolve) => {
    const args = [
      "-hide_banner",
      "-ss",
      String(timestampSeconds),
      "-i",
      filePath,
      "-t",
      String(CROPDETECT_SECONDS),
      "-vf",
      `cropdetect=limit=${CROPDETECT_LIMIT}:round=${CROPDETECT_ROUND}:reset=0`,
      "-f",
      "null",
      "-",
    ];

    const child = spawn("ffmpeg", args);
    let stderr = "";

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (error) => {
      resolve({
        ok: false,
        timestampSeconds,
        error: error.message,
      });
    });

    child.on("close", (code) => {
      if (code !== 0) {
        resolve({
          ok: false,
          timestampSeconds,
          error: stderr || `ffmpeg exited with code ${code}`,
        });
        return;
      }

      const crop = parseCropdetectOutput(stderr);

      if (!crop) {
        resolve({
          ok: false,
          timestampSeconds,
          error: "No cropdetect crop value was emitted.",
        });
        return;
      }

      resolve({
        ok: true,
        timestampSeconds,
        crop,
      });
    });
  });
}

function rectanglesAgree(first, second) {
  return (
    Math.abs(first.width - second.width) <= RECT_AGREEMENT_PIXELS &&
    Math.abs(first.height - second.height) <= RECT_AGREEMENT_PIXELS &&
    Math.abs(first.x - second.x) <= RECT_AGREEMENT_PIXELS &&
    Math.abs(first.y - second.y) <= RECT_AGREEMENT_PIXELS
  );
}

function getDominantCrop(samples) {
  const clusters = [];

  for (const sample of samples) {
    const existingCluster = clusters.find((cluster) =>
      rectanglesAgree(cluster.crop, sample.crop)
    );

    if (existingCluster) {
      existingCluster.samples.push(sample);
      continue;
    }

    clusters.push({
      crop: sample.crop,
      samples: [sample],
    });
  }

  clusters.sort((first, second) => second.samples.length - first.samples.length);

  return clusters[0] || null;
}

function getConfidence(agreementCount) {
  if (agreementCount >= 4) return "high";
  if (agreementCount >= 3) return "medium";
  return "low";
}

function getBorderThreshold(frameSize) {
  return Math.max(MIN_BORDER_PIXELS, Math.round(frameSize * MIN_BORDER_RATIO));
}

function isAutoCropEligible({ classification, confidence, visibleArea }) {
  if (classification !== "nested_borders" || confidence !== "high") {
    return false;
  }

  const aspectRatio = visibleArea.width / visibleArea.height;

  return (
    Math.abs(aspectRatio - ASPECT_RATIO_16_9) <= AUTO_CROP_ASPECT_TOLERANCE &&
    visibleArea.width >= MIN_VISIBLE_WIDTH &&
    visibleArea.height >= MIN_VISIBLE_HEIGHT
  );
}

function classifyBorders({ borders, sourceWidth, sourceHeight, crop }) {
  const horizontalThreshold = getBorderThreshold(sourceWidth);
  const verticalThreshold = getBorderThreshold(sourceHeight);
  const hasLeft = borders.left >= horizontalThreshold;
  const hasRight = borders.right >= horizontalThreshold;
  const hasTop = borders.top >= verticalThreshold;
  const hasBottom = borders.bottom >= verticalThreshold;
  const hasSideBorder = hasLeft || hasRight;
  const hasVerticalBorder = hasTop || hasBottom;
  const sideIsSymmetric = hasLeft === hasRight;
  const verticalIsSymmetric = hasTop === hasBottom;
  const blackFrameEstimate =
    1 - (crop.width * crop.height) / (sourceWidth * sourceHeight);

  if (!hasSideBorder && !hasVerticalBorder) {
    return blackFrameEstimate <= 0.01 ? "clean" : "uncertain";
  }

  if (hasLeft && hasRight && !hasVerticalBorder) return "pillarboxed";
  if (hasTop && hasBottom && !hasSideBorder) return "letterboxed";

  if (
    hasSideBorder &&
    hasVerticalBorder &&
    sideIsSymmetric &&
    verticalIsSymmetric
  ) {
    return "nested_borders";
  }

  return "asymmetric_border";
}

function createAnalysisError({ width, height, durationSeconds, message }) {
  const sourceAspectRatio = width && height ? width / height : null;

  return {
    analyzed: true,
    detected: false,
    classification: "analysis_error",
    confidence: "low",
    error: message,
    source: {
      width,
      height,
      aspectRatio: sourceAspectRatio ? roundNumber(sourceAspectRatio) : null,
      aspectRatioLabel: sourceAspectRatio
        ? getAspectRatioLabel(sourceAspectRatio)
        : "",
    },
    durationSeconds,
    samples: [],
    recommendedFix: {
      eligible: false,
      type: "manual-review",
      reason: "Black-border analysis could not be completed.",
    },
  };
}

async function analyzeBlackBorders({
  filePath,
  width,
  height,
  durationSeconds,
}) {
  const sourceWidth = safeNumber(width);
  const sourceHeight = safeNumber(height);
  const duration = safeNumber(durationSeconds);

  if (!filePath || !sourceWidth || !sourceHeight) {
    return createAnalysisError({
      width: sourceWidth,
      height: sourceHeight,
      durationSeconds: duration,
      message: "Source dimensions are unavailable.",
    });
  }

  const timestamps = getSampleTimestamps(duration);
  const sampleResults = [];

  for (const timestampSeconds of timestamps) {
    sampleResults.push(
      await runCropdetectSample({
        filePath,
        timestampSeconds,
      })
    );
  }

  const successfulSamples = sampleResults
    .filter((sample) => sample.ok)
    .map(({ timestampSeconds, crop }) => ({
      timestampSeconds,
      crop,
    }));

  if (successfulSamples.length === 0) {
    const firstError = sampleResults.find((sample) => sample.error)?.error;

    return createAnalysisError({
      width: sourceWidth,
      height: sourceHeight,
      durationSeconds: duration,
      message: firstError || "No cropdetect samples succeeded.",
    });
  }

  const dominant = getDominantCrop(successfulSamples);
  const crop = dominant.crop;
  const agreementCount = dominant.samples.length;
  const confidence = getConfidence(agreementCount);
  const borders = {
    left: crop.x,
    right: Math.max(0, sourceWidth - crop.x - crop.width),
    top: crop.y,
    bottom: Math.max(0, sourceHeight - crop.y - crop.height),
  };
  const sourceAspectRatio = sourceWidth / sourceHeight;
  const visibleAspectRatio = crop.width / crop.height;
  const blackFrameEstimate =
    1 - (crop.width * crop.height) / (sourceWidth * sourceHeight);
  const classification = classifyBorders({
    borders,
    sourceWidth,
    sourceHeight,
    crop,
  });
  const visibleArea = {
    width: crop.width,
    height: crop.height,
    x: crop.x,
    y: crop.y,
    aspectRatio: roundNumber(visibleAspectRatio),
    aspectRatioLabel: getAspectRatioLabel(visibleAspectRatio),
  };
  const detected = classification !== "clean" && classification !== "uncertain";
  const eligible = isAutoCropEligible({
    classification,
    confidence,
    visibleArea,
  });

  return {
    analyzed: true,
    detected,
    classification,
    confidence,
    source: {
      width: sourceWidth,
      height: sourceHeight,
      aspectRatio: roundNumber(sourceAspectRatio),
      aspectRatioLabel: getAspectRatioLabel(sourceAspectRatio),
    },
    visibleArea,
    borders,
    borderPercent: {
      left: roundNumber((borders.left / sourceWidth) * 100, 3),
      right: roundNumber((borders.right / sourceWidth) * 100, 3),
      top: roundNumber((borders.top / sourceHeight) * 100, 3),
      bottom: roundNumber((borders.bottom / sourceHeight) * 100, 3),
      blackFrameEstimate: roundNumber(blackFrameEstimate * 100, 3),
    },
    samples: successfulSamples,
    sampleAgreement: {
      matchingSamples: agreementCount,
      totalSamples: timestamps.length,
      successfulSamples: successfulSamples.length,
    },
    recommendedFix: eligible
      ? {
          eligible: true,
          type: "crop-scale",
          targetWidth: DEFAULT_TARGET_WIDTH,
          targetHeight: DEFAULT_TARGET_HEIGHT,
          reason:
            "High-confidence nested borders with visible area close to 16:9.",
        }
      : {
          eligible: false,
          type: "manual-review",
          reason:
            classification === "nested_borders"
              ? "Nested borders need manual review because confidence or visible aspect ratio is outside the auto-crop target."
              : "No high-confidence 16:9 nested-border auto-crop candidate was detected.",
        },
  };
}

function isHighConfidenceNestedBorderCandidate(blackBorder) {
  return Boolean(
    blackBorder &&
      blackBorder.analyzed &&
      blackBorder.classification === "nested_borders" &&
      blackBorder.confidence === "high"
  );
}

function isBlackBorderReviewCandidate(blackBorder) {
  return Boolean(
    blackBorder &&
      blackBorder.analyzed &&
      (blackBorder.classification === "nested_borders" ||
        blackBorder.classification === "asymmetric_border")
  );
}

module.exports = {
  analyzeBlackBorders,
  isBlackBorderReviewCandidate,
  isHighConfidenceNestedBorderCandidate,
};
