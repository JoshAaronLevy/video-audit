import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, RefObject } from 'react'
import { Button } from 'primereact/button'
import { Checkbox } from 'primereact/checkbox'
import { Message } from 'primereact/message'
import { Toast } from 'primereact/toast'
import { AuditProgressPanel } from './AuditProgressPanel'
import { DirectoryInput } from './DirectoryInput'
import { apiBaseUrl } from '../helpers/utils'
import type {
  AuditProgress,
  FolderPathTestSummary,
  VideoRow,
} from '../types/video'

type EditedFolderStatusCode = 'ready' | 'not_found' | 'error'

type EditedFolderStatusResponse = {
  status: EditedFolderStatusCode
  path: string
  message: string
}

type UploadPanelProps = {
  auditPercent: number | null
  auditProgress: AuditProgress
  error: string | null
  folderPathInputRef: RefObject<HTMLInputElement | null>
  selectedFilesInputRef: RefObject<HTMLInputElement | null>
  folderPathTestSummary: FolderPathTestSummary | null
  includeSubfolders: boolean
  includeLowResolutionAnalysis: boolean
  includeBlackBorderAnalysis: boolean
  isAuditActive: boolean
  onFolderAuditClick: () => void
  onFilesAuditClick: () => void
  onCancelAudit: () => void
  onFolderPathSelect: (event: ChangeEvent<HTMLInputElement>) => void
  onSelectedFilesSelect: (event: ChangeEvent<HTMLInputElement>) => void
  onIncludeSubfoldersChange: (value: boolean) => void
  onIncludeLowResolutionAnalysisChange: (value: boolean) => void
  onIncludeBlackBorderAnalysisChange: (value: boolean) => void
  videoRows: VideoRow[] | null
}

