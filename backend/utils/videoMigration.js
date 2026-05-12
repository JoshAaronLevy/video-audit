const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".mov",
  ".m4v",
  ".mkv",
  ".avi",
  ".webm",
]);
const EXCLUDED_DIRECTORY_NAMES = new Set([
  ".video-audit-temp",
  ".video-audit-trash",
  ".video-audit-cleanup-runs",
  "Archive",
  "node_modules",
]);

function nowIsoString() {
  return new Date().toISOString();
}

function timestampForRunId(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  const milliseconds = String(date.getMilliseconds()).padStart(3, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(
    date.getSeconds()
  )}-${milliseconds}`;
}

function createMigrationId(date = new Date()) {
  return `video-audit-migration-${timestampForRunId(date)}`;
}

function normalizePath(value) {
  return path.resolve(value);
}

function isSamePath(left, right) {
  return normalizePath(left) === normalizePath(right);
}

function isPathInside(parentPath, childPath) {
  const relativePath = path.relative(normalizePath(parentPath), normalizePath(childPath));

  return Boolean(relativePath) && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function isVideoFileName(fileName) {
  return VIDEO_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

function toIsoStringOrNull(value) {
  if (!(value instanceof Date)) return null;

  const timestamp = value.getTime();

  if (!Number.isFinite(timestamp)) return null;

  return value.toISOString();
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function assertAbsoluteDirectory({ label, value }) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is required.`);
  }

  if (!path.isAbsolute(value)) {
    throw new Error(`${label} must be an absolute path.`);
  }

  const absolutePath = normalizePath(value);
  const stat = await fs.lstat(absolutePath);

  if (stat.isSymbolicLink()) {
    throw new Error(`${label} must not be a symlink.`);
  }

  if (!stat.isDirectory()) {
    throw new Error(`${label} must point to a directory.`);
  }

  return absolutePath;
}

async function validateScanRequest(body) {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Request body is required." };
  }

  let newEditedDir;
  let destinationRoot;
  let archiveRoot;

  try {
    newEditedDir = await assertAbsoluteDirectory({
      label: "newEditedDir",
      value: body.newEditedDir,
    });
    destinationRoot = await assertAbsoluteDirectory({
      label: "destinationRoot",
      value: body.destinationRoot,
    });
  } catch (error) {
    return { ok: false, error: error.message };
  }

  if (isSamePath(newEditedDir, destinationRoot)) {
    return {
      ok: false,
      error: "newEditedDir and destinationRoot must be different directories.",
    };
  }

  if (isPathInside(destinationRoot, newEditedDir)) {
    return {
      ok: false,
      error: "newEditedDir must not be inside destinationRoot.",
    };
  }

  if (isPathInside(newEditedDir, destinationRoot)) {
    return {
      ok: false,
      error: "destinationRoot must not be inside newEditedDir.",
    };
  }

  archiveRoot = body.archiveRoot
    ? normalizePath(body.archiveRoot)
    : path.join(path.dirname(destinationRoot), "Archive");

  if (!path.isAbsolute(archiveRoot)) {
    return {
      ok: false,
      error: "archiveRoot must be an absolute path when provided.",
    };
  }

  try {
    const archiveRootStat = await fs.lstat(archiveRoot);

    if (archiveRootStat.isSymbolicLink()) {
      return {
        ok: false,
        error: "archiveRoot must not be a symlink.",
      };
    }

    if (!archiveRootStat.isDirectory()) {
      return {
        ok: false,
        error: "archiveRoot must point to a directory when it already exists.",
      };
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      return {
        ok: false,
        error: `Unable to inspect archiveRoot: ${error.message}`,
      };
    }
  }

  if (isSamePath(archiveRoot, destinationRoot)) {
    return {
      ok: false,
      error: "archiveRoot must not be the same as destinationRoot.",
    };
  }

  if (isPathInside(destinationRoot, archiveRoot)) {
    return {
      ok: false,
      error: "archiveRoot must not be inside destinationRoot.",
    };
  }

  return {
    ok: true,
    newEditedDir,
    destinationRoot,
    archiveRoot,
  };
}

function shouldSkipDirectory({ entryName, fullPath, archiveRoot }) {
  if (EXCLUDED_DIRECTORY_NAMES.has(entryName)) return true;

  if (archiveRoot) {
    const normalizedFullPath = normalizePath(fullPath);
    const normalizedArchiveRoot = normalizePath(archiveRoot);

    if (
      normalizedFullPath === normalizedArchiveRoot ||
      isPathInside(normalizedArchiveRoot, normalizedFullPath)
    ) {
      return true;
    }
  }

  return false;
}

