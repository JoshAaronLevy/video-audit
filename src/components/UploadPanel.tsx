import type { ChangeEvent, RefObject } from 'react'
import { Button } from 'primereact/button'
import { Checkbox } from 'primereact/checkbox'
import { Message } from 'primereact/message'
import { AuditProgressPanel } from './AuditProgressPanel'
import { DirectoryInput } from './DirectoryInput'
import type {
  AuditProgress,
  FolderPathTestSummary,
  VideoRow,
} from '../types/video'

type UploadPanelProps = {
  auditPercent: number | null
  auditProgress: AuditProgress
  error: string | null
  folderPathInputRef: RefObject<HTMLInputElement | null>
  folderPathTestSummary: FolderPathTestSummary | null
  includeLowResolutionAnalysis: boolean
  includeBlackBorderAnalysis: boolean
  isAuditActive: boolean
  isAuditVisible: boolean
  onFolderAuditClick: () => void
  onFolderPathSelect: (event: ChangeEvent<HTMLInputElement>) => void
  onIncludeLowResolutionAnalysisChange: (value: boolean) => void
  onIncludeBlackBorderAnalysisChange: (value: boolean) => void
  videoRows: VideoRow[] | null
}

export function UploadPanel({
  auditPercent,
  auditProgress,
  error,
  folderPathInputRef,
  folderPathTestSummary,
  includeLowResolutionAnalysis,
  includeBlackBorderAnalysis,
  isAuditActive,
  isAuditVisible,
  onFolderAuditClick,
  onFolderPathSelect,
  onIncludeLowResolutionAnalysisChange,
  onIncludeBlackBorderAnalysisChange,
  videoRows,
}: UploadPanelProps) {
  const canStartAudit =
    !isAuditActive && (includeLowResolutionAnalysis || includeBlackBorderAnalysis)

  return (
    <section className="upload-panel" aria-labelledby="upload-heading">
      <p className="eyebrow">Video Audit</p>

      {!videoRows && (
        <h2 id="upload-heading">Select a folder to audit videos</h2>
      )}

      {!videoRows && (
        <div className="upload-control-stack">
          <div className="audit-options" aria-label="Audit options">
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
                  Detects nested black borders and crop candidates. Slower on
                  large folders.
                </small>
              </label>
            </div>
          </div>
          <div className="upload-actions">
            <Button
              type="button"
              label="Scan folder"
              className="upload-button"
              disabled={!canStartAudit}
              onClick={onFolderAuditClick}
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

      {isAuditVisible && (
        <AuditProgressPanel
          auditPercent={auditPercent}
          auditProgress={auditProgress}
          isAuditActive={isAuditActive}
        />
      )}

      {folderPathTestSummary && (
        <p className="file-status" aria-live="polite">
          Auditing{' '}
          {folderPathTestSummary.videoFileCount.toLocaleString()} videos
        </p>
      )}

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
