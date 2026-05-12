import type {
  AuditProgress,
  AuditProgressPayload,
  AutoCropProgress,
  AutoCropProgressPayload,
  BlackBorderAdjustment,
  FolderPathManifestItem,
  StoredVideoData,
  VideoAdjustments,
  VideoRow,
  VideoSource,
  VideoStatus,
} from '../types/video'
import type {
  MigrationProgress,
  MigrationProgressPayload,
} from '../types/migration'

const storageKey = 'video-audit:videos:v1'
const videoExtensions = new Set(['.mp4', '.mov', '.m4v', '.mkv', '.avi', '.webm'])
const videoStatuses = new Set<VideoStatus>([
  'Pending',
  'Queued',
  'Completed',
  'Dismissed',
])

export const apiBaseUrl = 'http://127.0.0.1:3001'

export const initialAuditProgress: AuditProgress = {
  jobId: null,
  status: 'idle',
  phase: null,
  resolvedDirectory: null,
  totalFiles: null,
  processedFiles: 0,
  flaggedCount: 0,
  errorCount: 0,
  currentFile: null,
  message: null,
}

export const initialAutoCropProgress: AutoCropProgress = {
  jobId: null,
  status: 'idle',
  phase: null,
  outputRootDir: null,
  outputDir: null,
  totalFiles: null,
  processedFiles: 0,
  succeededCount: 0,
  skippedCount: 0,
  errorCount: 0,
  currentFile: null,
  message: null,
}

export const initialMigrationProgress: MigrationProgress = {
  migrationId: null,
  status: 'idle',
  phase: null,
  totalFiles: null,
  processedFiles: 0,
  copiedCount: 0,
  archivedCount: 0,
  failedCount: 0,
  currentFile: null,
  message: null,
  error: null,
}

export const globalFilterFields: Array<keyof VideoRow> = ['fileName']

const readString = (source: VideoSource, key: keyof VideoRow) => {
  const value = source[key]
  return typeof value === 'string' ? value : ''
}

const readNumber = (source: VideoSource, key: keyof VideoRow) => {
  const value = source[key]

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsedValue = Number(value)
    return Number.isFinite(parsedValue) ? parsedValue : null
  }

  return null
}

const readBoolean = (source: VideoSource, key: keyof VideoRow) => {
  const value = source[key]
  if (value === 'true') {
    return true
  }

  if (value === 'false') {
    return false
  }

  return typeof value === 'boolean' ? value : Boolean(value)
}

const readVideoStatus = (source: VideoSource): VideoStatus => {
  const value = source.status

  return typeof value === 'string' && videoStatuses.has(value as VideoStatus)
    ? (value as VideoStatus)
    : 'Pending'
}

const readAdjustments = (source: VideoSource): VideoAdjustments | undefined => {
  const value = source.adjustments

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  return value as VideoAdjustments
}

const getPathAfterEdited = (path: string) => {
  const pathParts = path.split(/[\\/]+/)
  const editedIndex = pathParts.findIndex((part) => part === 'Edited')

  if (editedIndex >= 0 && editedIndex < pathParts.length - 1) {
    return pathParts.slice(editedIndex + 1).join('/')
  }

  return ''
}

const getDisplayFile = (
  path: string,
  fileName: string,
  existingDisplayFile = '',
) => {
  const pathAfterEdited = getPathAfterEdited(path)

  if (pathAfterEdited) {
    return pathAfterEdited
  }

  return fileName || existingDisplayFile || path || 'Untitled video'
}

const getDisplayDirectory = (path: string, directory: string) => {
  const pathAfterEdited = getPathAfterEdited(path)

  if (pathAfterEdited) {
    const pathParts = pathAfterEdited.split('/')
    return pathParts.slice(0, -1).join('/')
  }

  return directory
}

export const getRowDisplayFile = (row: VideoRow) =>
  getDisplayFile(row.path, row.fileName, row.displayFile)

const getFileNameFromPath = (value: string) =>
  value.split(/[\\/]+/).filter(Boolean).at(-1) ?? value

