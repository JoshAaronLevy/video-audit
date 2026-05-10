import type { ChangeEvent, RefObject } from 'react'
import { Button } from 'primereact/button'
import { FileUpload } from 'primereact/fileupload'
import type { FileUploadSelectEvent } from 'primereact/fileupload'
import { Message } from 'primereact/message'
import type { FileUpload as FileUploadRef } from 'primereact/fileupload'
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
  fileUploadRef: RefObject<FileUploadRef | null>
  folderPathInputRef: RefObject<HTMLInputElement | null>
  folderPathTestSummary: FolderPathTestSummary | null
  isAuditActive: boolean
  isAuditVisible: boolean
  onFileSelect: (event: FileUploadSelectEvent) => void
  onFolderAuditClick: () => void
  onFolderPathSelect: (event: ChangeEvent<HTMLInputElement>) => void
  videoRows: VideoRow[] | null
}

export function UploadPanel({
  auditPercent,
  auditProgress,
  error,
  fileUploadRef,
  folderPathInputRef,
  folderPathTestSummary,
  isAuditActive,
  isAuditVisible,
  onFileSelect,
  onFolderAuditClick,
  onFolderPathSelect,
  videoRows,
}: UploadPanelProps) {
  return (
    <section className="upload-panel" aria-labelledby="upload-heading">
      <p className="eyebrow">Video Audit</p>
      <h1 id="upload-heading">Load a JSON file to view your video table.</h1>
      {!videoRows && (
        <p className="subcopy">
          Start by choosing a JSON file that contains an array of video records.
        </p>
      )}

      {!videoRows && (
        <div className="upload-actions">
          <FileUpload
            ref={fileUploadRef}
            mode="basic"
            name="videos"
            accept="application/json,.json"
            chooseLabel="Choose JSON file"
            customUpload
            auto
            onSelect={onFileSelect}
            className="upload-button"
            chooseOptions={{
              className: 'upload-button',
            }}
          />
          <Button
            type="button"
            label="Audit selected folder"
            severity="secondary"
            outlined
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
          {folderPathTestSummary.videoFileCount.toLocaleString()} video files
          found
          {folderPathTestSummary.firstRelativePath
            ? `; first path: ${folderPathTestSummary.firstRelativePath}`
            : ''}
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
