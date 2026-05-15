import { Button } from 'primereact/button'
import { Column } from 'primereact/column'
import { DataTable } from 'primereact/datatable'
import { Dialog } from 'primereact/dialog'
import { Message } from 'primereact/message'
import {
  formatBytes,
  formatSignedBytes,
  formatSignedInteger,
} from '../helpers/utils'
import type {
  MigrationResult,
  MigrationResultItem,
  MigrationScanResponse,
} from '../types/migration'

type MigrationResultDialogProps = {
  error: string | null
  onHide: () => void
  result: MigrationResult | null
  scan: MigrationScanResponse | null
  visible: boolean
}

const formatCount = (value: number) => value.toLocaleString()

const failedItemsTemplate = (item: MigrationResultItem) => (
  <div className="migration-failed-item">
    <strong>{item.fileName}</strong>
    {item.error && <span>{item.error}</span>}
    {item.warnings && item.warnings.length > 0 && (
      <small>{item.warnings.join(' ')}</small>
    )}
  </div>
)

export function MigrationResultDialog({
  error,
  onHide,
  result,
  scan,
  visible,
}: MigrationResultDialogProps) {
  const failedItems =
    result?.items.filter((item) => item.status === 'failed') ?? []
  const archiveRunDir = result?.archiveRunDir || scan?.archiveRunDir || ''
  const footer = (
    <div className="migration-dialog-actions">
      <Button type="button" label="Close" severity="info" raised onClick={onHide} />
    </div>
  )

  return (
    <Dialog
      header="Migration Complete"
      visible={visible}
      modal
      draggable={false}
      className="migration-result-dialog"
      footer={footer}
      onHide={onHide}
    >
      <div className="migration-dialog-content">
        {result && (
          <>
            <Message
              severity={result.summary.failedItems > 0 ? 'warn' : 'success'}
              text="New edited files were copied. Old matching external files were archived, not deleted."
              role="status"
            />

            <div className="migration-result-grid">
              <div>
                <span>Copied to Edited</span>
                <strong>
                  {formatCount(result.summary.filesCopiedToDestination)} files
                </strong>
                <small>{formatBytes(result.summary.newBytesCopied)}</small>
              </div>
              <div>
                <span>Archived old external copies</span>
                <strong>
                  {formatCount(result.summary.destinationMatchesArchived)} files
                </strong>
                <small>{formatBytes(result.summary.oldBytesArchived)}</small>
              </div>
              <div>
                <span>Active Edited library file change</span>
                <strong>{formatSignedInteger(result.summary.netActiveFileDelta)}</strong>
              </div>
              <div>
                <span>Active Edited library storage change</span>
                <strong>{formatSignedBytes(result.summary.netActiveBytesDelta)}</strong>
              </div>
              <div>
                <span>Files with no previous external match</span>
                <strong>{formatCount(result.summary.filesWithNoMatches)}</strong>
              </div>
              <div>
                <span>Files with multiple old matches</span>
                <strong>{formatCount(result.summary.multiMatchFiles)}</strong>
              </div>
              <div>
                <span>Potential space reclaimable after deleting archive</span>
                <strong>
                  {formatBytes(
                    result.summary.potentialBytesReclaimableIfArchiveDeleted,
                  )}
                </strong>
              </div>
              <div>
                <span>Failed items</span>
                <strong>{formatCount(result.summary.failedItems)}</strong>
              </div>
            </div>

            <div className="migration-paths">
              {archiveRunDir && (
                <div>
                  <span>Archive folder</span>
                  <code>{archiveRunDir}</code>
                </div>
              )}
              {result.manifestPath && (
                <div>
                  <span>Manifest</span>
                  <code>{result.manifestPath}</code>
                </div>
              )}
              {result.operationLogPath && (
                <div>
                  <span>Operation log</span>
                  <code>{result.operationLogPath}</code>
                </div>
              )}
            </div>

            <Message
              severity="info"
              text="Actual drive space is not reclaimed until you manually review and delete the archive folder."
              role="status"
            />

            {failedItems.length > 0 && (
              <div className="migration-failed-items">
                <h3>Failures</h3>
                <DataTable
                  value={failedItems}
                  dataKey="sourcePath"
                  rows={5}
                  paginator
                  className="migration-failed-table"
                >
                  <Column field="fileName" header="File" />
                  <Column header="Details" body={failedItemsTemplate} />
                </DataTable>
              </div>
            )}
          </>
        )}

        {error && (
          <Message severity="error" text={error} className="migration-error" role="alert" />
        )}
      </div>
    </Dialog>
  )
}
