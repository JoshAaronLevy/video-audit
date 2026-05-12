import { Button } from 'primereact/button'
import { Column } from 'primereact/column'
import { DataTable } from 'primereact/datatable'
import { Dialog } from 'primereact/dialog'
import { InputText } from 'primereact/inputtext'
import { Message } from 'primereact/message'
import { ProgressBar } from 'primereact/progressbar'
import { Tag } from 'primereact/tag'
import {
  formatBytes,
  formatProgressNumber,
  formatSignedBytes,
  formatSignedInteger,
} from '../helpers/utils'
import type {
  MigrationProgress,
  MigrationScanItem,
  MigrationScanResponse,
} from '../types/migration'

type MigrationScanDialogProps = {
  auditedRootDirectory: string | null
  error: string | null
  isExecuting: boolean
  isScanning: boolean
  migrationPercent: number | null
  newEditedDir: string
  onExecute: () => void
  onHide: () => void
  onNewEditedDirChange: (value: string) => void
  onSelectFolderClick: () => void
  onStartScan: () => void
  progress: MigrationProgress
  resultError: string | null
  scan: MigrationScanResponse | null
  visible: boolean
}

const formatCount = (value: number) => value.toLocaleString()

const summaryItems = (scan: MigrationScanResponse) => [
  {
    label: 'New files found',
    value: formatCount(scan.summary.newFilesFound),
  },
  {
    label: 'Files with existing external matches',
    value: formatCount(scan.summary.filesWithMatches),
  },
  {
    label: 'Files without existing matches',
    value: formatCount(scan.summary.filesWithoutMatches),
  },
  {
    label: 'Old destination files to archive',
    value: formatCount(scan.summary.totalDestinationMatchesToArchive),
  },
  {
    label: 'Multi-match files',
    value: formatCount(scan.summary.multiMatchFiles),
  },
  {
    label: 'New bytes to copy',
    value: formatBytes(scan.summary.newBytesToCopy),
  },
  {
    label: 'Old bytes to archive',
    value: formatBytes(scan.summary.oldBytesToArchive),
  },
  {
    label: 'Net active file delta',
    value: formatSignedInteger(scan.summary.netActiveFileDelta),
  },
  {
    label: 'Net active storage delta',
    value: formatSignedBytes(scan.summary.netActiveBytesDelta),
  },
  {
    label: 'Potential reclaimable space if archive is later deleted',
    value: formatBytes(scan.summary.potentialBytesReclaimableIfArchiveDeleted),
  },
]

const matchStatusTemplate = (item: MigrationScanItem) => {
  if (item.matchCount > 1) {
    return (
      <div className="migration-table-tags">
        <Tag value={`${formatCount(item.matchCount)} old copies`} severity="warning" />
        <span>Multiple old copies found</span>
      </div>
    )
  }

  if (item.matchCount === 1) {
    return (
      <div className="migration-table-tags">
        <Tag value="1 old copy" severity="info" />
        <span>Will archive matching external file</span>
      </div>
    )
  }

  return (
    <div className="migration-table-tags">
      <Tag value="New file" severity="success" />
      <span>New file; no old external copy found</span>
    </div>
  )
}

const pathTemplate = (value: string) => <code>{value}</code>

const warningsTemplate = (item: MigrationScanItem) =>
  item.warnings.length > 0 ? (
    <ul className="migration-warning-list">
      {item.warnings.map((warning) => (
        <li key={warning}>{warning}</li>
      ))}
    </ul>
  ) : (
    <span className="cell-muted">None</span>
  )

const oldMatchesTemplate = (item: MigrationScanItem) =>
  item.matches.length > 0 ? (
    <ul className="migration-match-list">
      {item.matches.slice(0, 3).map((match) => (
        <li key={match.originalPath}>
          <span>{match.originalRelativePath}</span>
          <small>{formatBytes(match.sizeBytes)}</small>
        </li>
      ))}
      {item.matches.length > 3 && (
        <li>
          <span>{formatCount(item.matches.length - 3)} more</span>
        </li>
      )}
    </ul>
  ) : (
    <span className="cell-muted">No old external copy found</span>
  )

