import { Button } from 'primereact/button'
import { Dialog } from 'primereact/dialog'
import { Message } from 'primereact/message'
import { ProgressBar } from 'primereact/progressbar'
import {
  getAutoCropSkipReason,
  isAutoCropCandidate,
} from '../helpers/utils'
import type {
  AutoCropProgress,
  AutoCropResultResponse,
  VideoRow,
} from '../types/video'

type AutoCropDialogProps = {
  autoCropPercent: number | null
  error: string | null
  isSubmitting: boolean
  onHide: () => void
  onSubmit: () => void
  progress: AutoCropProgress
  result: AutoCropResultResponse | null
  selectedVideos: VideoRow[]
  visible: boolean
}

const summarizeSkippedReasons = (videos: VideoRow[]) => {
  const reasonCounts = new Map<string, number>()

  videos.forEach((video) => {
    const reason = getAutoCropSkipReason(video)

    if (!reason) {
      return
    }

    reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1)
  })

  return Array.from(reasonCounts.entries()).sort(
    ([firstReason, firstCount], [secondReason, secondCount]) =>
      secondCount - firstCount || firstReason.localeCompare(secondReason),
  )
}

const formatCount = (value: number) => value.toLocaleString()

export function AutoCropDialog({
  autoCropPercent,
  error,
  isSubmitting,
  onHide,
  onSubmit,
  progress,
  result,
  selectedVideos,
  visible,
}: AutoCropDialogProps) {
  const eligibleVideos = selectedVideos.filter(isAutoCropCandidate)
  const skippedVideos = selectedVideos.filter((video) => !isAutoCropCandidate(video))
  const skippedReasons = summarizeSkippedReasons(skippedVideos)
  const failedItems =
    result?.items.filter((item) => item.status === 'failed').slice(0, 5) ?? []
  const footer = result ? (
    <div className="auto-crop-dialog-actions">
      <Button type="button" label="Close" onClick={onHide} />
    </div>
  ) : (
    <div className="auto-crop-dialog-actions">
      <Button
        type="button"
        label="Cancel"
        severity="secondary"
        text
        disabled={isSubmitting}
        onClick={onHide}
      />
      <Button
        type="button"
        label="Start Auto-Crop"
        disabled={eligibleVideos.length === 0 || isSubmitting}
        loading={isSubmitting}
        onClick={onSubmit}
      />
    </div>
  )

  return (
    <Dialog
      header={result ? 'Auto-Crop Complete' : 'Auto-Crop Selected'}
      visible={visible}
      modal
      draggable={false}
      className="auto-crop-dialog"
      footer={footer}
      onHide={onHide}
    >
      <div className="auto-crop-dialog-content">
        {!result && (
          <>
            <div className="auto-crop-summary-grid">
              <div>
                <span>Selected</span>
                <strong>{formatCount(selectedVideos.length)}</strong>
              </div>
              <div>
                <span>Ready</span>
                <strong>{formatCount(eligibleVideos.length)}</strong>
              </div>
              <div>
                <span>Skipped</span>
                <strong>{formatCount(skippedVideos.length)}</strong>
              </div>
            </div>

            <Message
              severity="info"
              text="Creates cropped copies with FFmpeg. Source files are not modified."
              role="status"
            />

            <ul className="auto-crop-notes">
              <li>Creates corrected files in a new output run folder.</li>
              <li>Preserves filenames where possible and writes a manifest.</li>
              <li>
                Auto-crop candidates are high-confidence videos with black borders
                on all sides and a 16:9 visible area.
              </li>
            </ul>

            {skippedReasons.length > 0 && (
              <div className="auto-crop-skipped-summary">
                <h3>Skipped Selection</h3>
                <ul>
                  {skippedReasons.map(([reason, count]) => (
                    <li key={reason}>
                      {formatCount(count)} {reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {isSubmitting && (
              <div className="auto-crop-progress">
                <ProgressBar value={autoCropPercent ?? 0} />
                <p>
                  {progress.message || 'Cropping selected videos...'}
                  {progress.currentFile ? ` ${progress.currentFile}` : ''}
                </p>
                <div className="auto-crop-progress-counts">
                  <span>
                    {formatCount(progress.processedFiles)} /{' '}
                    {formatCount(progress.totalFiles ?? eligibleVideos.length)}
                  </span>
                  <span>{formatCount(progress.succeededCount)} succeeded</span>
                  <span>{formatCount(progress.errorCount)} failed</span>
                </div>
              </div>
            )}
          </>
        )}

        {result && (
          <>
            <Message
              severity={result.summary.failed > 0 ? 'warn' : 'success'}
              text="Created cropped copies. Source files were not modified."
              role="status"
            />
            <div className="auto-crop-summary-grid">
              <div>
                <span>Requested</span>
                <strong>{formatCount(result.summary.requested)}</strong>
              </div>
              <div>
                <span>Eligible</span>
                <strong>{formatCount(result.summary.eligible)}</strong>
              </div>
              <div>
                <span>Succeeded</span>
                <strong>{formatCount(result.summary.succeeded)}</strong>
              </div>
              <div>
                <span>Skipped</span>
                <strong>{formatCount(result.summary.skipped)}</strong>
              </div>
              <div>
                <span>Failed</span>
                <strong>{formatCount(result.summary.failed)}</strong>
              </div>
            </div>
            <div className="auto-crop-paths">
              <div>
                <span>Output folder</span>
                <code>{result.outputDir}</code>
              </div>
              {result.manifestPath && (
                <div>
                  <span>Manifest</span>
                  <code>{result.manifestPath}</code>
                </div>
              )}
            </div>
            {failedItems.length > 0 && (
              <div className="auto-crop-failed-items">
                <h3>Failed Items</h3>
                <ul>
                  {failedItems.map((item) => (
                    <li key={item.sourcePath}>
                      <strong>{item.fileName}</strong>
                      {item.error ? `: ${item.error}` : ''}
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
            className="auto-crop-error"
            role="alert"
          />
        )}
      </div>
    </Dialog>
  )
}