async function collectVideoFiles({ rootDir, archiveRoot = null }) {
  const files = [];
  const warnings = [];

  async function walk(currentDir) {
    let entries;

    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch (error) {
      warnings.push(`Skipping unreadable directory: ${currentDir} (${error.message})`);
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isSymbolicLink()) {
        warnings.push(`Skipping symlink: ${fullPath}`);
        continue;
      }

      if (entry.isDirectory()) {
        if (shouldSkipDirectory({ entryName: entry.name, fullPath, archiveRoot })) {
          continue;
        }

        await walk(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;
      if (entry.name.startsWith("._") || entry.name === ".DS_Store") continue;
      if (!isVideoFileName(entry.name)) continue;

      let stat;

      try {
        stat = await fs.stat(fullPath);
      } catch (error) {
        warnings.push(`Skipping unreadable file: ${fullPath} (${error.message})`);
        continue;
      }

      files.push({
        path: fullPath,
        fileName: entry.name,
        sizeBytes: stat.size,
        modifiedAt: toIsoStringOrNull(stat.mtime),
        createdAt: toIsoStringOrNull(stat.birthtime),
      });
    }
  }

  await walk(rootDir);

  return { files, warnings };
}

function getDestinationRelativePath({ destinationRoot, filePath }) {
  const relativePath = path.relative(destinationRoot, filePath);

  if (
    !relativePath ||
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`Unable to build archive path for ${filePath}.`);
  }

  const parsed = path.parse(relativePath);

  if (parsed.dir === "") {
    return path.join("root", parsed.base);
  }

  return relativePath;
}

function getArchiveRelativePath(originalRelativePath) {
  return path.join("archived-files", originalRelativePath);
}

function buildSummary(items) {
  const newFilesFound = items.length;
  const filesWithMatches = items.filter((item) => item.matchCount > 0).length;
  const totalDestinationMatchesToArchive = items.reduce(
    (total, item) => total + item.matchCount,
    0
  );
  const newBytesToCopy = items.reduce(
    (total, item) => total + item.sourceSizeBytes,
    0
  );
  const oldBytesToArchive = items.reduce(
    (total, item) =>
      total +
      item.matches.reduce((matchTotal, match) => matchTotal + match.sizeBytes, 0),
    0
  );

  return {
    newFilesFound,
    filesWithMatches,
    filesWithoutMatches: newFilesFound - filesWithMatches,
    totalDestinationMatchesToArchive,
    multiMatchFiles: items.filter((item) => item.matchCount > 1).length,
    newBytesToCopy,
    oldBytesToArchive,
    netActiveFileDelta: newFilesFound - totalDestinationMatchesToArchive,
    netActiveBytesDelta: newBytesToCopy - oldBytesToArchive,
    potentialBytesReclaimableIfArchiveDeleted: oldBytesToArchive,
  };
}

function addDuplicateSourceWarnings(items) {
  const fileNameCounts = new Map();

  for (const item of items) {
    fileNameCounts.set(item.fileName, (fileNameCounts.get(item.fileName) || 0) + 1);
  }

  for (const item of items) {
    if (fileNameCounts.get(item.fileName) <= 1) continue;

    item.action = "blocked_duplicate_source_filename";
    item.status = "blocked";
    item.warnings.push(
      "Multiple new source files have this filename. Resolve duplicates before executing this item."
    );
  }
}

