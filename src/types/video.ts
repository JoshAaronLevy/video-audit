export type VideoSource = Record<string, unknown>

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
