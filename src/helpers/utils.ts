import type {
  AuditProgress,
  AuditProgressPayload,
  AutoCropProgress,
  AutoCropProgressPayload,
  BlackBorderAdjustment,
  DefaultRootStatusResponse,
  FolderPathManifestItem,
  FolderTreeCache,
  FolderTreeResponse,
  SelectedFileManifestItem,
  StoredVideoData,
  ThumbnailProgress,
  ThumbnailProgressPayload,
  VideoAdjustments,
  VideoRow,
  VideoSource,
  VideoStatus,
  VideoThumbnail,
} from '../types/video'
import type {
  MigrationProgress,
  MigrationProgressPayload,
} from '../types/migration'

const storageKey = 'video-audit:videos:v1'
const indexedDbName = 'video-audit'
const indexedDbVersion = 2
const indexedDbStoreName = 'snapshots'
const indexedDbSnapshotKey = 'latest'
const folderTreeStoreName = 'folderTreeCache'
const videoExtensions = new Set([
  '.mp4',
  '.mov',
  '.m4v',
  '.mkv',
  '.avi',
  '.wmv',
  '.webm',
  '.mpeg',
  '.mpg',
  '.m2ts',
  '.ts',
])
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

export const initialThumbnailProgress: ThumbnailProgress = {
  jobId: null,
  status: 'idle',
  phase: null,
  totalVideos: null,
  processedVideos: 0,
  generatedCount: 0,
  cachedCount: 0,
  failedCount: 0,
  currentFile: null,
  message: null,
}

export const globalFilterFields: Array<keyof VideoRow> = ['fileName']

export const defaultVideoRootPath = '/Volumes/SanDisk SSD/Videos/Edited'

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

const readThumbnail = (source: VideoSource): VideoThumbnail | undefined => {
  const value = source.thumbnail

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  return value as VideoThumbnail
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

  return existingDisplayFile || fileName || path || 'Untitled video'
}

const getDisplayDirectory = (
  path: string,
  directory: string,
  existingDisplayDirectory = '',
) => {
  const pathAfterEdited = getPathAfterEdited(path)

  if (pathAfterEdited) {
    const pathParts = pathAfterEdited.split('/')
    return pathParts.slice(0, -1).join('/')
  }

  return existingDisplayDirectory || directory
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
    readString(source, 'displayDirectory'),
  ),
  path: readString(source, 'path'),
  directory: readString(source, 'directory'),
  fileName: readString(source, 'fileName'),
  extension: readString(source, 'extension'),
  fileExtension:
    readString(source, 'fileExtension') || readString(source, 'extension'),
  fileType:
    readString(source, 'fileType') ||
    (readString(source, 'fileExtension') || readString(source, 'extension'))
      .replace(/^\./, '')
      .toUpperCase(),
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
  thumbnail: readThumbnail(source),
})

const getBlackBorder = (row: VideoRow): BlackBorderAdjustment | undefined =>
  row.adjustments?.blackBorder

const hasVisibleCropArea = (blackBorder: BlackBorderAdjustment): boolean => {
  const visibleArea = blackBorder.visibleArea

  return (
    typeof visibleArea?.width === 'number' &&
    Number.isFinite(visibleArea.width) &&
    visibleArea.width > 0 &&
    typeof visibleArea.height === 'number' &&
    Number.isFinite(visibleArea.height) &&
    visibleArea.height > 0 &&
    typeof visibleArea.x === 'number' &&
    Number.isFinite(visibleArea.x) &&
    visibleArea.x >= 0 &&
    typeof visibleArea.y === 'number' &&
    Number.isFinite(visibleArea.y) &&
    visibleArea.y >= 0
  )
}

export type CropReviewStatus = 'Yes' | 'No' | 'Uncertain' | 'Errored'

export const getBlackBorderCropStatus = (
  adjustments?: VideoAdjustments,
): CropReviewStatus => {
  const blackBorder = adjustments?.blackBorder

  if (!blackBorder?.analyzed) {
    return 'No'
  }

  switch (blackBorder.classification) {
    case 'analysis_error':
      return 'Errored'
    case 'uncertain':
      return 'Uncertain'
    case 'nested_borders':
    case 'asymmetric_border':
    case 'pillarboxed':
    case 'letterboxed':
      return 'Yes'
    case 'clean':
      return 'No'
  }
}

