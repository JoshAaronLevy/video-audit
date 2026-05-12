import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Toast } from 'primereact/toast'
import {
  apiBaseUrl,
  clearStoredVideoData,
  getAuditPercent,
  getAutoCropPercent,
  getMigrationPercent,
  initialAuditProgress,
  initialAutoCropProgress,
  initialMigrationProgress,
  isAutoCropCandidate,
  isVideoLikeFile,
  loadStoredVideoData,
  mergeAuditProgress,
  mergeAutoCropProgress,
  mergeMigrationProgress,
  saveVideoData,
  toFolderPathManifest,
  toSelectedFilesManifest,
  toVideoRow,
} from '../helpers/utils'
import type {
  AuditProgress,
  AuditProgressPayload,
  AuditRequestPayload,
  AuditResultResponse,
  AuditStartResponse,
  AutoCropProgress,
  AutoCropProgressPayload,
  AutoCropResultResponse,
  AutoCropStartResponse,
  FolderPathTestSummary,
  SelectedFileManifestItem,
  StoredVideoData,
  VideoRow,
} from '../types/video'
import type {
  PremiereExportRequestPayload,
  PremiereExportRequestResponse,
  PremiereExportVideo,
  PremiereImportRequestPayload,
  PremierePreset,
  PremiereStatusResponse,
} from '../types/premiere'
import type {
  MigrationExecuteRequest,
  MigrationProgress,
  MigrationProgressPayload,
  MigrationResult,
  MigrationScanRequest,
  MigrationScanResponse,
} from '../types/migration'

const toPremiereExportVideo = (row: VideoRow): PremiereExportVideo => ({
  id: row.path,
  fileName: row.fileName,
  absolutePath: row.path,
  directory: row.directory,
  durationSeconds: row.durationSeconds,
  width: row.width,
  height: row.height,
  displayAspectRatio: row.displayAspectRatio,
  frameRate: row.frameRate,
})

const isPremierePresetAvailable = (preset: PremierePreset) =>
  preset.available !== false

const getFirstAvailablePremierePresetId = (presets: PremierePreset[]) =>
  presets.find(isPremierePresetAvailable)?.id ?? null

const markRowsQueued = (rows: VideoRow[], queuedVideoPaths: Set<string>) =>
  rows.map((row) =>
    queuedVideoPaths.has(row.path) ? { ...row, status: 'Queued' as const } : row,
  )

type FileWithMaybePath = File & {
  path?: string
}

const getAbsoluteFolderPathFromSelection = (
  files: File[],
  manifest: ReturnType<typeof toFolderPathManifest>,
) => {
  const sampleFile = manifest[0]

  if (!sampleFile) {
    return null
  }

  const selectedFile = files.find(
    (file) =>
      file.name === sampleFile.fileName &&
      (file.webkitRelativePath || file.name) === sampleFile.relativePath,
  )
  const absoluteFilePath = (selectedFile as FileWithMaybePath | undefined)?.path

  if (!absoluteFilePath) {
    return null
  }

  const normalizedFilePath = absoluteFilePath.replace(/\\/g, '/')
  const relativeParts = sampleFile.relativePath.split('/').filter(Boolean)
  const fileParts = normalizedFilePath.split('/').filter(Boolean)

  if (relativeParts.length === 0 || fileParts.length < relativeParts.length) {
    return null
  }

  const tailParts = fileParts.slice(-relativeParts.length)
  const tailMatches = tailParts.every(
    (part, index) => part === relativeParts[index],
  )

  if (!tailMatches) {
    return null
  }

  const rootPartCount = fileParts.length - relativeParts.length + 1
  const rootParts = fileParts.slice(0, rootPartCount)
  const prefix = normalizedFilePath.startsWith('/') ? '/' : ''

  return `${prefix}${rootParts.join('/')}`
}