const removeFinalExtension = (fileName: string) => {
  const extensionIndex = fileName.lastIndexOf('.')

  if (extensionIndex <= 0) {
    return fileName
  }

  return fileName.slice(0, extensionIndex)
}

export const getRowDisplayFileName = (row: VideoRow) => {
  const fileName =
    row.fileName ||
    getFileNameFromPath(row.displayFile) ||
    getFileNameFromPath(row.path) ||
    'Untitled video'
  const displayFileName = removeFinalExtension(fileName)

  return row.displayDirectory ? `../${displayFileName}` : displayFileName
}

export const toVideoRow = (source: VideoSource): VideoRow => ({
  displayFile: getDisplayFile(
    readString(source, 'path'),
    readString(source, 'fileName'),
    readString(source, 'displayFile'),
  ),
  displayDirectory: getDisplayDirectory(
    readString(source, 'path'),
    readString(source, 'directory'),
  ),
  path: readString(source, 'path'),
  directory: readString(source, 'directory'),
  fileName: readString(source, 'fileName'),
  extension: readString(source, 'extension'),
  sizeBytes: readNumber(source, 'sizeBytes'),
  sizeMB: readNumber(source, 'sizeMB'),
  sizeGB: readNumber(source, 'sizeGB'),
  fileSystemSizeBytes: readNumber(source, 'fileSystemSizeBytes'),
  ffprobeFormatSizeBytes: readNumber(source, 'ffprobeFormatSizeBytes'),
  createdAt: readString(source, 'createdAt'),
  modifiedAt: readString(source, 'modifiedAt'),
  durationSeconds: readNumber(source, 'durationSeconds'),
  width: readNumber(source, 'width'),
  height: readNumber(source, 'height'),
  displayAspectRatio: readString(source, 'displayAspectRatio'),
  bitRateMbps: readNumber(source, 'bitRateMbps'),
  frameRate: readNumber(source, 'frameRate'),
  isLowResolution: readBoolean(source, 'isLowResolution'),
  isWrongAspectRatio: readBoolean(source, 'isWrongAspectRatio'),
  reasons: readString(source, 'reasons'),
  status: readVideoStatus(source),
  adjustments: readAdjustments(source),
})

const getBlackBorder = (row: VideoRow): BlackBorderAdjustment | undefined =>
  row.adjustments?.blackBorder

export const isAutoCropCandidate = (row: VideoRow): boolean => {
  const blackBorder = getBlackBorder(row)

  return (
    blackBorder?.classification === 'nested_borders' &&
    blackBorder.confidence === 'high' &&
    blackBorder.recommendedFix?.eligible === true
  )
}

export const getBlackBorderLabel = (row: VideoRow): string => {
  const blackBorder = getBlackBorder(row)

  if (!blackBorder?.analyzed) {
    return 'Not scanned'
  }

  switch (blackBorder.classification) {
    case 'clean':
      return 'Clean'
    case 'pillarboxed':
      return 'Pillarbox'
    case 'letterboxed':
      return 'Letterbox'
    case 'nested_borders':
      return blackBorder.confidence === 'high' ? 'Nested' : 'Nested review'
    case 'asymmetric_border':
      return 'Manual review'
    case 'uncertain':
      return 'Uncertain'
    case 'analysis_error':
      return 'Error'
  }
}

export const getBlackBorderSeverity = (
  row: VideoRow,
): 'success' | 'info' | 'warn' | 'danger' | 'secondary' => {
  const blackBorder = getBlackBorder(row)

  if (!blackBorder?.analyzed) {
    return 'secondary'
  }

  if (isAutoCropCandidate(row)) {
    return 'danger'
  }

  switch (blackBorder.classification) {
    case 'clean':
      return 'success'
    case 'pillarboxed':
    case 'letterboxed':
      return 'info'
    case 'nested_borders':
    case 'asymmetric_border':
    case 'uncertain':
      return 'warn'
    case 'analysis_error':
      return 'danger'
  }
}

