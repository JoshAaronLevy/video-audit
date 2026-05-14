const fs = require("node:fs/promises");
const path = require("node:path");
const {
  SUPPORTED_VIDEO_EXTENSIONS,
  isSupportedVideoFileName,
} = require("./videoExtensions");

const EXCLUDED_DIRECTORY_NAMES = new Set([
  ".git",
  ".Spotlight-V100",
  ".Trashes",
  ".fseventsd",
  ".TemporaryItems",
  "System Volume Information",
  "node_modules",
  ".video-audit-temp",
  ".video-audit-trash",
  ".video-audit-cleanup-runs",
  "Archive",
  "archived-files",
]);

function nowIsoString() {
  return new Date().toISOString();
}

function normalizePath(value) {
  return path.resolve(value);
}

function toRelativeTreePath(rootPath, childPath) {
  const relativePath = path.relative(rootPath, childPath);

  return relativePath ? relativePath.split(path.sep).join("/") : "";
}

function createWarning(type, targetPath, message) {
  return {
    type,
    path: targetPath,
    message,
  };
}

async function inspectRoot(rootPath, label = "SanDisk Edited Videos") {
  try {
    const stats = await fs.lstat(rootPath);

    if (stats.isSymbolicLink()) {
      return {
        defaultRoot: rootPath,
        available: false,
        label,
        message: `${rootPath} is a symlink and cannot be used as the video tree root.`,
      };
    }

    if (!stats.isDirectory()) {
      return {
        defaultRoot: rootPath,
        available: false,
        label,
        message: `${rootPath} exists, but it is not a folder.`,
      };
    }

    return {
      defaultRoot: rootPath,
      available: true,
      label,
      message: "Default video folder is available.",
    };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return {
        defaultRoot: rootPath,
        available: false,
        label,
        message:
          "Default video folder was not found. Make sure the SanDisk SSD is connected.",
      };
    }

    return {
      defaultRoot: rootPath,
      available: false,
      label,
      message:
        error instanceof Error
          ? `Unable to inspect default video folder: ${error.message}`
          : "Unable to inspect default video folder.",
    };
  }
}

async function buildFolderTree({
  rootPath,
  label = "SanDisk Edited Videos",
} = {}) {
  const absoluteRootPath = normalizePath(rootPath);
  const rootStatus = await inspectRoot(absoluteRootPath, label);
  const generatedAt = nowIsoString();

  if (!rootStatus.available) {
    return {
      root: {
        path: absoluteRootPath,
        name: path.basename(absoluteRootPath),
        available: false,
        label,
      },
      generatedAt,
      supportedVideoExtensions: SUPPORTED_VIDEO_EXTENSIONS,
      summary: {
        folderCount: 0,
        videoCount: 0,
        totalVideoSizeBytes: 0,
      },
      nodes: [],
      warnings: [],
      message: rootStatus.message,
    };
  }

  const warnings = [];

  async function walk(currentPath) {
    let entries;

    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch (error) {
      warnings.push(
        createWarning(
          "unreadable_directory",
          currentPath,
          error instanceof Error
            ? `Skipping unreadable directory: ${error.message}`
            : "Skipping unreadable directory."
        )
      );
      return null;
    }

    entries.sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
    );

    const children = [];
    let videoCount = 0;
    let totalVideoSizeBytes = 0;
    let folderCount = 1;

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isSymbolicLink()) {
        warnings.push(
          createWarning("symlink_skipped", fullPath, "Skipping symlink.")
        );
        continue;
      }

      if (entry.isDirectory()) {
        if (EXCLUDED_DIRECTORY_NAMES.has(entry.name)) {
          continue;
        }

        const childNode = await walk(fullPath);

        if (!childNode || childNode.data.videoCount === 0) {
          continue;
        }

        children.push(childNode);
        videoCount += childNode.data.videoCount;
        totalVideoSizeBytes += childNode.data.totalVideoSizeBytes;
        folderCount += childNode.data.folderCount;
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (entry.name.startsWith("._") || entry.name === ".DS_Store") {
        continue;
      }

      if (!isSupportedVideoFileName(entry.name)) {
        continue;
      }

      try {
        const stats = await fs.stat(fullPath);

        if (!stats.isFile()) {
          continue;
        }

        videoCount += 1;
        totalVideoSizeBytes += stats.size;
      } catch (error) {
        warnings.push(
          createWarning(
            "unreadable_file",
            fullPath,
            error instanceof Error
              ? `Skipping unreadable video file: ${error.message}`
              : "Skipping unreadable video file."
          )
        );
      }
    }

    const relativePath = toRelativeTreePath(absoluteRootPath, currentPath);
    const node = {
      key: currentPath,
      data: {
        name: path.basename(currentPath),
        path: currentPath,
        relativePath,
        type: "folder",
        videoCount,
        totalVideoSizeBytes,
        folderCount,
      },
      children,
      leaf: children.length === 0,
    };

    return node;
  }

  const rootNode = await walk(absoluteRootPath);
  const safeRootNode =
    rootNode ||
    {
      key: absoluteRootPath,
      data: {
        name: path.basename(absoluteRootPath),
        path: absoluteRootPath,
        relativePath: "",
        type: "folder",
        videoCount: 0,
        totalVideoSizeBytes: 0,
        folderCount: 1,
      },
      children: [],
      leaf: true,
    };

  return {
    root: {
      path: absoluteRootPath,
      name: path.basename(absoluteRootPath),
      available: true,
      label,
    },
    generatedAt,
    supportedVideoExtensions: SUPPORTED_VIDEO_EXTENSIONS,
    summary: {
      folderCount: safeRootNode.data.videoCount > 0 ? safeRootNode.data.folderCount : 0,
      videoCount: safeRootNode.data.videoCount,
      totalVideoSizeBytes: safeRootNode.data.totalVideoSizeBytes,
    },
    nodes: [safeRootNode],
    warnings,
  };
}

module.exports = {
  EXCLUDED_DIRECTORY_NAMES,
  buildFolderTree,
  inspectRoot,
};
