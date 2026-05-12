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

export type VideoRow = {
  displayFile: string
  displayDirectory: string
  path: string
  directory: string
  fileName: string
  extension: string
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
}

export type StoredVideoData = {
  fileName: string | null
  payload: string | null
  rows: VideoRow[]
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
}

export type AuditRequestPayload = {
  rootPath: string
  sampleFile: FolderPathManifestItem
  includeBlackBorderAnalysis?: boolean
}

export type AuditProgress = {
  jobId: string | null
  status: 'idle' | 'starting' | 'running' | 'complete' | 'error'
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
