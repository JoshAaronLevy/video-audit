const path = require("node:path");

const SUPPORTED_VIDEO_EXTENSIONS = [
  ".mp4",
  ".mov",
  ".m4v",
  ".mkv",
  ".avi",
  ".wmv",
  ".webm",
  ".mpeg",
  ".mpg",
  ".m2ts",
  ".ts",
];

const SUPPORTED_VIDEO_EXTENSION_SET = new Set(SUPPORTED_VIDEO_EXTENSIONS);

function normalizeVideoExtension(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return "";
  }

  const extension = value.startsWith(".") ? value : path.extname(value);
  return extension.toLowerCase();
}

function getVideoFileType(value) {
  const extension = normalizeVideoExtension(value);

  return extension ? extension.slice(1).toUpperCase() : "";
}

function isSupportedVideoExtension(value) {
  return SUPPORTED_VIDEO_EXTENSION_SET.has(normalizeVideoExtension(value));
}

function isSupportedVideoFileName(fileName) {
  return isSupportedVideoExtension(path.extname(fileName || ""));
}

module.exports = {
  SUPPORTED_VIDEO_EXTENSIONS,
  SUPPORTED_VIDEO_EXTENSION_SET,
  getVideoFileType,
  isSupportedVideoExtension,
  isSupportedVideoFileName,
  normalizeVideoExtension,
};