export const isCropReviewCandidate = (row: VideoRow): boolean =>
  getBlackBorderCropStatus(row.adjustments) !== 'No'

export const isBlackBorderAutoCropCandidate = (
  adjustments?: VideoAdjustments,
): boolean => {
  const blackBorder = adjustments?.blackBorder

  return (
    blackBorder?.classification === 'nested_borders' &&
    hasVisibleCropArea(blackBorder)
  )
}

export const isAutoCropCandidate = (row: VideoRow): boolean => {
  return isBlackBorderAutoCropCandidate(row.adjustments)
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

type StoredVideoDataSource = {
  fileName?: unknown
  payload?: unknown
  rows?: unknown
}

const normalizeStoredVideoData = (storedSource: StoredVideoDataSource) => {
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
}

const openVideoAuditDb = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB is not available.'))
      return
    }

    const request = window.indexedDB.open(indexedDbName, indexedDbVersion)

    request.onupgradeneeded = () => {
      const database = request.result

      if (!database.objectStoreNames.contains(indexedDbStoreName)) {
        database.createObjectStore(indexedDbStoreName)
      }

      if (!database.objectStoreNames.contains(folderTreeStoreName)) {
        database.createObjectStore(folderTreeStoreName)
      }
    }

    request.onerror = () => {
      reject(request.error ?? new Error('Unable to open local video storage.'))
    }

    request.onsuccess = () => {
      resolve(request.result)
    }
  })

const readIndexedDbSnapshot = async () => {
  const database = await openVideoAuditDb()

  try {
    return await new Promise<unknown>((resolve, reject) => {
      const transaction = database.transaction(indexedDbStoreName, 'readonly')
      const store = transaction.objectStore(indexedDbStoreName)
      const request = store.get(indexedDbSnapshotKey)

      request.onerror = () => {
        reject(request.error ?? new Error('Unable to read local video storage.'))
      }

      request.onsuccess = () => {
        resolve(request.result)
      }
    })
  } finally {
    database.close()
  }
}

const writeIndexedDbSnapshot = async (data: StoredVideoData) => {
  const database = await openVideoAuditDb()

  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(indexedDbStoreName, 'readwrite')
      const store = transaction.objectStore(indexedDbStoreName)

      store.put(data, indexedDbSnapshotKey)

      transaction.oncomplete = () => {
        resolve()
      }

      transaction.onerror = () => {
        reject(
          transaction.error ?? new Error('Unable to write local video storage.'),
        )
      }

      transaction.onabort = () => {
        reject(
          transaction.error ?? new Error('Unable to write local video storage.'),
        )
      }
    })
  } finally {
    database.close()
  }
}

const clearIndexedDbSnapshot = async () => {
  const database = await openVideoAuditDb()

  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(indexedDbStoreName, 'readwrite')
      const store = transaction.objectStore(indexedDbStoreName)

      store.delete(indexedDbSnapshotKey)

      transaction.oncomplete = () => {
        resolve()
      }

      transaction.onerror = () => {
        reject(
          transaction.error ?? new Error('Unable to clear local video storage.'),
        )
      }

      transaction.onabort = () => {
        reject(
          transaction.error ?? new Error('Unable to clear local video storage.'),
        )
      }
    })
  } finally {
    database.close()
  }
}

export const getFolderTreeCacheKey = (rootPath: string) =>
  `folder-tree::${rootPath || defaultVideoRootPath}`

const isFolderTreeCache = (value: unknown): value is FolderTreeCache => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const candidate = value as Partial<FolderTreeCache>

  return (
    typeof candidate.cacheKey === 'string' &&
    typeof candidate.rootPath === 'string' &&
    typeof candidate.generatedAt === 'string' &&
    typeof candidate.savedAt === 'string' &&
    Array.isArray(candidate.nodes) &&
    Boolean(candidate.summary) &&
    typeof candidate.summary?.folderCount === 'number' &&
    typeof candidate.summary?.videoCount === 'number' &&
    typeof candidate.summary?.totalVideoSizeBytes === 'number'
  )
}

