import { Button } from 'primereact/button'
import { Dialog } from 'primereact/dialog'
import { Message } from 'primereact/message'
import { ProgressBar } from 'primereact/progressbar'
import { RadioButton } from 'primereact/radiobutton'
import type {
  ThumbnailProgress,
  ThumbnailResultResponse,
  ThumbnailScope,
} from '../types/video'

type ThumbnailGenerationDialogProps = {
  allCount: number
  error: string | null
  isGenerating: boolean
  onHide: () => void
  onScopeChange: (scope: ThumbnailScope) => void
  onStart: () => void
  progress: ThumbnailProgress
  result: ThumbnailResultResponse | null
  selectedCount: number
  thumbnailPercent: number | null
  thumbnailScope: ThumbnailScope
  visible: boolean
}

const formatCount = (value: number) => value.toLocaleString()

export function ThumbnailGenerationDialog({
  allCount,
  error,
  isGenerating,
  onHide,
  onScopeChange,
  onStart,
  progress,
  result,
  selectedCount,
  thumbnailPercent,
  thumbnailScope,
  visible,
}: ThumbnailGenerationDialogProps) {
  const hasSelection = selectedCount > 0
  const requestedCount =
    thumbnailScope === 'selected' && hasSelection ? selectedCount : allCount
  const failedItems =
    result?.items
      .filter((item) => !item.thumbnail.generated)
      .slice(0, 5) ?? []

  const footer = result ? (
    <div className="thumbnail-dialog-actions">
      <Button type="button" label="Close" onClick={onHide} />
    </div>
  ) : (
    <div className="thumbnail-dialog-actions">
      <Button
        type="button"
        label="Cancel"
        severity="secondary"
        text
        disabled={isGenerating}
        onClick={onHide}
      />
      <Button
        type="button"
        label={hasSelection ? 'Generate' : 'Generate for All'}
        disabled={isGenerating || requestedCount === 0}
        loading={isGenerating}
        onClick={onStart}
      />
    </div>
  )

  return (
    <Dialog
      header={
        result ? 'Thumbnail Generation Complete' : 'Generate Thumbnails'
      }
      visible={visible}
      modal
      draggable={false}
      className="thumbnail-dialog"
      footer={footer}
      onHide={onHide}
    >
      <div className="thumbnail-dialog-content">
        {!result && !isGenerating && (
          <>
            {hasSelection ? (
              <>
                <p>You have {formatCount(selectedCount)} videos selected.</p>
                <div className="thumbnail-scope-options">
                  <label className="thumbnail-scope-option">
                    <RadioButton
                      inputId="thumbnail-scope-selected"
                      name="thumbnailScope"
                      value="selected"
                      checked={thumbnailScope === 'selected'}
                      onChange={() => onScopeChange('selected')}
                    />
                    <span>
                      <strong>Selected videos only</strong>
                      <small>{formatCount(selectedCount)}</small>
                    </span>
                  </label>
                  <label className="thumbnail-scope-option">
                    <RadioButton
                      inputId="thumbnail-scope-all"
                      name="thumbnailScope"
                      value="all"
                      checked={thumbnailScope === 'all'}
                      onChange={() => onScopeChange('all')}
                    />
                    <span>
                      <strong>All videos in table</strong>
                      <small>{formatCount(allCount)}</small>
                    </span>
                  </label>
                </div>
              </>
            ) : (
              <p>
                Generate thumbnails for all {formatCount(allCount)} videos in
                this table?
              </p>
            )}
          </>
        )}

        {!result && isGenerating && (
          <div className="thumbnail-progress">
            <ProgressBar value={thumbnailPercent ?? 0} />
            <p>{progress.message || 'Generating thumbnails...'}</p>
            <div className="thumbnail-progress-counts">
              <span>
                {formatCount(progress.processedVideos)} /{' '}
                {formatCount(progress.totalVideos ?? requestedCount)}
              </span>
              <span>{formatCount(progress.generatedCount)} generated</span>
              <span>{formatCount(progress.cachedCount)} cached</span>
              <span>{formatCount(progress.failedCount)} failed</span>
            </div>
            {progress.currentFile && (
              <div className="thumbnail-current-file">
                <span>Current</span>
                <strong>{progress.currentFile}</strong>
              </div>
            )}
          </div>
        )}

        {result && (
          <>
            <Message
              severity={result.summary.failed > 0 ? 'warn' : 'success'}
              text="Thumbnail metadata has been merged into the table."
              role="status"
            />
            <div className="thumbnail-summary-grid">
              <div>
                <span>Requested</span>
                <strong>{formatCount(result.summary.requested)}</strong>
              </div>
              <div>
                <span>Generated</span>
                <strong>{formatCount(result.summary.generated)}</strong>
              </div>
              <div>
                <span>Already cached</span>
                <strong>{formatCount(result.summary.cached)}</strong>
              </div>
              <div>
                <span>Failed</span>
                <strong>{formatCount(result.summary.failed)}</strong>
              </div>
            </div>
            {failedItems.length > 0 && (
              <div className="thumbnail-failed-items">
                <h3>Failed Items</h3>
                <ul>
                  {failedItems.map((item) => (
                    <li key={item.path || item.absolutePath || item.fileName}>
                      <strong>{item.fileName || item.path}</strong>
                      {item.thumbnail.error ? `: ${item.thumbnail.error}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {error && (
          <Message
            severity="error"
            text={error}
            className="thumbnail-error"
            role="alert"
          />
        )}
      </div>
    </Dialog>
  )
}