export const getAutoCropSkipReason = (row: VideoRow): string | null => {
  if (isAutoCropCandidate(row)) {
    return null
  }

  const blackBorder = getBlackBorder(row)

  if (!blackBorder?.analyzed) {
    return 'not analyzed'
  }

  if (blackBorder.classification === 'analysis_error') {
    return 'analysis error'
  }

  if (blackBorder.classification !== 'nested_borders') {
    return 'not nested borders'
  }

  if (blackBorder.confidence !== 'high') {
    return 'low/medium confidence'
  }

  return 'not eligible'
}

export const formatNumber = (value: number | null, maximumFractionDigits = 2) =>
  value === null
    ? ''
    : value.toLocaleString(undefined, { maximumFractionDigits })

export const formatBytes = (value: number | null | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '0 B'
  }

  const absoluteValue = Math.abs(value)
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let unitIndex = 0
  let displayValue = absoluteValue

  while (displayValue >= 1024 && unitIndex < units.length - 1) {
    displayValue /= 1024
    unitIndex += 1
  }

  const maximumFractionDigits = unitIndex === 0 ? 0 : displayValue >= 10 ? 1 : 2
  const formatted = displayValue.toLocaleString(undefined, {
    maximumFractionDigits,
  })

  return `${formatted} ${units[unitIndex]}`
}

export const formatSignedBytes = (value: number | null | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value === 0) {
    return formatBytes(0)
  }

  return `${value > 0 ? '+' : '-'}${formatBytes(Math.abs(value))}`
}

export const formatSignedInteger = (value: number | null | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '0'
  }

  if (value === 0) {
    return '0'
  }

  return `${value > 0 ? '+' : ''}${value.toLocaleString()}`
}

export const formatProgressNumber = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString()
    : '0'

export const formatDuration = (value: number | null) => {
  if (value === null) {
    return ''
  }

  const totalSeconds = Math.round(value)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export const formatDate = (value: string) => {
  if (!value) {
    return ''
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

export const loadStoredVideoData = (): StoredVideoData | null => {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const rawValue = window.localStorage.getItem(storageKey)

    if (!rawValue) {
      return null
    }

    const storedValue: unknown = JSON.parse(rawValue)

    if (
      !storedValue ||
      typeof storedValue !== 'object' ||
      Array.isArray(storedValue)
    ) {
      throw new Error('Saved video data is not valid.')
    }

    const storedSource = storedValue as {
      fileName?: unknown
      payload?: unknown
      rows?: unknown
    }

    if (!Array.isArray(storedSource.rows)) {
      throw new Error('Saved video rows are not valid.')
    }

    const rows = storedSource.rows.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new Error('A saved video row is not valid.')
      }

      return toVideoRow(item as VideoSource)
    })

    return {
      fileName:
        typeof storedSource.fileName === 'string' ? storedSource.fileName : null,
      payload:
        typeof storedSource.payload === 'string' ? storedSource.payload : null,
      rows,
    }
  } catch {
    window.localStorage.removeItem(storageKey)
    return null
  }
}

export const saveVideoData = (data: StoredVideoData) => {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(data))
    return true
  } catch {
    return false
  }
}

export const clearStoredVideoData = () => {
  try {
    window.localStorage.removeItem(storageKey)
  } catch {
    // localStorage can fail in private browsing modes; clearing app state still works.
  }
}

const isVideoLikeFile = (file: File) => {
  const lowerName = file.name.toLowerCase()
  return Array.from(videoExtensions).some((extension) =>
    lowerName.endsWith(extension),
  )
}

export const toFolderPathManifest = (
  fileList: FileList | null,
): FolderPathManifestItem[] => {
  const selectedFiles = Array.from(fileList ?? [])

  return selectedFiles
    .filter(isVideoLikeFile)
    .filter((file) => !file.name.startsWith('._'))
    .map((file) => {
      const relativePath = file.webkitRelativePath || file.name
      const parts = relativePath.split('/').filter(Boolean)
      const rootPath = parts.length > 1 ? parts[0] : null

      return {
        fileName: file.name,
        rootPath,
        relativePath,
      }
    })
}