export const loadFolderTreeCache = async (
  rootPath = defaultVideoRootPath,
): Promise<FolderTreeCache | null> => {
  const database = await openVideoAuditDb()
  const cacheKey = getFolderTreeCacheKey(rootPath)

  try {
    const cachedValue = await new Promise<unknown>((resolve, reject) => {
      const transaction = database.transaction(folderTreeStoreName, 'readonly')
      const store = transaction.objectStore(folderTreeStoreName)
      const request = store.get(cacheKey)

      request.onerror = () => {
        reject(request.error ?? new Error('Unable to read folder tree cache.'))
      }

      request.onsuccess = () => {
        resolve(request.result)
      }
    })

    return isFolderTreeCache(cachedValue) ? cachedValue : null
  } finally {
    database.close()
  }
}

export const saveFolderTreeCache = async (
  tree: FolderTreeResponse,
): Promise<FolderTreeCache> => {
  const rootPath = tree.root.path || defaultVideoRootPath
  const cacheKey = getFolderTreeCacheKey(rootPath)
  const cacheValue: FolderTreeCache = {
    cacheKey,
    rootPath,
    generatedAt: tree.generatedAt,
    savedAt: new Date().toISOString(),
    summary: tree.summary,
    supportedVideoExtensions: tree.supportedVideoExtensions,
    nodes: tree.nodes,
    warnings: tree.warnings,
  }
  const database = await openVideoAuditDb()

  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(folderTreeStoreName, 'readwrite')
      const store = transaction.objectStore(folderTreeStoreName)

      store.put(cacheValue, cacheKey)

      transaction.oncomplete = () => {
        resolve()
      }

      transaction.onerror = () => {
        reject(transaction.error ?? new Error('Unable to save folder tree cache.'))
      }

      transaction.onabort = () => {
        reject(transaction.error ?? new Error('Unable to save folder tree cache.'))
      }
    })

    return cacheValue
  } finally {
    database.close()
  }
}

const loadLegacyLocalStorageVideoData = (): StoredVideoData | null => {
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

    return normalizeStoredVideoData(storedValue as StoredVideoDataSource)
  } catch {
    window.localStorage.removeItem(storageKey)
    return null
  }
}

export const loadStoredVideoData = async (): Promise<StoredVideoData | null> => {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const storedValue = await readIndexedDbSnapshot()

    if (storedValue) {
      return normalizeStoredVideoData(storedValue as StoredVideoDataSource)
    }
  } catch {
    // Fall through to the legacy localStorage cache.
  }

  const legacyData = loadLegacyLocalStorageVideoData()

  if (legacyData) {
    void saveVideoData(legacyData)
  }

  return legacyData
}

export const saveVideoData = async (data: StoredVideoData) => {
  try {
    await writeIndexedDbSnapshot(data)
    window.localStorage.removeItem(storageKey)
    return true
  } catch {
    // Fall back to the old localStorage path for browsers without IndexedDB.
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(data))
    return true
  } catch {
    return false
  }
}

export const clearStoredVideoData = async () => {
  await clearIndexedDbSnapshot().catch(() => {
    // Clearing app state should still work if browser storage is unavailable.
  })

  try {
    window.localStorage.removeItem(storageKey)
  } catch {
    // localStorage can fail in private browsing modes; clearing app state still works.
  }
}

export const fetchDefaultRootStatus =
  async (): Promise<DefaultRootStatusResponse> => {
    const response = await fetch(`${apiBaseUrl}/api/folders/default-root`)
    const payload = (await response.json()) as DefaultRootStatusResponse

    if (!response.ok) {
      throw new Error(payload.message || 'Unable to check default video folder.')
    }

    return payload
  }

export const fetchFolderTree = async (
  rootPath = defaultVideoRootPath,
): Promise<FolderTreeResponse> => {
  const query = rootPath ? `?root=${encodeURIComponent(rootPath)}` : ''
  const response = await fetch(`${apiBaseUrl}/api/folders/tree${query}`)
  const payload = (await response.json()) as FolderTreeResponse

  if (!response.ok) {
    throw new Error(payload.message || 'Unable to load folder tree.')
  }

  return payload
}

export const isVideoLikeFile = (file: File) => {
  const lowerName = file.name.toLowerCase()
  return Array.from(videoExtensions).some((extension) =>
    lowerName.endsWith(extension),
  )
}

type FileWithMaybePath = File & {
  path?: string
}

const toSlashPath = (value: string) => value.replace(/\\/g, '/')

