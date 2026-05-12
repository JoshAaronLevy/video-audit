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
  includeBlackBorderAnalysis: boolean
  isAuditActive: boolean
  isAuditVisible: boolean
  onFolderAuditClick: () => void
  onFolderPathSelect: (event: ChangeEvent<HTMLInputElement>) => void
  onIncludeBlackBorderAnalysisChange: (value: boolean) => void
  videoRows: VideoRow[] | null
}

export function UploadPanel({
  auditPercent,
  auditProgress,
  error,
  folderPathInputRef,
  folderPathTestSummary,
  includeBlackBorderAnalysis,
  isAuditActive,
  isAuditVisible,
  onFolderAuditClick,
  onFolderPathSelect,
  onIncludeBlackBorderAnalysisChange,
  videoRows,
}: UploadPanelProps) {
  return (
    <section className="upload-panel" aria-labelledby="upload-heading">
      <p className="eyebrow">Video Audit</p>

      {!videoRows && (
        <h2 id="upload-heading">Select a folder to scan for low resolution videos</h2>
      )}

      {!videoRows && (
        <div className="upload-control-stack">
          <div className="black-border-option">
            <Checkbox
              inputId="include-black-border-analysis"
              checked={includeBlackBorderAnalysis}
              disabled={isAuditActive}
              onChange={(event) =>
                onIncludeBlackBorderAnalysisChange(Boolean(event.checked))
              }
            />
            <label htmlFor="include-black-border-analysis">
              <span>Include black-border analysis</span>
              <small>
                Detects nested black borders and crop candidates. Slower on large
                folders.
              </small>
            </label>
          </div>
          <div className="upload-actions">
            <Button
              type="button"
              label="Scan folder"
              className="upload-button"
              disabled={isAuditActive}
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