export function UploadPanel({
  auditPercent,
  auditProgress,
  error,
  folderPathInputRef,
  selectedFilesInputRef,
  folderPathTestSummary,
  includeSubfolders,
  includeLowResolutionAnalysis,
  includeBlackBorderAnalysis,
  isAuditActive,
  onFolderAuditClick,
  onFilesAuditClick,
  onCancelAudit,
  onFolderPathSelect,
  onSelectedFilesSelect,
  onIncludeSubfoldersChange,
  onIncludeLowResolutionAnalysisChange,
  onIncludeBlackBorderAnalysisChange,
  videoRows,
}: UploadPanelProps) {
  const editedFolderToast = useRef<Toast>(null)
  const [editedFolderStatus, setEditedFolderStatus] =
    useState<EditedFolderStatusResponse | null>(null)
  const [isEditedFolderStatusLoading, setIsEditedFolderStatusLoading] =
    useState(false)
  const canStartAudit =
    !isAuditActive && (includeLowResolutionAnalysis || includeBlackBorderAnalysis)
  const showUploadControls = !videoRows && !isAuditActive

  const checkEditedFolderStatus = useCallback(async () => {
    setIsEditedFolderStatusLoading(true)

    try {
      const response = await fetch(`${apiBaseUrl}/api/storage/edited-folder/status`)

      if (!response.ok) {
        throw new Error('Unable to check edited videos folder status.')
      }

      const payload = (await response.json()) as EditedFolderStatusResponse

      setEditedFolderStatus(payload)
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to check edited videos folder status.'

      console.error('[Storage] Edited folder status check failed', caughtError)

      setEditedFolderStatus({
        status: 'error',
        path: '/Volumes/SanDisk SSD/Videos/Edited',
        message,
      })
    } finally {
      setIsEditedFolderStatusLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!showUploadControls) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      void checkEditedFolderStatus()
    }, 0)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [checkEditedFolderStatus, showUploadControls])

  useEffect(() => {
    if (!showUploadControls || editedFolderStatus?.status === 'ready') {
      editedFolderToast.current?.clear()
      return
    }

    if (!editedFolderStatus) {
      return
    }

    editedFolderToast.current?.replace({
      id: 'edited-folder-status',
      severity: editedFolderStatus.status === 'error' ? 'error' : 'warn',
      sticky: true,
      closable: false,
      className: 'premiere-status-toast-message',
      content: () => (
        <div className="premiere-status-toast-content" role="status">
          <span className="premiere-status-toast-text">
            {editedFolderStatus.message ||
              `${editedFolderStatus.path} could not be found.`}
          </span>
          <Button
            type="button"
            label="Retry"
            severity="info"
            raised
            loading={isEditedFolderStatusLoading}
            onClick={checkEditedFolderStatus}
          />
        </div>
      ),
    })
  }, [
    checkEditedFolderStatus,
    editedFolderStatus,
    isEditedFolderStatusLoading,
    showUploadControls,
  ])

  return (
    <section className="upload-panel" aria-labelledby="upload-heading">
      <p className="eyebrow">Video Audit</p>

      {!videoRows && (
        <h2 id="upload-heading">Select folder(s) or files to audit videos</h2>
      )}

      {isAuditActive && (
        <AuditProgressPanel
          auditPercent={auditPercent}
          auditProgress={auditProgress}
          isAuditActive={isAuditActive}
          onCancelAudit={onCancelAudit}
        />
      )}

      {isAuditActive && folderPathTestSummary && (
        <p className="file-status" aria-live="polite">
          Auditing{' '}
          {folderPathTestSummary.videoFileCount.toLocaleString()} videos
        </p>
      )}

      {showUploadControls && (
        <div className="upload-control-stack">
          <Toast
            ref={editedFolderToast}
            appendTo="self"
            position="top-center"
            transitionOptions={{ timeout: 0 }}
            className="premiere-status-toast"
          />
          <div className="audit-options" aria-label="Audit options">
            <div className="audit-option">
              <Checkbox
                inputId="include-subfolders"
                checked={includeSubfolders}
                disabled={isAuditActive}
                onChange={(event) =>
                  onIncludeSubfoldersChange(Boolean(event.checked))
                }
              />
              <label htmlFor="include-subfolders">
                <span>Include subfolders</span>
                <small>
                  Scans videos inside the selected folder and all nested folders.
                </small>
              </label>
            </div>
            <div className="audit-option">
              <Checkbox
                inputId="include-low-resolution-analysis"
                checked={includeLowResolutionAnalysis}
                disabled={isAuditActive}
                onChange={(event) =>
                  onIncludeLowResolutionAnalysisChange(Boolean(event.checked))
                }
              />
              <label htmlFor="include-low-resolution-analysis">
                <span>Low-resolution scan</span>
                <small>
                  Flags videos below the target resolution or outside the expected
                  aspect ratio.
                </small>
              </label>
            </div>
            <div className="audit-option">
              <Checkbox
                inputId="include-black-border-analysis"
                checked={includeBlackBorderAnalysis}
                disabled={isAuditActive}
                onChange={(event) =>
                  onIncludeBlackBorderAnalysisChange(Boolean(event.checked))
                }
              />
              <label htmlFor="include-black-border-analysis">
                <span>Black-border analysis</span>
                <small>
                  Detects asymmetric or boxed borders and crop candidates.
                  Slower on large folders.
                </small>
              </label>
            </div>
          </div>
          <div className="upload-actions">
            <Button
              type="button"
              label="Select Folder(s)"
              severity="success"
              raised
              className="upload-button"
              disabled={!canStartAudit}
              onClick={onFolderAuditClick}
            />
            <Button
              type="button"
              label="Scan files"
              severity="info"
              raised
              className="upload-button upload-button-secondary"
              disabled={!canStartAudit}
              onClick={onFilesAuditClick}
            />
          </div>
        </div>
      )}

      <DirectoryInput
        ref={folderPathInputRef}
        type="file"
        multiple
        webkitdirectory=""
        onChange={onFolderPathSelect}
        style={{ display: 'none' }}
      />

      <DirectoryInput
        ref={selectedFilesInputRef}
        type="file"
        multiple
        accept="video/*,.mp4,.mov,.m4v,.mkv,.avi,.wmv,.webm,.mpeg,.mpg,.m2ts,.ts"
        onChange={onSelectedFilesSelect}
        style={{ display: 'none' }}
      />

      {error && (
        <Message
          severity="error"
          text={error}
          className="error-alert"
          role="alert"
        />
      )}
    </section>
  )
}