const getPathParts = (value: string) =>
  toSlashPath(value).split('/').filter(Boolean)

const isAbsoluteClientPath = (value: string) =>
  value.startsWith('/') || /^[A-Za-z]:\//.test(toSlashPath(value))

const getDirectoryPath = (value: string) => {
  const normalized = toSlashPath(value)
  const lastSlashIndex = normalized.lastIndexOf('/')

  return lastSlashIndex > 0 ? normalized.slice(0, lastSlashIndex) : ''
}

const getCommonDirectoryPath = (filePaths: string[]) => {
  const directoryParts = filePaths.map((filePath) =>
    getPathParts(getDirectoryPath(filePath)),
  )
  const firstParts = directoryParts[0] ?? []
  const commonParts: string[] = []

  for (let index = 0; index < firstParts.length; index += 1) {
    const part = firstParts[index]

    if (directoryParts.every((parts) => parts[index] === part)) {
      commonParts.push(part)
      continue
    }

    break
  }

  if (commonParts.length === 0) {
    return filePaths[0]?.startsWith('/') ? '/' : ''
  }

  return `${filePaths[0]?.startsWith('/') ? '/' : ''}${commonParts.join('/')}`
}

const getRelativeClientPath = (rootPath: string, filePath: string) => {
  const normalizedRoot = toSlashPath(rootPath).replace(/\/+$/, '')
  const normalizedFilePath = toSlashPath(filePath)
  const prefix = normalizedRoot ? `${normalizedRoot}/` : ''

  return prefix && normalizedFilePath.startsWith(prefix)
    ? normalizedFilePath.slice(prefix.length)
    : normalizedFilePath.split('/').filter(Boolean).at(-1) || normalizedFilePath
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

export const toSelectedFilesManifest = (
  fileList: FileList | null,
): SelectedFileManifestItem[] => {
  const selectedFiles = Array.from(fileList ?? [])
    .filter(isVideoLikeFile)
    .filter((file) => !file.name.startsWith('._'))
  const sourcePaths = selectedFiles
    .map((file) => toSlashPath((file as FileWithMaybePath).path ?? ''))
    .filter((value) => value && isAbsoluteClientPath(value))
  const commonRootPath =
    sourcePaths.length === selectedFiles.length && sourcePaths.length > 0
      ? getCommonDirectoryPath(sourcePaths)
      : null

  return selectedFiles.map((file) => {
    const sourcePath = toSlashPath((file as FileWithMaybePath).path ?? '')
    const absoluteSourcePath =
      sourcePath && isAbsoluteClientPath(sourcePath) ? sourcePath : null
    const relativePath =
      absoluteSourcePath && commonRootPath
        ? getRelativeClientPath(commonRootPath, absoluteSourcePath)
        : file.webkitRelativePath || file.name

    return {
      fileName: file.name,
      relativePath,
      sourcePath: absoluteSourcePath,
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

export const mergeThumbnailProgress = (
  currentProgress: ThumbnailProgress,
  payload: ThumbnailProgressPayload,
  status: ThumbnailProgress['status'] = 'running',
): ThumbnailProgress => ({
  ...currentProgress,
  jobId: payload.jobId ?? currentProgress.jobId,
  status,
  phase: payload.phase ?? currentProgress.phase,
  totalVideos:
    typeof payload.totalVideos === 'number'
      ? payload.totalVideos
      : currentProgress.totalVideos,
  processedVideos:
    typeof payload.processedVideos === 'number'
      ? payload.processedVideos
      : currentProgress.processedVideos,
  generatedCount:
    typeof payload.generatedCount === 'number'
      ? payload.generatedCount
      : currentProgress.generatedCount,
  cachedCount:
    typeof payload.cachedCount === 'number'
      ? payload.cachedCount
      : currentProgress.cachedCount,
  failedCount:
    typeof payload.failedCount === 'number'
      ? payload.failedCount
      : currentProgress.failedCount,
  currentFile: payload.currentFile ?? currentProgress.currentFile,
  message: payload.message ?? currentProgress.message,
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

export const getThumbnailPercent = (thumbnailProgress: ThumbnailProgress) =>
  thumbnailProgress.totalVideos && thumbnailProgress.totalVideos > 0
    ? Math.round(
        (thumbnailProgress.processedVideos / thumbnailProgress.totalVideos) *
          100,
      )
    : null
