export type VideoSource = Record<string, unknown>

export type VideoStatus = 'Pending' | 'Queued' | 'Completed' | 'Dismissed'

export type BlackBorderClassification =
  | 'clean'
  | 'pillarboxed'
  | 'letterboxed'
  | 'nested_borders'
  | 'asymmetric_border'
  | 'uncertain'
  | 'analysis_error'

export type BlackBorderConfidence = 'high' | 'medium' | 'low' | null

export type BlackBorderRecommendedFix = {
  eligible: boolean
  type: 'crop-scale' | 'manual-review' | 'none'
  targetWidth?: number
  targetHeight?: number
  reason?: string
}

export type BlackBorderAdjustment = {
  analyzed: boolean
  detected: boolean
  classification: BlackBorderClassification
  confidence: BlackBorderConfidence
  source?: {
    width: number
    height: number
    aspectRatio: number
    aspectRatioLabel: string
  }
  visibleArea?: {
    width: number
    height: number
    x: number
    y: number
    aspectRatio: number
    aspectRatioLabel: string
  }
  borders?: {
    left: number
    right: number
    top: number
    bottom: number
  }
  borderPercent?: {
    left: number
    right: number
    top: number
    bottom: number
    blackFrameEstimate: number
  }
  recommendedFix?: BlackBorderRecommendedFix
  error?: string
}

export type VideoAdjustments = {
  blackBorder?: BlackBorderAdjustment
}

export type VideoThumbnail = {
  generated: boolean
  cached?: boolean
  fileName?: string
  url?: string
  path?: string
  timestampSeconds?: number
  error?: string
}

export type VideoRow = {
  displayFile: string
  displayDirectory: string
  path: string
  directory: string
  fileName: string
  extension: string
  fileExtension: string
  fileType: string
  sizeBytes: number | null
  sizeMB: number | null
  sizeGB: number | null
  fileSystemSizeBytes: number | null
  ffprobeFormatSizeBytes: number | null
  createdAt: string
  modifiedAt: string
  durationSeconds: number | null
  width: number | null
  height: number | null
  displayAspectRatio: string
  bitRateMbps: number | null
  frameRate: number | null
  isLowResolution: boolean
  isWrongAspectRatio: boolean
  reasons: string
  status: VideoStatus
  adjustments?: VideoAdjustments
  thumbnail?: VideoThumbnail
}

export type StoredVideoData = {
  fileName: string | null
  payload: string | null
  rows: VideoRow[]
}

export type FolderTreeNode = {
  key: string
  data: {
    name: string
    path: string
    relativePath: string
    type: 'folder'
    videoCount: number
    totalVideoSizeBytes: number
    folderCount?: number
    warning?: string
  }
  children?: FolderTreeNode[]
  leaf?: boolean
}

export type FolderTreeSummary = {
  folderCount: number
  videoCount: number
  totalVideoSizeBytes: number
}

export type FolderTreeRoot = {
  path: string
  name: string
  available: boolean
  label?: string
}

export type FolderTreeWarning =
  | string
  | {
      type?: string
      path?: string
      message?: string
    }

export type FolderTreeResponse = {
  root: FolderTreeRoot
  generatedAt: string
  supportedVideoExtensions: string[]
  summary: FolderTreeSummary
  nodes: FolderTreeNode[]
  warnings: FolderTreeWarning[]
  message?: string
}

export type FolderTreeCache = {
  cacheKey: string
  rootPath: string
  generatedAt: string
  savedAt: string
  summary: FolderTreeSummary
  supportedVideoExtensions: string[]
  nodes: FolderTreeNode[]
  warnings: FolderTreeWarning[]
}

export type DefaultRootStatusResponse = {
  defaultRoot: string
  available: boolean
  label?: string
  message?: string
  supportedVideoExtensions?: string[]
}

export type FolderPathManifestItem = {
  fileName: string
  rootPath: string | null
  relativePath: string
}