async function createMigrationPlan({ newEditedDir, destinationRoot, archiveRoot }) {
  const migrationId = createMigrationId();
  const archiveRunDir = path.join(archiveRoot, migrationId);
  const sourceResult = await collectVideoFiles({ rootDir: newEditedDir, archiveRoot });
  const destinationResult = await collectVideoFiles({
    rootDir: destinationRoot,
    archiveRoot,
  });
  const destinationByFileName = new Map();

  for (const destinationFile of destinationResult.files) {
    const files = destinationByFileName.get(destinationFile.fileName) || [];
    files.push(destinationFile);
    destinationByFileName.set(destinationFile.fileName, files);
  }

  const items = sourceResult.files
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((sourceFile) => {
      const matches = (destinationByFileName.get(sourceFile.fileName) || [])
        .sort((left, right) => left.path.localeCompare(right.path))
        .map((destinationFile) => {
          const originalRelativePath = getDestinationRelativePath({
            destinationRoot,
            filePath: destinationFile.path,
          });
          const archiveRelativePath = getArchiveRelativePath(originalRelativePath);

          return {
            originalPath: destinationFile.path,
            originalRelativePath,
            archivePath: path.join(archiveRunDir, archiveRelativePath),
            archiveRelativePath,
            sizeBytes: destinationFile.sizeBytes,
            modifiedAt: destinationFile.modifiedAt,
            createdAt: destinationFile.createdAt,
          };
        });

      return {
        fileName: sourceFile.fileName,
        sourcePath: sourceFile.path,
        finalDestinationPath: path.join(destinationRoot, sourceFile.fileName),
        sourceSizeBytes: sourceFile.sizeBytes,
        matches,
        matchCount: matches.length,
        action:
          matches.length > 0
            ? "copy_new_flat_and_archive_matches"
            : "copy_new_flat",
        status: "planned",
        warnings: [],
      };
    });

  addDuplicateSourceWarnings(items);

  const warnings = [...sourceResult.warnings, ...destinationResult.warnings];

  return {
    migrationId,
    status: "planned",
    createdAt: nowIsoString(),
    newEditedDir,
    destinationRoot,
    archiveRoot,
    archiveRunDir,
    summary: buildSummary(items),
    items,
    warnings,
  };
}

async function scanMigration(body) {
  const validation = await validateScanRequest(body);

  if (!validation.ok) {
    return validation;
  }

  const plan = await createMigrationPlan(validation);

  return {
    ok: true,
    plan,
  };
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2));
}

async function appendOperationLog(operationLogPath, message) {
  await fs.appendFile(operationLogPath, `[${nowIsoString()}] ${message}\n`);
}

async function verifyFileSize({ filePath, expectedSize }) {
  const stat = await fs.stat(filePath);

  return stat.isFile() && stat.size === expectedSize;
}

function createArchiveCollisionPath(filePath, seed) {
  const parsed = path.parse(filePath);
  const hash = crypto.createHash("sha256").update(seed).digest("hex").slice(0, 10);

  return path.join(parsed.dir, `${parsed.name}--${hash}${parsed.ext}`);
}

