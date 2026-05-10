import type { RefObject } from 'react'
import { Button } from 'primereact/button'
import { Column } from 'primereact/column'
import { DataTable } from 'primereact/datatable'
import { FilterMatchMode } from 'primereact/api'
import { FileUpload } from 'primereact/fileupload'
import type {
  FileUpload as FileUploadRef,
  FileUploadSelectEvent,
} from 'primereact/fileupload'
import { InputText } from 'primereact/inputtext'
import { Tag } from 'primereact/tag'
import type { VideoRow } from '../types/video'
import {
  formatDate,
  formatDuration,
  formatNumber,
  getRowDisplayFile,
  globalFilterFields,
} from '../helpers/utils'

type VideoTableProps = {
  fileName: string | null
  fileUploadRef: RefObject<FileUploadRef | null>
  globalFilter: string
  isAuditActive: boolean
  isPersisted: boolean
  onClearData: () => void
  onFileSelect: (event: FileUploadSelectEvent) => void
  onFolderAuditClick: () => void
  onGlobalFilterChange: (value: string) => void
  videoRows: VideoRow[]
}

const fileTemplate = (row: VideoRow) => {
  const displayFile = getRowDisplayFile(row)

  return (
    <div className="cell-stack file-cell">
      <span>{displayFile}</span>
    </div>
  )
}

const storageTemplate = (row: VideoRow) => (
  <div className="cell-stack">
    <span>{formatNumber(row.sizeMB)} MB</span>
  </div>
)

const mediaTemplate = (row: VideoRow) => (
  <div className="cell-stack">
    <span>
      {[row.width, row.height].filter((value) => value !== null).join('x')}
    </span>
    <span className="cell-muted">
      {row.displayAspectRatio} aspect, {formatDuration(row.durationSeconds)}
    </span>
    <span className="cell-muted">
      {formatNumber(row.bitRateMbps, 3)} Mbps,{' '}
      {formatNumber(row.frameRate, 3)} FPS
    </span>
  </div>
)

const dateTemplate = (row: VideoRow) => (
  <div className="cell-stack">
    <span>Modified {formatDate(row.modifiedAt)}</span>
    <span className="cell-muted">Created {formatDate(row.createdAt)}</span>
  </div>
)

const issueTemplate = (row: VideoRow) => (
  <div className="cell-stack issue-cell">
    <div className="issue-tags">
      <Tag
        severity={row.isLowResolution ? 'danger' : 'success'}
        value={row.isLowResolution ? 'Low res' : 'Resolution ok'}
      />
      <Tag
        severity={row.isWrongAspectRatio ? 'danger' : 'success'}
        value={row.isWrongAspectRatio ? 'Wrong aspect' : 'Aspect ok'}
      />
    </div>
    <span className="cell-muted">{row.reasons || 'No issues detected'}</span>
  </div>
)

export function VideoTable({
  fileName,
  fileUploadRef,
  globalFilter,
  isAuditActive,
  isPersisted,
  onClearData,
  onFileSelect,
  onFolderAuditClick,
  onGlobalFilterChange,
  videoRows,
}: VideoTableProps) {
  const tableHeader = (
    <div className="table-header">
      <div>
        <h2>Videos</h2>
        <p>
          {videoRows.length.toLocaleString()} records
          {fileName ? ` from ${fileName}` : ''}
          {isPersisted ? ' saved locally' : ''}
        </p>
      </div>
      <div className="table-actions">
        <InputText
          value={globalFilter}
          onChange={(event) => onGlobalFilterChange(event.target.value)}
          placeholder="Search videos"
          aria-label="Search videos"
        />
        <FileUpload
          ref={fileUploadRef}
          mode="basic"
          name="videos"
          accept="application/json,.json"
          chooseLabel="Load another file"
          customUpload
          auto
          onSelect={onFileSelect}
          className="table-upload"
          chooseOptions={{
            className: 'p-button-outlined',
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
        <Button
          type="button"
          label="Clear"
          severity="secondary"
          text
          onClick={onClearData}
        />
      </div>
    </div>
  )

  return (
    <section className="table-section" aria-label="Loaded videos">
      <DataTable
        value={videoRows}
        header={tableHeader}
        dataKey="path"
        className="video-table"
        paginator
        rows={10}
        rowsPerPageOptions={[10, 25, 50, 100]}
        sortMode="multiple"
        removableSort
        filterDisplay="row"
        globalFilter={globalFilter}
        globalFilterFields={globalFilterFields}
        stripedRows
        showGridlines
        responsiveLayout="stack"
        emptyMessage="No videos found."
      >
        <Column
          field="displayFile"
          filterField="displayDirectory"
          header="File"
          sortable
          filter
          filterMatchMode={FilterMatchMode.CONTAINS}
          filterPlaceholder="Filter directory"
          showFilterMenu={false}
          body={fileTemplate}
          style={{ width: '32%' }}
        />
        <Column
          field="sizeMB"
          header="Storage"
          sortable
          dataType="numeric"
          body={storageTemplate}
          style={{ width: '14%' }}
        />
        <Column
          field="durationSeconds"
          header="Media"
          sortable
          dataType="numeric"
          body={mediaTemplate}
          style={{ width: '18%' }}
        />
        <Column
          field="modifiedAt"
          header="Dates"
          sortable
          body={dateTemplate}
          style={{ width: '15%' }}
        />
        <Column
          field="reasons"
          header="Issues"
          sortable
          body={issueTemplate}
          style={{ width: '21%' }}
        />
      </DataTable>
    </section>
  )
}