export type FolderPathTestSummary = {
  totalSelectedFiles: number
  videoFileCount: number
  rootPath: string | null
  firstRelativePath: string | null
  selectedFolderCount?: number
  totalSelectedSizeBytes?: number
}

export type SelectedFileManifestItem = {
  fileName: string
  relativePath: string
  sourcePath: string | null
}

export type AuditRequestPayload = {
  rootPath?: string
  sampleFile?: FolderPathManifestItem
  selectedFolders?: string[]
  scanOptions?: {
    includeSubfolders?: boolean
    includeLowResolutionAnalysis?: boolean
    includeBlackBorderAnalysis?: boolean
  }
  includeSubfolders?: boolean
  includeLowResolutionAnalysis?: boolean
  includeBlackBorderAnalysis?: boolean
}

export type AuditProgress = {
  jobId: string | null
  status: 'idle' | 'starting' | 'running' | 'complete' | 'error' | 'canceled'
  phase: string | null
  resolvedDirectory: string | null
  totalFiles: number | null
  processedFiles: number
  flaggedCount: number
  errorCount: number
  currentFile: string | null
  message: string | null
}

export type AuditResultResponse = {
  jobId: string
  status: 'complete'
  summary: {
    resolvedDirectory: string
    totalFiles: number
    flaggedCount: number
    errorCount: number
  }
  videos: VideoSource[]
}

export type AuditStartResponse = {
  jobId?: string
  matches?: unknown
  message?: string
  resolvedDirectory?: unknown
  status?: string
}

export type AuditProgressPayload = Partial<Omit<AuditProgress, 'status'>> & {
  jobId?: string
  status?: string
}

export type AutoCropProgress = {
  jobId: string | null
  status: 'idle' | 'starting' | 'running' | 'complete' | 'error'
  phase: string | null
  outputRootDir: string | null
  outputDir: string | null
  totalFiles: number | null
  processedFiles: number
  succeededCount: number
  skippedCount: number
  errorCount: number
  currentFile: string | null
  message: string | null
}

export type AutoCropProgressPayload = Partial<
  Omit<AutoCropProgress, 'status'>
> & {
  jobId?: string
  status?: string
}

export type AutoCropStartResponse = {
  jobId?: string
  message?: string
  outputDir?: string
  outputRootDir?: string
  status?: string
}

export type AutoCropResultItem = {
  fileName: string
  sourcePath: string
  outputPath?: string | null
  status: 'success' | 'skipped' | 'failed'
  error?: string | null
}

export type AutoCropResultResponse = {
  jobId: string
  status: 'complete'
  summary: {
    requested: number
    eligible: number
    skipped: number
    succeeded: number
    failed: number
    sourceBytes?: number
    outputBytes?: number
  }
  outputDir: string
  manifestPath?: string
  items: AutoCropResultItem[]
}

export type ThumbnailScope = 'selected' | 'all'

export type ThumbnailProgress = {
  jobId: string | null
  status: 'idle' | 'starting' | 'running' | 'complete' | 'error'
  phase: string | null
  totalVideos: number | null
  processedVideos: number
  generatedCount: number
  cachedCount: number
  failedCount: number
  currentFile: string | null
  message: string | null
}

export type ThumbnailProgressPayload = Partial<
  Omit<ThumbnailProgress, 'status'>
> & {
  jobId?: string
  status?: string
}

export type ThumbnailStartResponse = {
  jobId?: string
  message?: string
  status?: string
  totalVideos?: number
}

export type ThumbnailResultItem = {
  id?: string
  fileName?: string
  path?: string
  absolutePath?: string
  thumbnail: VideoThumbnail
}

export type ThumbnailResultResponse = {
  jobId: string
  status: 'complete' | 'error'
  summary: {
    requested: number
    generated: number
    cached: number
    failed: number
  }
  items: ThumbnailResultItem[]
}