export function useVideoAuditController() {
  const [initialData] = useState<StoredVideoData | null>(() =>
    loadStoredVideoData(),
  )
  const folderPathInputRef = useRef<HTMLInputElement | null>(null)
  const selectedFilesInputRef = useRef<HTMLInputElement | null>(null)
  const newEditedFolderInputRef = useRef<HTMLInputElement | null>(null)
  const auditEventSourceRef = useRef<EventSource | null>(null)
  const autoCropEventSourceRef = useRef<EventSource | null>(null)
  const migrationEventSourceRef = useRef<EventSource | null>(null)
  const toast = useRef<Toast>(null)
  const [error, setError] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(
    () => initialData?.fileName ?? null,
  )
  const [videoRows, setVideoRows] = useState<VideoRow[] | null>(
    () => initialData?.rows ?? null,
  )
  const [storedPayload, setStoredPayload] = useState<string | null>(
    () => initialData?.payload ?? null,
  )
  const [auditedRootDirectory, setAuditedRootDirectory] = useState<string | null>(
    () => initialData?.fileName ?? null,
  )
  const [isPersisted, setIsPersisted] = useState(() => Boolean(initialData))
  const [isTableLoading, setIsTableLoading] = useState(false)
  const [globalFilter, setGlobalFilter] = useState('')
  const [includeLowResolutionAnalysis, setIncludeLowResolutionAnalysis] =
    useState(true)
  const [includeBlackBorderAnalysis, setIncludeBlackBorderAnalysis] =
    useState(false)
  const [folderPathTestSummary, setFolderPathTestSummary] =
    useState<FolderPathTestSummary | null>(null)
  const [auditProgress, setAuditProgress] =
    useState<AuditProgress>(initialAuditProgress)
  const [premiereStatus, setPremiereStatus] =
    useState<PremiereStatusResponse | null>(null)
  const [isPremiereStatusLoading, setIsPremiereStatusLoading] = useState(false)
  const [premierePresets, setPremierePresets] = useState<PremierePreset[]>([])
  const [selectedVideos, setSelectedVideos] = useState<VideoRow[]>([])
  const [isPremiereExportDialogVisible, setIsPremiereExportDialogVisible] =
    useState(false)
  const [selectedPremierePresetId, setSelectedPremierePresetId] = useState<
    string | null
  >(null)
  const [premiereExportError, setPremiereExportError] = useState<string | null>(
    null,
  )
  const [isPremiereExportSubmitting, setIsPremiereExportSubmitting] =
    useState(false)
  const [isAutoCropDialogVisible, setIsAutoCropDialogVisible] = useState(false)
  const [isAutoCropSubmitting, setIsAutoCropSubmitting] = useState(false)
  const [autoCropProgress, setAutoCropProgress] =
    useState<AutoCropProgress>(initialAutoCropProgress)
  const [autoCropResult, setAutoCropResult] =
    useState<AutoCropResultResponse | null>(null)
  const [autoCropError, setAutoCropError] = useState<string | null>(null)
  const [isPremiereImportSubmitting, setIsPremiereImportSubmitting] =
    useState(false)
  const [isMigrationScanDialogVisible, setIsMigrationScanDialogVisible] =
    useState(false)
  const [isMigrationScanning, setIsMigrationScanning] = useState(false)
  const [migrationNewEditedDir, setMigrationNewEditedDir] = useState('')
  const [migrationScan, setMigrationScan] =
    useState<MigrationScanResponse | null>(null)
  const [migrationScanError, setMigrationScanError] = useState<string | null>(
    null,
  )
  const [isMigrationExecuting, setIsMigrationExecuting] = useState(false)
  const [migrationProgress, setMigrationProgress] =
    useState<MigrationProgress>(initialMigrationProgress)
  const [migrationResult, setMigrationResult] =
    useState<MigrationResult | null>(null)
  const [migrationResultError, setMigrationResultError] = useState<string | null>(
    null,
  )

  const closeAuditEventSource = () => {
    auditEventSourceRef.current?.close()
    auditEventSourceRef.current = null
  }

  const closeAutoCropEventSource = () => {
    autoCropEventSourceRef.current?.close()
    autoCropEventSourceRef.current = null
  }

  const closeMigrationEventSource = () => {
    migrationEventSourceRef.current?.close()
    migrationEventSourceRef.current = null
  }

  const checkPremiereStatus = useCallback(async () => {
    setIsPremiereStatusLoading(true)

    try {
      const statusUrl = `${apiBaseUrl}/api/premiere/status`

      const response = await fetch(statusUrl)

      if (!response.ok) {
        throw new Error('Unable to check Premiere bridge status.')
      }

      const payload = (await response.json()) as PremiereStatusResponse

      setPremiereStatus(payload)
      const nextPresets = Array.isArray(payload.presets) ? payload.presets : []
      setPremierePresets(nextPresets)
      setSelectedPremierePresetId((currentPresetId) => {
        if (
          currentPresetId &&
          nextPresets.some(
            (preset) =>
              preset.id === currentPresetId && isPremierePresetAvailable(preset),
          )
        ) {
          return currentPresetId
        }

        return getFirstAvailablePremierePresetId(nextPresets)
      })
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to check Premiere bridge status.'

      console.error('[Premiere Bridge] Status check failed', caughtError)

      setPremiereStatus({
        status: 'error',
        message,
        bridge: { connected: false },
      })
      setPremierePresets([])
      setSelectedPremierePresetId(null)
      toast.current?.show({
        severity: 'error',
        summary: 'Premiere status failed',
        detail: message,
        life: 5200,
      })
    } finally {
      setIsPremiereStatusLoading(false)
    }
  }, [])

  useEffect(() => {
    return () => {
      closeAuditEventSource()
      closeAutoCropEventSource()
      closeMigrationEventSource()
    }
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void checkPremiereStatus()
    }, 0)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [checkPremiereStatus])

  const updateAuditProgress = (
    payload: AuditProgressPayload,
    status: AuditProgress['status'] = 'running',
  ) => {
    setAuditProgress((currentProgress) =>
      mergeAuditProgress(currentProgress, payload, status),
    )
  }

  const updateAutoCropProgress = (
    payload: AutoCropProgressPayload,
    status: AutoCropProgress['status'] = 'running',
  ) => {
    setAutoCropProgress((currentProgress) =>
      mergeAutoCropProgress(currentProgress, payload, status),
    )
  }

  const updateMigrationProgress = (
    payload: Partial<MigrationProgressPayload>,
    status: MigrationProgress['status'] = 'running',
  ) => {
    setMigrationProgress((currentProgress) =>
      mergeMigrationProgress(currentProgress, payload, status),
    )
  }

  const parseAuditRequestPayload = (
    payloadJson: string,
  ): AuditRequestPayload => {
    const parsedPayload: unknown = JSON.parse(payloadJson)

    if (
      !parsedPayload ||
      typeof parsedPayload !== 'object' ||
      Array.isArray(parsedPayload)
    ) {
      throw new Error('Saved refresh payload is not valid.')
    }

    const candidate = parsedPayload as Partial<AuditRequestPayload>

    if (
      typeof candidate.rootPath !== 'string' ||
      !candidate.sampleFile ||
      typeof candidate.sampleFile !== 'object' ||
      Array.isArray(candidate.sampleFile)
    ) {
      throw new Error('Saved refresh payload is not valid.')
    }

    return parsedPayload as AuditRequestPayload
  }

  const handleAuditResult = async (
    jobId: string,
    resolvedDirectory: string | null,
    requestPayloadJson: string | null,
  ) => {
    const response = await fetch(`${apiBaseUrl}/api/audits/${jobId}/result`)

    if (!response.ok) {
      throw new Error('Unable to fetch completed audit results.')
    }

    const result = (await response.json()) as AuditResultResponse

    if (result.status !== 'complete' || !Array.isArray(result.videos)) {
      throw new Error('The audit result was not complete.')
    }

    const trimmedRows = result.videos.map((video) => toVideoRow(video))
    const displayDirectory =
      resolvedDirectory || result.summary.resolvedDirectory || 'selected folder'
    const nextFileName = `${displayDirectory}`
    const persisted = saveVideoData({
      fileName: nextFileName,
      payload: requestPayloadJson,
      rows: trimmedRows,
    })

    setVideoRows(trimmedRows)
    setSelectedVideos([])
    setFileName(nextFileName)
    setStoredPayload(requestPayloadJson)
    setAuditedRootDirectory(displayDirectory)
    setIsPersisted(persisted)
    setIsTableLoading(false)
    setGlobalFilter('')
    setError(null)
    setAuditProgress((currentProgress) => ({
      ...currentProgress,
      status: 'complete',
      phase: 'complete',
      resolvedDirectory: displayDirectory,
      totalFiles: result.summary.totalFiles,
      processedFiles: result.summary.totalFiles,
      flaggedCount: result.summary.flaggedCount,
      errorCount: result.summary.errorCount,
      currentFile: null,
      message: 'Audit complete.',
    }))
    toast.current?.show({
      severity: persisted ? 'success' : 'warn',
      summary: 'Audit complete',
      detail: persisted
        ? `${result.summary.flaggedCount.toLocaleString()} flagged videos found and saved locally.`
        : `${result.summary.flaggedCount.toLocaleString()} flagged videos found, but could not be saved locally.`,
      life: 4200,
    })
  }

  const startAudit = async (requestPayloadJson: string) => {
    const requestPayload = parseAuditRequestPayload(requestPayloadJson)

    await startAuditJob({
      requestPayloadJson,
      resolveMessage: 'Resolving selected folder...',
      startRequest: () =>
        fetch(`${apiBaseUrl}/api/audits`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestPayload),
        }),
    })
  }

  const startAuditJob = async ({
    requestPayloadJson,
    resolveMessage,
    startRequest,
  }: {
    requestPayloadJson: string | null
    resolveMessage: string
    startRequest: () => Promise<Response>
  }) => {
    try {
      closeAuditEventSource()
      setError(null)
      setGlobalFilter('')

      if (videoRows !== null) {
        setSelectedVideos([])
        setVideoRows([])
        setIsTableLoading(true)
      }

      setAuditProgress({
        ...initialAuditProgress,
        status: 'starting',
        phase: 'resolve',
        message: resolveMessage,
      })

      const response = await startRequest()
      const payload = (await response.json()) as AuditStartResponse

      if (payload.status === 'not_found') {
        throw new Error('Could not resolve the selected folder on the local backend.')
      }

      if (payload.status === 'multiple_matches') {
        console.log('Multiple matching audit folders:', payload.matches)
        throw new Error(
          'Multiple matching folders were found. Backend confirmation UI is not implemented yet.',
        )
      }

      if (!response.ok || payload.status !== 'started' || !payload.jobId) {
        throw new Error(
          payload.message || 'Unable to start the backend audit job.',
        )
      }

      const jobId = payload.jobId
      const resolvedDirectory =
        typeof payload.resolvedDirectory === 'string'
          ? payload.resolvedDirectory
          : null

      setAuditProgress({
        ...initialAuditProgress,
        jobId,
        status: 'running',
        phase: 'walking',
        resolvedDirectory,
        message: 'Starting audit...',
      })

      const eventSource = new EventSource(
        `${apiBaseUrl}/api/audits/${jobId}/events`,
      )
      auditEventSourceRef.current = eventSource

      eventSource.addEventListener('progress', (event) => {
        const progressPayload = JSON.parse(
          (event as MessageEvent<string>).data,
        ) as AuditProgressPayload
        updateAuditProgress(progressPayload, 'running')
      })

      eventSource.addEventListener('complete', (event) => {
        const completePayload = JSON.parse(
          (event as MessageEvent<string>).data,
        ) as AuditProgressPayload
        closeAuditEventSource()
        updateAuditProgress(completePayload, 'complete')

        void handleAuditResult(
          jobId,
          resolvedDirectory,
          requestPayloadJson,
        ).catch((caughtError) => {
          const message =
            caughtError instanceof Error
              ? caughtError.message
              : 'Unable to load completed audit results.'

          setError(message)
          setIsTableLoading(false)
          setAuditProgress((currentProgress) => ({
            ...currentProgress,
            status: 'error',
            message,
          }))
          toast.current?.show({
            severity: 'error',
            summary: 'Audit result failed',
            detail: message,
            life: 5200,
          })
        })
      })

      eventSource.addEventListener('error', (event) => {
        const maybeMessageEvent = event as MessageEvent<string>
        const hasServerPayload =
          typeof maybeMessageEvent.data === 'string' &&
          maybeMessageEvent.data.length > 0

        if (hasServerPayload) {
          const errorPayload = JSON.parse(
            maybeMessageEvent.data,
          ) as AuditProgressPayload
          const message =
            errorPayload.message || 'The backend audit job failed.'

          closeAuditEventSource()
          setError(message)
          setIsTableLoading(false)
          updateAuditProgress(errorPayload, 'error')
          toast.current?.show({
            severity: 'error',
            summary: 'Audit failed',
            detail: message,
            life: 5200,
          })
          return
        }

        const message = 'Lost connection to the backend audit progress stream.'
        closeAuditEventSource()
        setError(message)
        setIsTableLoading(false)
        setAuditProgress((currentProgress) => ({
          ...currentProgress,
          status: 'error',
          message,
        }))
        toast.current?.show({
          severity: 'error',
          summary: 'Audit connection failed',
          detail: message,
          life: 5200,
        })
      })
    } catch (caughtError) {
      closeAuditEventSource()
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to start the backend audit.'

      setError(message)
      setIsTableLoading(false)
      setAuditProgress((currentProgress) => ({
        ...currentProgress,
        status: 'error',
        message,
      }))
      toast.current?.show({
        severity: 'error',
        summary: 'Audit failed',
        detail: message,
        life: 5200,
      })
    }
  }

  const handleOpenFolderPathTest = () => {
    folderPathInputRef.current?.click()
  }

  const handleOpenSelectedFilesAudit = () => {
    selectedFilesInputRef.current?.click()
  }

  const handleFolderPathSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.currentTarget.files ?? [])
    const manifest = toFolderPathManifest(event.currentTarget.files)
    const summary: FolderPathTestSummary = {
      totalSelectedFiles: selectedFiles.length,
      videoFileCount: manifest.length,
      rootPath: manifest[0]?.rootPath ?? null,
      firstRelativePath: manifest[0]?.relativePath ?? null,
    }

    setFolderPathTestSummary(summary)
    event.currentTarget.value = ''

    if (manifest.length === 0) {
      const message = 'The selected folder does not contain any video files.'
      setError(message)
      toast.current?.show({
        severity: 'warn',
        summary: 'No videos found',
        detail: message,
        life: 4200,
      })
      return
    }

    const sampleFile = manifest[0]

    if (!sampleFile.rootPath) {
      const message = 'Unable to determine the selected folder root.'
      setError(message)
      toast.current?.show({
        severity: 'error',
        summary: 'Folder audit unavailable',
        detail: message,
        life: 4200,
      })
      return
    }

    const requestPayload: AuditRequestPayload = {
      rootPath: sampleFile.rootPath,
      sampleFile,
      includeLowResolutionAnalysis,
      includeBlackBorderAnalysis,
    }

    await startAudit(JSON.stringify(requestPayload))
  }

  const handleSelectedFilesSelect = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const allSelectedFiles = Array.from(event.currentTarget.files ?? [])
    const selectedVideoFiles = allSelectedFiles
      .filter(isVideoLikeFile)
      .filter((file) => !file.name.startsWith('._'))
    const manifest = toSelectedFilesManifest(event.currentTarget.files)
    const summary: FolderPathTestSummary = {
      totalSelectedFiles: allSelectedFiles.length,
      videoFileCount: manifest.length,
      rootPath: 'Selected files',
      firstRelativePath: manifest[0]?.relativePath ?? null,
    }

    setFolderPathTestSummary(summary)
    event.currentTarget.value = ''

    if (manifest.length === 0 || selectedVideoFiles.length === 0) {
      const message = 'The selected files do not include any video files.'
      setError(message)
      toast.current?.show({
        severity: 'warn',
        summary: 'No videos found',
        detail: message,
        life: 4200,
      })
      return
    }

    const formData = new FormData()
    const requestMetadata: SelectedFileManifestItem[] = manifest

    selectedVideoFiles.forEach((file) => {
      formData.append('files', file, file.name)
    })
    formData.append('metadata', JSON.stringify(requestMetadata))
    formData.append(
      'includeLowResolutionAnalysis',
      String(includeLowResolutionAnalysis),
    )
    formData.append(
      'includeBlackBorderAnalysis',
      String(includeBlackBorderAnalysis),
    )

    await startAuditJob({
      requestPayloadJson: null,
      resolveMessage: 'Preparing selected files...',
      startRequest: () =>
        fetch(`${apiBaseUrl}/api/audits/files`, {
          method: 'POST',
          body: formData,
        }),
    })
  }

  const handleRefreshData = async () => {
    if (!storedPayload) {
      const message = 'No saved scan payload is available. Scan a folder again.'
      setError(message)
      toast.current?.show({
        severity: 'warn',
        summary: 'Refresh unavailable',
        detail: message,
        life: 4200,
      })
      return
    }

    await startAudit(storedPayload)
  }

  const handleClearData = () => {
    closeAuditEventSource()
    closeAutoCropEventSource()
    closeMigrationEventSource()
    clearStoredVideoData()
    setVideoRows(null)
    setSelectedVideos([])
    setFileName(null)
    setStoredPayload(null)
    setAuditedRootDirectory(null)
    setGlobalFilter('')
    setIsPersisted(false)
    setIsTableLoading(false)
    setFolderPathTestSummary(null)
    setError(null)
    setAuditProgress(initialAuditProgress)
    setAutoCropProgress(initialAutoCropProgress)
    setAutoCropResult(null)
    setAutoCropError(null)
    setIsAutoCropDialogVisible(false)
    setIsAutoCropSubmitting(false)
    setIsMigrationScanDialogVisible(false)
    setIsMigrationScanning(false)
    setMigrationNewEditedDir('')
    setMigrationScan(null)
    setMigrationScanError(null)
    setIsMigrationExecuting(false)
    setMigrationProgress(initialMigrationProgress)
    setMigrationResult(null)
    setMigrationResultError(null)
  }

  const handleOpenMigrationDialog = () => {
    if (!auditedRootDirectory) {
      const message =
        'Run an audit first so the app knows the destination library folder.'

      setMigrationScanError(message)
      toast.current?.show({
        severity: 'warn',
        summary: 'Migration unavailable',
        detail: message,
        life: 5200,
      })
      return
    }

    setMigrationScanError(null)
    setMigrationResultError(null)
    setMigrationResult(null)
    setMigrationProgress(initialMigrationProgress)
    setIsMigrationScanDialogVisible(true)
  }

  const handleCloseMigrationDialog = () => {
    if (isMigrationScanning || isMigrationExecuting) {
      return
    }

    setIsMigrationScanDialogVisible(false)
    setMigrationScanError(null)
    setMigrationResultError(null)
  }

  const handleCloseMigrationScan = () => {
    handleCloseMigrationDialog()
  }

  const handleSelectNewEditedFolderClick = () => {
    if (!auditedRootDirectory) {
      handleOpenMigrationDialog()
      return
    }

    newEditedFolderInputRef.current?.click()
  }

  const handleMigrationNewEditedDirChange = (value: string) => {
    setMigrationNewEditedDir(value)
    setMigrationScanError(null)
  }

  const handleStartMigrationScan = async (newEditedDir?: string) => {
    const nextNewEditedDir = (newEditedDir ?? migrationNewEditedDir).trim()

    if (!auditedRootDirectory) {
      const message =
        'Run an audit first so the app knows the destination library folder.'

      setMigrationScanError(message)
      toast.current?.show({
        severity: 'warn',
        summary: 'Migration unavailable',
        detail: message,
        life: 5200,
      })
      return
    }

    if (!nextNewEditedDir) {
      setMigrationScanError('Select or enter the new edited videos folder.')
      return
    }

    closeMigrationEventSource()
    setIsMigrationScanning(true)
    setMigrationScanError(null)
    setMigrationResult(null)
    setMigrationResultError(null)
    setMigrationProgress(initialMigrationProgress)

    try {
      const requestPayload: MigrationScanRequest = {
        newEditedDir: nextNewEditedDir,
        destinationRoot: auditedRootDirectory,
      }
      const response = await fetch(`${apiBaseUrl}/api/migrations/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload),
      })
      const payload = (await response.json()) as
        | MigrationScanResponse
        | { message?: string }

      if (!response.ok) {
        throw new Error(
          'message' in payload && payload.message
            ? payload.message
            : 'Unable to scan the migration plan.',
        )
      }

      const scanPayload = payload as MigrationScanResponse

      setMigrationScan(scanPayload)
      setMigrationNewEditedDir(scanPayload.newEditedDir)
      toast.current?.show({
        severity: 'success',
        summary: 'Migration scan ready',
        detail: `${scanPayload.summary.newFilesFound.toLocaleString()} new files reviewed.`,
        life: 3600,
      })
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to scan the migration plan.'

      setMigrationScanError(message)
      toast.current?.show({
        severity: 'error',
        summary: 'Migration scan failed',
        detail: message,
        life: 5200,
      })
    } finally {
      setIsMigrationScanning(false)
    }
  }

  const handleNewEditedFolderSelect = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const selectedFiles = Array.from(event.currentTarget.files ?? [])
    const manifest = toFolderPathManifest(event.currentTarget.files)
    const selectedFolderPath = getAbsoluteFolderPathFromSelection(
      selectedFiles,
      manifest,
    )

    event.currentTarget.value = ''

    if (manifest.length === 0) {
      const message = 'The selected folder does not contain any video files.'

      setMigrationScanError(message)
      toast.current?.show({
        severity: 'warn',
        summary: 'No videos found',
        detail: message,
        life: 4200,
      })
      return
    }

    if (!selectedFolderPath) {
      const selectedRoot = manifest[0]?.rootPath ?? 'selected folder'
      const message =
        `Selected ${selectedRoot}, but this browser did not expose its full local path. Enter the absolute folder path to scan.`

      setMigrationNewEditedDir('')
      setMigrationScanError(message)
      setIsMigrationScanDialogVisible(true)
      toast.current?.show({
        severity: 'warn',
        summary: 'Folder path needed',
        detail: message,
        life: 6200,
      })
      return
    }

    setMigrationNewEditedDir(selectedFolderPath)
    setIsMigrationScanDialogVisible(true)
    await handleStartMigrationScan(selectedFolderPath)
  }

  const handleOpenPremiereExportDialog = () => {
    if (
      selectedVideos.length === 0 ||
      premiereStatus?.status !== 'ready' ||
      isAuditActive ||
      isTableLoading
    ) {
      return
    }

    setPremiereExportError(null)
    setSelectedPremierePresetId((currentPresetId) => {
      if (
        currentPresetId &&
        premierePresets.some(
          (preset) =>
            preset.id === currentPresetId && isPremierePresetAvailable(preset),
        )
      ) {
        return currentPresetId
      }

      return getFirstAvailablePremierePresetId(premierePresets)
    })
    setIsPremiereExportDialogVisible(true)
  }

  const handleClosePremiereExportDialog = () => {
    if (isPremiereExportSubmitting) {
      return
    }

    setIsPremiereExportDialogVisible(false)
    setPremiereExportError(null)
  }

  const handleSubmitPremiereExport = async () => {
    if (!selectedPremierePresetId) {
      setPremiereExportError('Choose an export preset.')
      return
    }

    const selectedPreset = premierePresets.find(
      (preset) => preset.id === selectedPremierePresetId,
    )

    if (!selectedPreset || !isPremierePresetAvailable(selectedPreset)) {
      setPremiereExportError(
        selectedPreset?.unavailableMessage ||
          'The selected export preset file is missing.',
      )
      return
    }

    if (selectedVideos.length === 0) {
      setPremiereExportError('Select at least one video to export.')
      return
    }

    const requestPayload: PremiereExportRequestPayload = {
      presetId: selectedPremierePresetId,
      videos: selectedVideos.map(toPremiereExportVideo),
    }

    setIsPremiereExportSubmitting(true)
    setPremiereExportError(null)

    try {
      const response = await fetch(`${apiBaseUrl}/api/premiere/export-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload),
      })
      const payload = (await response.json()) as PremiereExportRequestResponse

      if (payload.status === 'bridge_not_ready' && payload.premiereStatus) {
        setPremiereStatus(payload.premiereStatus)
        setPremierePresets(
          Array.isArray(payload.premiereStatus.presets)
            ? payload.premiereStatus.presets
            : [],
        )
      }

      if (!response.ok || payload.status !== 'queued' || !payload.requestId) {
        throw new Error(
          payload.message || 'Unable to queue export request for Premiere.',
        )
      }

      const queuedVideoPaths = new Set(
        requestPayload.videos.map((video) => video.absolutePath),
      )
      if (videoRows) {
        const nextRows = markRowsQueued(videoRows, queuedVideoPaths)
        const persisted = saveVideoData({
          fileName,
          payload: storedPayload,
          rows: nextRows,
        })

        setVideoRows(nextRows)
        setIsPersisted(persisted)
      }
      setSelectedVideos([])
      setIsPremiereExportDialogVisible(false)
      setPremiereExportError(null)
      toast.current?.show({
        severity: 'success',
        summary: 'Export queued',
        detail: `Videos successfully added to the Media Encoder queue. Ready to export.`,
        life: 3000,
      })
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to queue export request for Premiere.'

      setPremiereExportError(message)
      toast.current?.show({
        severity: 'error',
        summary: 'Export failed',
        detail: message,
        life: 5200,
      })
    } finally {
      setIsPremiereExportSubmitting(false)
    }
  }

  const handleOpenAutoCropDialog = () => {
    if (
      selectedVideos.every((video) => !isAutoCropCandidate(video)) ||
      isAuditActive ||
      isTableLoading
    ) {
      return
    }

    setAutoCropError(null)
    setAutoCropResult(null)
    setAutoCropProgress(initialAutoCropProgress)
    setIsAutoCropDialogVisible(true)
  }

  const handleCloseAutoCropDialog = () => {
    if (isAutoCropSubmitting || isPremiereImportSubmitting) {
      return
    }

    setIsAutoCropDialogVisible(false)
    setAutoCropError(null)
    setAutoCropResult(null)
    setAutoCropProgress(initialAutoCropProgress)
  }

  const handleCloseAutoCropResult = () => {
    handleCloseAutoCropDialog()
  }

  const fetchAutoCropResult = async (jobId: string) => {
    const response = await fetch(
      `${apiBaseUrl}/api/adjustments/auto-crop/${jobId}/result`,
    )

    if (!response.ok) {
      throw new Error('Unable to fetch completed auto-crop results.')
    }

    const result = (await response.json()) as AutoCropResultResponse

    if (result.status !== 'complete') {
      throw new Error('The auto-crop result was not complete.')
    }

    setAutoCropResult(result)
    setAutoCropProgress((currentProgress) => ({
      ...currentProgress,
      status: 'complete',
      phase: 'complete',
      outputDir: result.outputDir,
      totalFiles: result.summary.requested,
      processedFiles: result.summary.requested,
      succeededCount: result.summary.succeeded,
      skippedCount: result.summary.skipped,
      errorCount: result.summary.failed,
      currentFile: null,
      message: 'Auto-crop complete.',
    }))
    toast.current?.show({
      severity: result.summary.failed > 0 ? 'warn' : 'success',
      summary: 'Auto-crop complete',
      detail: `${result.summary.succeeded.toLocaleString()} cropped copies created.`,
      life: 5200,
    })
  }

  const handleSubmitAutoCrop = async () => {
    const eligibleVideos = selectedVideos.filter(isAutoCropCandidate)

    if (eligibleVideos.length === 0) {
      setAutoCropError('Select at least one auto-crop candidate.')
      return
    }

    closeAutoCropEventSource()
    setIsAutoCropSubmitting(true)
    setAutoCropError(null)
    setAutoCropResult(null)
    setAutoCropProgress({
      ...initialAutoCropProgress,
      status: 'starting',
      phase: 'starting',
      totalFiles: eligibleVideos.length,
      message: 'Starting auto-crop...',
    })

    try {
      const response = await fetch(`${apiBaseUrl}/api/adjustments/auto-crop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videos: eligibleVideos }),
      })
      const payload = (await response.json()) as AutoCropStartResponse

      if (!response.ok || payload.status !== 'started' || !payload.jobId) {
        throw new Error(payload.message || 'Unable to start auto-crop.')
      }

      const jobId = payload.jobId

      setAutoCropProgress({
        ...initialAutoCropProgress,
        jobId,
        status: 'running',
        phase: 'cropping',
        outputRootDir: payload.outputRootDir ?? null,
        outputDir: payload.outputDir ?? null,
        totalFiles: eligibleVideos.length,
        message: 'Cropping selected videos...',
      })

      const eventSource = new EventSource(
        `${apiBaseUrl}/api/adjustments/auto-crop/${jobId}/events`,
      )
      autoCropEventSourceRef.current = eventSource

      eventSource.addEventListener('progress', (event) => {
        const progressPayload = JSON.parse(
          (event as MessageEvent<string>).data,
        ) as AutoCropProgressPayload
        updateAutoCropProgress(progressPayload, 'running')
      })

      eventSource.addEventListener('complete', (event) => {
        const completePayload = JSON.parse(
          (event as MessageEvent<string>).data,
        ) as AutoCropProgressPayload
        closeAutoCropEventSource()
        updateAutoCropProgress(completePayload, 'complete')

        void fetchAutoCropResult(jobId)
          .catch((caughtError) => {
            const message =
              caughtError instanceof Error
                ? caughtError.message
                : 'Unable to load completed auto-crop results.'

            setAutoCropError(message)
            setAutoCropProgress((currentProgress) => ({
              ...currentProgress,
              status: 'error',
              message,
            }))
            toast.current?.show({
              severity: 'error',
              summary: 'Auto-crop result failed',
              detail: message,
              life: 5200,
            })
          })
          .finally(() => {
            setIsAutoCropSubmitting(false)
          })
      })

      eventSource.addEventListener('error', (event) => {
        const maybeMessageEvent = event as MessageEvent<string>
        const hasServerPayload =
          typeof maybeMessageEvent.data === 'string' &&
          maybeMessageEvent.data.length > 0

        const errorPayload = hasServerPayload
          ? (JSON.parse(maybeMessageEvent.data) as AutoCropProgressPayload)
          : null
        const message =
          errorPayload?.message ||
          'Lost connection to the backend auto-crop progress stream.'

        closeAutoCropEventSource()
        setIsAutoCropSubmitting(false)
        setAutoCropError(message)
        updateAutoCropProgress(errorPayload ?? { message }, 'error')
        toast.current?.show({
          severity: 'error',
          summary: 'Auto-crop failed',
          detail: message,
          life: 5200,
        })
      })
    } catch (caughtError) {
      closeAutoCropEventSource()
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to start auto-crop.'

      setAutoCropError(message)
      setIsAutoCropSubmitting(false)
      setAutoCropProgress((currentProgress) => ({
        ...currentProgress,
        status: 'error',
        message,
      }))
      toast.current?.show({
        severity: 'error',
        summary: 'Auto-crop failed',
        detail: message,
        life: 5200,
      })
    }
  }

  const handleSubmitPremiereImport = async () => {
    if (selectedVideos.length === 0) {
      setAutoCropError('Select at least one video to import into Premiere.')
      return
    }

    if (premiereStatus?.status !== 'ready') {
      setAutoCropError('Premiere bridge must be ready before importing videos.')
      return
    }

    const requestPayload: PremiereImportRequestPayload = {
      videos: selectedVideos.map(toPremiereExportVideo),
    }

    setIsPremiereImportSubmitting(true)
    setAutoCropError(null)

    try {
      const response = await fetch(`${apiBaseUrl}/api/premiere/import-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload),
      })
      const payload = (await response.json()) as PremiereExportRequestResponse

      if (payload.status === 'bridge_not_ready' && payload.premiereStatus) {
        setPremiereStatus(payload.premiereStatus)
        setPremierePresets(
          Array.isArray(payload.premiereStatus.presets)
            ? payload.premiereStatus.presets
            : [],
        )
      }

      if (!response.ok || payload.status !== 'queued' || !payload.requestId) {
        throw new Error(
          payload.message || 'Unable to import selected videos into Premiere.',
        )
      }

      setIsAutoCropDialogVisible(false)
      setAutoCropError(null)
      setAutoCropResult(null)
      setAutoCropProgress(initialAutoCropProgress)
      toast.current?.show({
        severity: 'success',
        summary: 'Import requested',
        detail:
          'Selected videos will be imported into the open Premiere project without queueing exports.',
        life: 4200,
      })
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to import selected videos into Premiere.'

      setAutoCropError(message)
      toast.current?.show({
        severity: 'error',
        summary: 'Import failed',
        detail: message,
        life: 5200,
      })
    } finally {
      setIsPremiereImportSubmitting(false)
    }
  }

  const fetchMigrationResult = async (migrationId: string) => {
    const response = await fetch(
      `${apiBaseUrl}/api/migrations/${migrationId}/result`,
    )

    if (!response.ok) {
      throw new Error('Unable to fetch completed migration results.')
    }

    const result = (await response.json()) as MigrationResult

    if (result.status !== 'complete') {
      throw new Error('The migration result was not complete.')
    }

    setMigrationResult(result)
    setIsMigrationScanDialogVisible(false)
    setMigrationProgress((currentProgress) => ({
      ...currentProgress,
      status: 'complete',
      phase: 'complete',
      totalFiles: result.summary.newFilesFound,
      processedFiles: result.summary.newFilesFound,
      copiedCount: result.summary.filesCopiedToDestination,
      archivedCount: result.summary.destinationMatchesArchived,
      failedCount: result.summary.failedItems,
      currentFile: null,
      message: 'Migration complete.',
    }))
    toast.current?.show({
      severity: result.summary.failedItems > 0 ? 'warn' : 'success',
      summary: 'Migration complete',
      detail: `${result.summary.filesCopiedToDestination.toLocaleString()} files copied and ${result.summary.destinationMatchesArchived.toLocaleString()} old copies archived.`,
      life: 5600,
    })
  }

  const handleExecuteMigration = async () => {
    if (!migrationScan) {
      setMigrationScanError('Run a migration scan before executing.')
      return
    }

    closeMigrationEventSource()
    setIsMigrationExecuting(true)
    setMigrationResult(null)
    setMigrationResultError(null)
    setMigrationScanError(null)
    setMigrationProgress({
      ...initialMigrationProgress,
      migrationId: migrationScan.migrationId,
      status: 'starting',
      phase: 'planning',
      totalFiles: migrationScan.summary.newFilesFound,
      message: 'Starting migration...',
    })

    try {
      const requestPayload: MigrationExecuteRequest = {
        migrationId: migrationScan.migrationId,
      }
      const response = await fetch(`${apiBaseUrl}/api/migrations/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload),
      })
      const payload = (await response.json()) as {
        migrationId?: string
        message?: string
        status?: string
      }

      if (
        !response.ok ||
        payload.status !== 'started' ||
        payload.migrationId !== migrationScan.migrationId
      ) {
        throw new Error(payload.message || 'Unable to start migration.')
      }

      const eventSource = new EventSource(
        `${apiBaseUrl}/api/migrations/${migrationScan.migrationId}/events`,
      )
      migrationEventSourceRef.current = eventSource

      eventSource.addEventListener('progress', (event) => {
        const progressPayload = JSON.parse(
          (event as MessageEvent<string>).data,
        ) as MigrationProgressPayload
        updateMigrationProgress(progressPayload, 'running')
      })

      eventSource.addEventListener('complete', (event) => {
        const completePayload = JSON.parse(
          (event as MessageEvent<string>).data,
        ) as MigrationProgressPayload
        closeMigrationEventSource()
        updateMigrationProgress(completePayload, 'complete')

        void fetchMigrationResult(migrationScan.migrationId)
          .catch((caughtError) => {
            const message =
              caughtError instanceof Error
                ? caughtError.message
                : 'Unable to load completed migration results.'

            setMigrationResultError(message)
            setMigrationProgress((currentProgress) => ({
              ...currentProgress,
              status: 'error',
              message,
            }))
            toast.current?.show({
              severity: 'error',
              summary: 'Migration result failed',
              detail: message,
              life: 5200,
            })
          })
          .finally(() => {
            setIsMigrationExecuting(false)
          })
      })

      eventSource.addEventListener('error', (event) => {
        const maybeMessageEvent = event as MessageEvent<string>
        const hasServerPayload =
          typeof maybeMessageEvent.data === 'string' &&
          maybeMessageEvent.data.length > 0

        const errorPayload = hasServerPayload
          ? (JSON.parse(maybeMessageEvent.data) as MigrationProgressPayload)
          : null
        const message =
          errorPayload?.message ||
          errorPayload?.error ||
          'Lost connection to the backend migration progress stream.'

        closeMigrationEventSource()
        setIsMigrationExecuting(false)
        setMigrationResultError(message)
        updateMigrationProgress(errorPayload ?? { message }, 'error')
        toast.current?.show({
          severity: 'error',
          summary: 'Migration failed',
          detail: message,
          life: 5600,
        })
      })
    } catch (caughtError) {
      closeMigrationEventSource()
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to start migration.'

      setIsMigrationExecuting(false)
      setMigrationResultError(message)
      setMigrationProgress((currentProgress) => ({
        ...currentProgress,
        status: 'error',
        message,
      }))
      toast.current?.show({
        severity: 'error',
        summary: 'Migration failed',
        detail: message,
        life: 5600,
      })
    }
  }

  const handleCloseMigrationResult = () => {
    if (isMigrationExecuting) {
      return
    }

    setMigrationResult(null)
    setMigrationResultError(null)
    setMigrationProgress(initialMigrationProgress)
    setIsMigrationScanDialogVisible(false)
  }

  const auditPercent = getAuditPercent(auditProgress)
  const autoCropPercent = getAutoCropPercent(autoCropProgress)
  const migrationPercent = getMigrationPercent(migrationProgress)
  const isAuditVisible = auditProgress.status !== 'idle'
  const isAuditActive =
    auditProgress.status === 'starting' || auditProgress.status === 'running'
  const isMigrationActive = isMigrationScanning || isMigrationExecuting
  const canExportToPremiere =
    selectedVideos.length > 0 &&
    premiereStatus?.status === 'ready' &&
    premierePresets.some(isPremierePresetAvailable) &&
    !isAuditActive &&
    !isTableLoading
  const canAutoCropSelected =
    selectedVideos.length > 0 &&
    !isAuditActive &&
    !isTableLoading &&
    !isAutoCropSubmitting &&
    !isPremiereImportSubmitting
  const canImportSelectedToPremiere =
    selectedVideos.length > 0 &&
    premiereStatus?.status === 'ready' &&
    !isAuditActive &&
    !isTableLoading &&
    !isPremiereImportSubmitting
  const canStartMigration =
    Boolean(auditedRootDirectory) &&
    !isAuditActive &&
    !isTableLoading &&
    !isMigrationActive

  return {
    auditedRootDirectory,
    autoCropError,
    autoCropPercent,
    autoCropProgress,
    autoCropResult,
    auditPercent,
    auditProgress,
    error,
    fileName,
    folderPathInputRef,
    folderPathTestSummary,
    globalFilter,
    handleCloseMigrationDialog,
    handleCloseMigrationResult,
    handleCloseMigrationScan,
    handleClearData,
    checkPremiereStatus,
    handleCloseAutoCropDialog,
    handleCloseAutoCropResult,
    handleClosePremiereExportDialog,
    handleFolderPathSelect,
    handleExecuteMigration,
    handleMigrationNewEditedDirChange,
    handleNewEditedFolderSelect,
    handleOpenAutoCropDialog,
    handleOpenFolderPathTest,
    handleOpenMigrationDialog,
    handleOpenPremiereExportDialog,
    handleOpenSelectedFilesAudit,
    handleRefreshData,
    handleSelectNewEditedFolderClick,
    handleStartMigrationScan,
    handleSubmitAutoCrop,
    handleSubmitPremiereImport,
    handleSubmitPremiereExport,
    handleSelectedFilesSelect,
    includeLowResolutionAnalysis,
    includeBlackBorderAnalysis,
    isAuditActive,
    isAuditVisible,
    isAutoCropDialogVisible,
    isAutoCropSubmitting,
    isPremiereImportSubmitting,
    isMigrationExecuting,
    isMigrationScanDialogVisible,
    isMigrationScanning,
    isPremiereExportDialogVisible,
    isPremiereExportSubmitting,
    isPersisted,
    isPremiereStatusLoading,
    isTableLoading,
    migrationNewEditedDir,
    migrationPercent,
    migrationProgress,
    migrationResult,
    migrationResultError,
    migrationScan,
    migrationScanError,
    newEditedFolderInputRef,
    premiereExportError,
    premierePresets,
    premiereStatus,
    selectedPremierePresetId,
    selectedVideos,
    selectedFilesInputRef,
    canRefresh: Boolean(storedPayload),
    canAutoCropSelected,
    canImportSelectedToPremiere,
    canStartMigration,
    canExportToPremiere,
    setIncludeLowResolutionAnalysis,
    setIncludeBlackBorderAnalysis,
    setSelectedPremierePresetId,
    setSelectedVideos,
    setGlobalFilter,
    toast,
    videoRows,
  }
}