export function MigrationScanDialog({
  auditedRootDirectory,
  error,
  isExecuting,
  isScanning,
  migrationPercent,
  newEditedDir,
  onExecute,
  onHide,
  onNewEditedDirChange,
  onSelectFolderClick,
  onStartScan,
  progress,
  resultError,
  scan,
  visible,
}: MigrationScanDialogProps) {
  const isBusy = isScanning || isExecuting
  const canExecute = Boolean(scan) && !isBusy
  const canStartScan = Boolean(auditedRootDirectory && newEditedDir.trim()) && !isBusy
  const footer = scan ? (
    <div className="migration-dialog-actions">
      <Button
        type="button"
        label="Cancel"
        severity="secondary"
        text
        disabled={isBusy}
        onClick={onHide}
      />
      <Button
        type="button"
        label="Copy New Files and Archive Old Copies"
        disabled={!canExecute}
        loading={isExecuting}
        onClick={onExecute}
      />
    </div>
  ) : (
    <div className="migration-dialog-actions">
      <Button
        type="button"
        label="Cancel"
        severity="secondary"
        text
        disabled={isBusy}
        onClick={onHide}
      />
      <Button
        type="button"
        label="Scan New Edits"
        disabled={!canStartScan}
        loading={isScanning}
        onClick={() => onStartScan()}
      />
    </div>
  )

  return (
    <Dialog
      header="Migrate New Edits"
      visible={visible}
      modal
      draggable={false}
      className="migration-dialog"
      footer={footer}
      onHide={onHide}
    >
      <div className="migration-dialog-content">
        <Message
          severity="info"
          text="Copy newly edited videos into the audited destination folder and archive older matching files. Source files are not moved or deleted."
          role="status"
        />

        <div className="migration-paths">
          <div>
            <span>Audited destination folder</span>
            <code>{auditedRootDirectory || 'Run an audit first'}</code>
          </div>
          <div>
            <span>New edited videos folder</span>
            <div className="migration-folder-row">
              <InputText
                value={newEditedDir}
                placeholder="/Users/joshlevy/Movies/Edited"
                disabled={isBusy}
                onChange={(event) => onNewEditedDirChange(event.target.value)}
              />
              <Button
                type="button"
                label="Select Folder"
                severity="secondary"
                outlined
                disabled={isBusy}
                onClick={onSelectFolderClick}
              />
            </div>
          </div>
        </div>

        {!scan && (
          <ul className="migration-notes">
            <li>New edited files are copied into the destination root as a flat folder.</li>
            <li>Old external matches are moved to a timestamped Archive folder.</li>
            <li>Actual drive space is not reclaimed until you manually delete the archive.</li>
          </ul>
        )}

        {isScanning && (
          <Message
            severity="info"
            text="Scanning the new edits folder and matching exact filenames against the audited destination root..."
            role="status"
          />
        )}

        {scan && (
          <>
            <div className="migration-summary-grid">
              {summaryItems(scan).map((item) => (
                <div key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>

            <div className="migration-paths">
              <div>
                <span>Archive run folder</span>
                <code>{scan.archiveRunDir}</code>
              </div>
            </div>

            {scan.warnings.length > 0 && (
              <Message
                severity="warn"
                text={scan.warnings.join(' ')}
                role="status"
              />
            )}

            {isExecuting && (
              <div className="migration-progress">
                <ProgressBar value={migrationPercent ?? 0} />
                <p>
                  {progress.message || 'Copying new files and archiving old copies...'}
                  {progress.currentFile ? ` ${progress.currentFile}` : ''}
                </p>
                <div className="migration-progress-counts">
                  <span>
                    {formatProgressNumber(progress.processedFiles)} /{' '}
                    {formatProgressNumber(progress.totalFiles)}
                  </span>
                  <span>{formatProgressNumber(progress.copiedCount)} copied</span>
                  <span>{formatProgressNumber(progress.archivedCount)} archived</span>
                  <span>{formatProgressNumber(progress.failedCount)} failed</span>
                  {progress.phase && <span>{progress.phase}</span>}
                </div>
              </div>
            )}

            <DataTable
              value={scan.items}
              className="migration-review-table"
              dataKey="sourcePath"
              paginator
              rows={10}
              rowsPerPageOptions={[10, 25, 50, 100]}
              emptyMessage="No migration items found."
              scrollable
              scrollHeight="360px"
            >
              <Column field="fileName" header="File Name" sortable />
              <Column
                field="matchCount"
                header="Old Matches"
                body={matchStatusTemplate}
                sortable
              />
              <Column
                field="sourceSizeBytes"
                header="Source Size"
                body={(item: MigrationScanItem) => formatBytes(item.sourceSizeBytes)}
                sortable
              />
              <Column
                field="finalDestinationPath"
                header="Final Destination"
                body={(item: MigrationScanItem) =>
                  pathTemplate(item.finalDestinationPath)
                }
              />
              <Column header="Old Copies To Archive" body={oldMatchesTemplate} />
              <Column header="Warnings" body={warningsTemplate} />
            </DataTable>
          </>
        )}

        {error && (
          <Message severity="error" text={error} className="migration-error" role="alert" />
        )}
        {resultError && (
          <Message
            severity="error"
            text={resultError}
            className="migration-error"
            role="alert"
          />
        )}
      </div>
    </Dialog>
  )
}
