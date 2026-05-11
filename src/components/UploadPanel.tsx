import type { ChangeEvent, RefObject } from 'react'
import { Button } from 'primereact/button'
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
  isAuditActive: boolean
  isAuditVisible: boolean
  onFolderAuditClick: () => void
  onFolderPathSelect: (event: ChangeEvent<HTMLInputElement>) => void
  videoRows: VideoRow[] | null
}

export function UploadPanel({
  auditPercent,
  auditProgress,
  error,
  folderPathInputRef,
  folderPathTestSummary,
  isAuditActive,
  isAuditVisible,
  onFolderAuditClick,
  onFolderPathSelect,
  videoRows,
}: UploadPanelProps) {
  return (
    <section className="upload-panel" aria-labelledby="upload-heading">
      <p className="eyebrow">Video Audit</p>
      <h2 id="upload-heading">Select a folder to scan for low resolution videos</h2>

      {!videoRows && (
        <div className="upload-actions">
          <Button
            type="button"
            label="Scan folder"
            className="upload-button"
            disabled={isAuditActive}
            onClick={onFolderAuditClick}
          />
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
          Folder selection:{' '}
          {folderPathTestSummary.videoFileCount.toLocaleString()} videos found
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