export const mergeAuditProgress = (
  currentProgress: AuditProgress,
  payload: AuditProgressPayload,
  status: AuditProgress['status'] = 'running',
): AuditProgress => ({
  ...currentProgress,
  jobId: payload.jobId ?? currentProgress.jobId,
  status,
  phase: payload.phase ?? currentProgress.phase,
  resolvedDirectory:
    payload.resolvedDirectory ?? currentProgress.resolvedDirectory,
  totalFiles:
    typeof payload.totalFiles === 'number'
      ? payload.totalFiles
      : currentProgress.totalFiles,
  processedFiles:
    typeof payload.processedFiles === 'number'
      ? payload.processedFiles
      : currentProgress.processedFiles,
  flaggedCount:
    typeof payload.flaggedCount === 'number'
      ? payload.flaggedCount
      : currentProgress.flaggedCount,
  errorCount:
    typeof payload.errorCount === 'number'
      ? payload.errorCount
      : currentProgress.errorCount,
  currentFile: payload.currentFile ?? currentProgress.currentFile,
  message: payload.message ?? currentProgress.message,
})

export const mergeAutoCropProgress = (
  currentProgress: AutoCropProgress,
  payload: AutoCropProgressPayload,
  status: AutoCropProgress['status'] = 'running',
): AutoCropProgress => ({
  ...currentProgress,
  jobId: payload.jobId ?? currentProgress.jobId,
  status,
  phase: payload.phase ?? currentProgress.phase,
  outputRootDir: payload.outputRootDir ?? currentProgress.outputRootDir,
  outputDir: payload.outputDir ?? currentProgress.outputDir,
  totalFiles:
    typeof payload.totalFiles === 'number'
      ? payload.totalFiles
      : currentProgress.totalFiles,
  processedFiles:
    typeof payload.processedFiles === 'number'
      ? payload.processedFiles
      : currentProgress.processedFiles,
  succeededCount:
    typeof payload.succeededCount === 'number'
      ? payload.succeededCount
      : currentProgress.succeededCount,
  skippedCount:
    typeof payload.skippedCount === 'number'
      ? payload.skippedCount
      : currentProgress.skippedCount,
  errorCount:
    typeof payload.errorCount === 'number'
      ? payload.errorCount
      : currentProgress.errorCount,
  currentFile: payload.currentFile ?? currentProgress.currentFile,
  message: payload.message ?? currentProgress.message,
})

export const mergeMigrationProgress = (
  currentProgress: MigrationProgress,
  payload: Partial<MigrationProgressPayload>,
  status: MigrationProgress['status'] = 'running',
): MigrationProgress => ({
  ...currentProgress,
  migrationId: payload.migrationId ?? currentProgress.migrationId,
  status,
  phase: payload.phase ?? currentProgress.phase,
  totalFiles:
    typeof payload.totalFiles === 'number'
      ? payload.totalFiles
      : currentProgress.totalFiles,
  processedFiles:
    typeof payload.processedFiles === 'number'
      ? payload.processedFiles
      : currentProgress.processedFiles,
  copiedCount:
    typeof payload.copiedCount === 'number'
      ? payload.copiedCount
      : currentProgress.copiedCount,
  archivedCount:
    typeof payload.archivedCount === 'number'
      ? payload.archivedCount
      : currentProgress.archivedCount,
  failedCount:
    typeof payload.failedCount === 'number'
      ? payload.failedCount
      : currentProgress.failedCount,
  currentFile: payload.currentFile ?? currentProgress.currentFile,
  message: payload.message ?? currentProgress.message,
  error: payload.error ?? currentProgress.error,
})

export const getAuditPercent = (auditProgress: AuditProgress) =>
  auditProgress.totalFiles && auditProgress.totalFiles > 0
    ? Math.round(
        (auditProgress.processedFiles / auditProgress.totalFiles) * 100,
      )
    : null

export const getAutoCropPercent = (autoCropProgress: AutoCropProgress) =>
  autoCropProgress.totalFiles && autoCropProgress.totalFiles > 0
    ? Math.round(
        (autoCropProgress.processedFiles / autoCropProgress.totalFiles) * 100,
      )
    : null

export const getMigrationPercent = (migrationProgress: MigrationProgress) =>
  migrationProgress.totalFiles && migrationProgress.totalFiles > 0
    ? Math.round(
        (migrationProgress.processedFiles / migrationProgress.totalFiles) * 100,
      )
    : null