async function getAvailableArchivePath(filePath, seed) {
  if (!(await pathExists(filePath))) {
    return filePath;
  }

  const collisionPath = createArchiveCollisionPath(filePath, seed);

  if (!(await pathExists(collisionPath))) {
    return collisionPath;
  }

  for (let index = 2; index < 1000; index++) {
    const parsed = path.parse(collisionPath);
    const candidate = path.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`);

    if (!(await pathExists(candidate))) {
      return candidate;
    }
  }

  throw new Error(`Unable to allocate archive path for ${filePath}.`);
}

function getArchiveRelativePathFromAbsolute(archivePath) {
  const marker = `${path.sep}archived-files${path.sep}`;
  const index = archivePath.indexOf(marker);

  if (index === -1) {
    return path.basename(archivePath);
  }

  return archivePath.slice(index + 1);
}

function serializeProgress({ plan, manifest, phase, currentFile, message }) {
  return {
    migrationId: plan.migrationId,
    status: "running",
    phase,
    totalFiles: plan.items.length,
    processedFiles:
      manifest.summary.filesCopiedToDestination +
      manifest.summary.failedItems,
    copiedCount: manifest.summary.filesCopiedToDestination,
    archivedCount: manifest.summary.destinationMatchesArchived,
    failedCount: manifest.summary.failedItems,
    currentFile,
    message,
  };
}

function emitProgress(onProgress, update) {
  if (typeof onProgress !== "function") return;
  onProgress(update);
}

function createManifest(plan) {
  return {
    schemaVersion: 1,
    runId: plan.migrationId,
    createdAt: plan.createdAt,
    startedAt: nowIsoString(),
    completedAt: null,
    mode: "flat-copy-new-and-archive-existing-matches",
    newEditedDir: plan.newEditedDir,
    destinationRoot: plan.destinationRoot,
    archiveRoot: plan.archiveRoot,
    archiveRunDir: plan.archiveRunDir,
    summary: {
      newFilesFound: plan.summary.newFilesFound,
      filesCopiedToDestination: 0,
      destinationMatchesArchived: 0,
      filesWithNoMatches: plan.summary.filesWithoutMatches,
      multiMatchFiles: plan.summary.multiMatchFiles,
      failedItems: 0,
      newBytesCopied: 0,
      oldBytesArchived: 0,
      netActiveFileDelta: plan.summary.netActiveFileDelta,
      netActiveBytesDelta: plan.summary.netActiveBytesDelta,
      potentialBytesReclaimableIfArchiveDeleted:
        plan.summary.potentialBytesReclaimableIfArchiveDeleted,
    },
    warnings: plan.warnings,
    items: [],
  };
}

async function ensureSourceStillMatchesPlan(item) {
  const stat = await fs.lstat(item.sourcePath);

  if (stat.isSymbolicLink()) {
    throw new Error("Source file is a symlink and will not be copied.");
  }

  if (!stat.isFile()) {
    throw new Error("Source path no longer points to a file.");
  }

  if (stat.size !== item.sourceSizeBytes) {
    throw new Error("Source file size changed after the scan plan was created.");
  }
}

async function archiveMatches({ manifestItem, operationLogPath }) {
  let archivedCount = 0;
  let archivedBytes = 0;
  const errors = [];

  for (const match of manifestItem.archivedMatches) {
    try {
      const stat = await fs.lstat(match.originalPath);

      if (stat.isSymbolicLink()) {
        manifestItem.warnings.push(`Skipped symlink destination match: ${match.originalPath}`);
        continue;
      }

      if (!stat.isFile()) {
        manifestItem.warnings.push(`Skipped non-file destination match: ${match.originalPath}`);
        continue;
      }

      const archivePath = await getAvailableArchivePath(
        match.archivePath,
        match.originalPath
      );

      match.archivePath = archivePath;
      match.archiveRelativePath = getArchiveRelativePathFromAbsolute(archivePath);

      await fs.mkdir(path.dirname(archivePath), { recursive: true });
      await appendOperationLog(
        operationLogPath,
        `Archiving ${match.originalPath} -> ${archivePath}`
      );
      await fs.rename(match.originalPath, archivePath);
      match.archived = true;
      archivedCount += 1;
      archivedBytes += stat.size;
    } catch (error) {
      if (error.code === "ENOENT") {
        manifestItem.warnings.push(`Old destination match was already missing: ${match.originalPath}`);
        continue;
      }

      match.error = error.message;
      errors.push(`${match.originalPath}: ${error.message}`);
      await appendOperationLog(
        operationLogPath,
        `Failed to archive ${match.originalPath}: ${error.message}`
      );
    }
  }

  return { archivedCount, archivedBytes, errors };
}

async function safeRemoveTempFile(tempPath, operationLogPath) {
  try {
    await fs.unlink(tempPath);
    await appendOperationLog(operationLogPath, `Removed temp file ${tempPath}`);
  } catch {
    // Best effort only. A leftover temp file is safer than touching source data.
  }
}

async function executeMigration(plan, { onProgress } = {}) {
  await fs.mkdir(plan.archiveRoot, { recursive: true });
  await fs.mkdir(plan.archiveRunDir, { recursive: false });
  const archivedFilesDir = path.join(plan.archiveRunDir, "archived-files");
  const tempRunDir = path.join(
    plan.destinationRoot,
    ".video-audit-temp",
    plan.migrationId
  );
  const manifestInProgressPath = path.join(
    plan.archiveRunDir,
    "manifest.in-progress.json"
  );
  const manifestPath = path.join(plan.archiveRunDir, "manifest.json");
  const operationLogPath = path.join(plan.archiveRunDir, "operation.log");
  const manifest = createManifest(plan);

  await fs.mkdir(archivedFilesDir, { recursive: true });
  await fs.mkdir(tempRunDir, { recursive: true });
  await appendOperationLog(operationLogPath, `Started migration ${plan.migrationId}`);
  await writeJson(manifestInProgressPath, manifest);

  for (const item of plan.items) {
    const manifestItem = {
      fileName: item.fileName,
      sourcePath: item.sourcePath,
      tempDestinationPath: path.join(tempRunDir, item.fileName),
      finalDestinationPath: item.finalDestinationPath,
      status: "running",
      phase: "copying_temp",
      sourceSizeBytes: item.sourceSizeBytes,
      finalSizeBytes: null,
      verified: false,
      verificationMethod: "size",
      archivedMatches: item.matches.map((match) => ({ ...match })),
      warnings: [...item.warnings],
      error: null,
    };

    manifest.items.push(manifestItem);
    emitProgress(
      onProgress,
      serializeProgress({
        plan,
        manifest,
        phase: "copying_temp",
        currentFile: item.fileName,
        message: "Copying new file to a verified temp location...",
      })
    );
    await writeJson(manifestInProgressPath, manifest);

    try {
      if (item.status === "blocked") {
        throw new Error("Item is blocked by scan warnings and was not modified.");
      }

      await ensureSourceStillMatchesPlan(item);
      await fs.copyFile(item.sourcePath, manifestItem.tempDestinationPath);
      const tempVerified = await verifyFileSize({
        filePath: manifestItem.tempDestinationPath,
        expectedSize: item.sourceSizeBytes,
      });

      if (!tempVerified) {
        throw new Error("Temp copy size verification failed.");
      }

      manifestItem.verified = true;
      manifestItem.phase = "archiving_matches";
      await appendOperationLog(
        operationLogPath,
        `Verified temp copy for ${item.sourcePath}`
      );
      emitProgress(
        onProgress,
        serializeProgress({
          plan,
          manifest,
          phase: "archiving_matches",
          currentFile: item.fileName,
          message: "Archiving matching old destination files...",
        })
      );
      await writeJson(manifestInProgressPath, manifest);

      const archiveResult = await archiveMatches({ manifestItem, operationLogPath });
      manifest.summary.destinationMatchesArchived += archiveResult.archivedCount;
      manifest.summary.oldBytesArchived += archiveResult.archivedBytes;

      if (archiveResult.errors.length > 0) {
        throw new Error(
          `Unable to archive all destination matches: ${archiveResult.errors.join("; ")}`
        );
      }

      manifestItem.phase = "finalizing_destination";
      emitProgress(
        onProgress,
        serializeProgress({
          plan,
          manifest,
          phase: "finalizing_destination",
          currentFile: item.fileName,
          message: "Moving verified temp file into the flat destination...",
        })
      );

      if (await pathExists(manifestItem.finalDestinationPath)) {
        throw new Error(
          "Final destination still exists after archiving planned matches. Refusing to overwrite it."
        );
      }

      await appendOperationLog(
        operationLogPath,
        `Finalizing ${manifestItem.tempDestinationPath} -> ${manifestItem.finalDestinationPath}`
      );
      await fs.rename(
        manifestItem.tempDestinationPath,
        manifestItem.finalDestinationPath
      );

      const finalStat = await fs.stat(manifestItem.finalDestinationPath);

      if (!finalStat.isFile() || finalStat.size !== item.sourceSizeBytes) {
        throw new Error("Final destination size verification failed.");
      }

      manifestItem.status = "success";
      manifestItem.phase = "complete";
      manifestItem.finalSizeBytes = finalStat.size;
      manifest.summary.filesCopiedToDestination += 1;
      manifest.summary.newBytesCopied += finalStat.size;
      await appendOperationLog(
        operationLogPath,
        `Completed ${item.fileName} (${finalStat.size} bytes)`
      );
    } catch (error) {
      manifestItem.status = "failed";
      manifestItem.phase = "error";
      manifestItem.error = error.message;
      manifest.summary.failedItems += 1;

      const archivedAnyMatch = manifestItem.archivedMatches.some(
        (match) => match.archived
      );

      if (
        !archivedAnyMatch &&
        manifestItem.phase !== "complete" &&
        (await pathExists(manifestItem.tempDestinationPath))
      ) {
        await safeRemoveTempFile(manifestItem.tempDestinationPath, operationLogPath);
      }

      await appendOperationLog(
        operationLogPath,
        `Failed ${item.fileName}: ${error.message}`
      );
    }

    emitProgress(
      onProgress,
      serializeProgress({
        plan,
        manifest,
        phase: manifestItem.phase,
        currentFile: item.fileName,
        message:
          manifestItem.status === "success"
            ? "Migration item complete."
            : "Migration item failed.",
      })
    );
    await writeJson(manifestInProgressPath, manifest);
  }

  manifest.completedAt = nowIsoString();
  await writeJson(manifestInProgressPath, manifest);
  await fs.rename(manifestInProgressPath, manifestPath);
  await appendOperationLog(operationLogPath, `Completed migration ${plan.migrationId}`);

  emitProgress(onProgress, {
    migrationId: plan.migrationId,
    status: "complete",
    phase: "complete",
    totalFiles: plan.items.length,
    processedFiles: plan.items.length,
    copiedCount: manifest.summary.filesCopiedToDestination,
    archivedCount: manifest.summary.destinationMatchesArchived,
    failedCount: manifest.summary.failedItems,
    currentFile: "",
    message: "Migration complete.",
  });

  return {
    ...manifest,
    manifestPath,
    operationLogPath,
  };
}

module.exports = {
  VIDEO_EXTENSIONS,
  executeMigration,
  scanMigration,
};
