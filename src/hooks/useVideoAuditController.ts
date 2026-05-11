import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Toast } from 'primereact/toast'
import {
  apiBaseUrl,
  clearStoredVideoData,
  getAuditPercent,
  initialAuditProgress,
  loadStoredVideoData,
  mergeAuditProgress,
  saveVideoData,
  toFolderPathManifest,
  toVideoRow,
} from '../helpers/utils'
import type {
  AuditProgress,
  AuditProgressPayload,
  AuditRequestPayload,
  AuditResultResponse,
  AuditStartResponse,
  FolderPathTestSummary,
  StoredVideoData,
  VideoRow,
} from '../types/video'

export function useVideoAuditController() {
  const [initialData] = useState<StoredVideoData | null>(() =>
    loadStoredVideoData(),
  )
  const folderPathInputRef = useRef<HTMLInputElement | null>(null)
  const auditEventSourceRef = useRef<EventSource | null>(null)
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
  const [isPersisted, setIsPersisted] = useState(() => Boolean(initialData))
  const [isTableLoading, setIsTableLoading] = useState(false)
  const [globalFilter, setGlobalFilter] = useState('')
  const [folderPathTestSummary, setFolderPathTestSummary] =
    useState<FolderPathTestSummary | null>(null)
  const [auditProgress, setAuditProgress] =
    useState<AuditProgress>(initialAuditProgress)

  const closeAuditEventSource = () => {
    auditEventSourceRef.current?.close()
    auditEventSourceRef.current = null
  }

  useEffect(() => {
    return () => {
      closeAuditEventSource()
    }
  }, [])

  const updateAuditProgress = (
    payload: AuditProgressPayload,
    status: AuditProgress['status'] = 'running',
  ) => {
    setAuditProgress((currentProgress) =>
      mergeAuditProgress(currentProgress, payload, status),
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
    requestPayloadJson: string,
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
    setFileName(nextFileName)
    setStoredPayload(requestPayloadJson)
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
    try {
      const requestPayload = parseAuditRequestPayload(requestPayloadJson)

      closeAuditEventSource()
      setError(null)
      setGlobalFilter('')

      if (videoRows !== null) {
        setVideoRows([])
        setIsTableLoading(true)
      }

      setAuditProgress({
        ...initialAuditProgress,
        status: 'starting',
        phase: 'resolve',
        message: 'Resolving selected folder...',
      })

      const response = await fetch(`${apiBaseUrl}/api/audits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload),
      })
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
    }

    await startAudit(JSON.stringify(requestPayload))
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
    clearStoredVideoData()
    setVideoRows(null)
    setFileName(null)
    setStoredPayload(null)
    setGlobalFilter('')
    setIsPersisted(false)
    setIsTableLoading(false)
    setFolderPathTestSummary(null)
    setError(null)
    setAuditProgress(initialAuditProgress)
  }

  const auditPercent = getAuditPercent(auditProgress)
  const isAuditVisible = auditProgress.status !== 'idle'
  const isAuditActive =
    auditProgress.status === 'starting' || auditProgress.status === 'running'

  return {
    auditPercent,
    auditProgress,
    error,
    fileName,
    folderPathInputRef,
    folderPathTestSummary,
    globalFilter,
    handleClearData,
    handleFolderPathSelect,
    handleOpenFolderPathTest,
    handleRefreshData,
    isAuditActive,
    isAuditVisible,
    isPersisted,
    isTableLoading,
    canRefresh: Boolean(storedPayload),
    setGlobalFilter,
    toast,
    videoRows,
  }
}
