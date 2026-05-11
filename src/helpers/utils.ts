import type {
  AuditProgress,
  AuditProgressPayload,
  FolderPathManifestItem,
  StoredVideoData,
  VideoRow,
  VideoSource,
} from '../types/video'

const storageKey = 'video-audit:videos:v1'
const videoExtensions = new Set(['.mp4', '.m4v', '.mov'])

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
})

export const formatNumber = (value: number | null, maximumFractionDigits = 2) =>
  value === null
    ? ''
    : value.toLocaleString(undefined, { maximumFractionDigits })

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

  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
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

export const getAuditPercent = (auditProgress: AuditProgress) =>
  auditProgress.totalFiles && auditProgress.totalFiles > 0
    ? Math.round(
        (auditProgress.processedFiles / auditProgress.totalFiles) * 100,
      )
    : null
