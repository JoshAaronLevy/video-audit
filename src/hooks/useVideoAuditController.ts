import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { FileUpload } from 'primereact/fileupload'
import type { FileUploadSelectEvent } from 'primereact/fileupload'
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
  AuditResultResponse,
  AuditStartResponse,
  FolderPathTestSummary,
  StoredVideoData,
  VideoRow,
  VideoSource,
} from '../types/video'

export function useVideoAuditController() {
  const [initialData] = useState<StoredVideoData | null>(() =>
    loadStoredVideoData(),
  )
  const fileUploadRef = useRef<FileUpload>(null)
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
  const [isPersisted, setIsPersisted] = useState(() => Boolean(initialData))
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

  const handleAuditResult = async (
    jobId: string,
    resolvedDirectory: string | null,
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

    setVideoRows(trimmedRows)
    setFileName(`Audit: ${displayDirectory}`)
    setIsPersisted(false)
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
      severity: 'success',
      summary: 'Audit complete',
      detail: `${result.summary.flaggedCount.toLocaleString()} flagged videos found.`,
      life: 4200,
    })
  }

  const loadSelectedFile = async (selectedFile: File | undefined) => {
    if (!selectedFile) {
      return
    }

    try {
      closeAuditEventSource()
      setAuditProgress(initialAuditProgress)
      setError(null)
      const fileContents = await selectedFile.text()
      const parsedData: unknown = JSON.parse(fileContents)

      if (!Array.isArray(parsedData)) {
        throw new Error('The selected JSON file must contain an array of videos.')
      }

      const trimmedRows = parsedData.map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          throw new Error('Each video record in the JSON file must be an object.')
        }

        return toVideoRow(item as VideoSource)
      })

      const persisted = saveVideoData({
        fileName: selectedFile.name,
        rows: trimmedRows,
      })

      setVideoRows(trimmedRows)
      setFileName(selectedFile.name)
      setIsPersisted(persisted)
      setGlobalFilter('')
      toast.current?.show({
        severity: persisted ? 'success' : 'warn',
        summary: 'JSON loaded',
        detail: persisted
          ? `${trimmedRows.length.toLocaleString()} videos found and saved locally.`
          : `${trimmedRows.length.toLocaleString()} videos found, but could not be saved for refresh.`,
        life: 4200,
      })
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to load this JSON file.'

      setError(message)
    } finally {
      fileUploadRef.current?.clear()
    }
  }

  const handleFileSelect = (event: FileUploadSelectEvent) => {
    void loadSelectedFile(event.files[0])
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

    try {
      closeAuditEventSource()
      setError(null)
      setAuditProgress({
        ...initialAuditProgress,
        status: 'starting',
        phase: 'resolve',
        message: 'Resolving selected folder...',
      })

      const response = await fetch(`${apiBaseUrl}/api/audits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rootPath: sampleFile.rootPath,
          sampleFile,
        }),
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

        void handleAuditResult(jobId, resolvedDirectory).catch((caughtError) => {
          const message =
            caughtError instanceof Error
              ? caughtError.message
              : 'Unable to load completed audit results.'

          setError(message)
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

  const handleClearData = () => {
    closeAuditEventSource()
    clearStoredVideoData()
    setVideoRows(null)
    setFileName(null)
    setGlobalFilter('')
    setIsPersisted(false)
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
    fileUploadRef,
    folderPathInputRef,
    folderPathTestSummary,
    globalFilter,
    handleClearData,
    handleFileSelect,
    handleFolderPathSelect,
    handleOpenFolderPathTest,
    isAuditActive,
    isAuditVisible,
    isPersisted,
    setGlobalFilter,
    toast,
    videoRows,
  }
}
