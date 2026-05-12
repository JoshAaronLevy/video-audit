export type MigrationScanRequest = {
  newEditedDir: string
  destinationRoot: string
  archiveRoot?: string
}

export type MigrationScanSummary = {
  newFilesFound: number
  filesWithMatches: number
  filesWithoutMatches: number
  totalDestinationMatchesToArchive: number
  multiMatchFiles: number
  newBytesToCopy: number
  oldBytesToArchive: number
  netActiveFileDelta: number
  netActiveBytesDelta: number
  potentialBytesReclaimableIfArchiveDeleted: number
}

export type MigrationMatch = {
  originalPath: string
  originalRelativePath: string
  archivePath: string
  archiveRelativePath: string
  sizeBytes: number
  modifiedAt?: string
  createdAt?: string
}

export type MigrationScanItem = {
  fileName: string
  sourcePath: string
  finalDestinationPath: string
  sourceSizeBytes: number
  matchCount: number
  matches: MigrationMatch[]
  action: string
  status: 'planned' | 'blocked' | string
  warnings: string[]
}

export type MigrationScanResponse = {
  migrationId: string
  status: 'planned' | string
  newEditedDir: string
  destinationRoot: string
  archiveRoot: string
  archiveRunDir: string
  summary: MigrationScanSummary
  items: MigrationScanItem[]
  warnings: string[]
}

export type MigrationExecuteRequest = {
  migrationId: string
}

export type MigrationProgressPayload = {
  migrationId: string
  status: 'idle' | 'starting' | 'running' | 'complete' | 'error' | string
  phase: string | null
  totalFiles: number | null
  processedFiles: number
  copiedCount: number
  archivedCount: number
  failedCount: number
  currentFile?: string | null
  message?: string | null
  error?: string | null
}

export type MigrationProgress = {
  migrationId: string | null
  status: 'idle' | 'starting' | 'running' | 'complete' | 'error'
  phase: string | null
  totalFiles: number | null
  processedFiles: number
  copiedCount: number
  archivedCount: number
  failedCount: number
  currentFile: string | null
  message: string | null
  error: string | null
}

export type MigrationResultMatch = {
  originalPath: string
  archivePath: string
  sizeBytes: number
}

export type MigrationResultItem = {
  fileName: string
  sourcePath: string
  finalDestinationPath: string
  status: 'success' | 'failed' | 'skipped' | string
  archivedMatches: MigrationResultMatch[]
  error?: string | null
  warnings?: string[]
}

export type MigrationResult = {
  migrationId: string
  status: 'complete' | 'error' | string
  archiveRunDir?: string
  manifestPath?: string
  operationLogPath?: string
  summary: {
    newFilesFound: number
    filesCopiedToDestination: number
    destinationMatchesArchived: number
    filesWithNoMatches: number
    multiMatchFiles: number
    failedItems: number
    newBytesCopied: number
    oldBytesArchived: number
    netActiveFileDelta: number
    netActiveBytesDelta: number
    potentialBytesReclaimableIfArchiveDeleted: number
  }
  items: MigrationResultItem[]
}
