import { useState } from 'react'
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
  canImportToPremiere: boolean
  error: string | null
  isSubmitting: boolean
  isPremiereImportSubmitting: boolean
  initialMode?: 'choose' | 'auto-crop'
  onCancel: () => void
  onHide: () => void
  onImportToPremiere: () => void
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
  canImportToPremiere,
  error,
  initialMode = 'choose',
  isSubmitting,
  isPremiereImportSubmitting,
  onCancel,
  onHide,
  onImportToPremiere,
  onSubmit,
  progress,
  result,
  selectedVideos,
  visible,
}: AutoCropDialogProps) {
  const [manualMode, setManualMode] = useState<'choose' | 'auto-crop' | null>(
    null,
  )
  const mode = manualMode ?? initialMode
  const eligibleVideos = selectedVideos.filter(isAutoCropCandidate)
  const skippedVideos = selectedVideos.filter(
    (video) => !isAutoCropCandidate(video),
  )
  const manualReviewVideos = eligibleVideos.filter((video) => {
    const recommendedFix = video.adjustments?.blackBorder?.recommendedFix

    return (
      recommendedFix?.eligible === false ||
      recommendedFix?.type === 'manual-review'
    )
  })
  const skippedReasons = summarizeSkippedReasons(skippedVideos)
  const failedItems =
    result?.items.filter((item) => item.status === 'failed').slice(0, 5) ?? []
  const isCanceled = progress.status === 'canceled'

  const handleHide = () => {
    if (isSubmitting || isPremiereImportSubmitting) {
      return
    }

    setManualMode(null)
    onHide()
  }

  const footer = result || isCanceled ? (
    <div className="auto-crop-dialog-actions">
      <Button type="button" label="Close" severity="info" raised onClick={handleHide} />
    </div>
  ) : mode === 'choose' ? (
    <div className="auto-crop-dialog-actions">
      <Button
        type="button"
        label="Cancel"
        severity="warning"
        raised
        disabled={isPremiereImportSubmitting}
        onClick={handleHide}
      />
    </div>
  ) : (
    <div className="auto-crop-dialog-actions">
      <Button
        type="button"
        label={isSubmitting ? 'Cancel Auto-Crop' : 'Back'}
        severity={isSubmitting ? 'danger' : 'info'}
        raised
        onClick={isSubmitting ? onCancel : () => setManualMode('choose')}
      />
      <Button
        type="button"
        label="Start Auto-Crop"
        severity="success"
        raised
        disabled={eligibleVideos.length === 0 || isSubmitting}
        loading={isSubmitting}
        onClick={onSubmit}
      />
    </div>
  )

  return (
    <Dialog
      header={result ? 'Auto-Crop Complete' : 'Crop Options'}
      visible={visible}
      modal
      draggable={false}
      className="auto-crop-dialog"
      footer={footer}
      onHide={handleHide}
    >
      <div className="auto-crop-dialog-content">
        {!result && mode === 'choose' && (
          <>
            <div className="auto-crop-summary-grid">
              <div>
                <span>Selected</span>
                <strong>{formatCount(selectedVideos.length)}</strong>
              </div>
              <div>
                <span>Can try crop</span>
                <strong>{formatCount(eligibleVideos.length)}</strong>
              </div>
              <div>
                <span>Manual review</span>
                <strong>{formatCount(manualReviewVideos.length)}</strong>
              </div>
            </div>

            {manualReviewVideos.length > 0 && (
              <Message
                severity="warn"
                text={`Auto-crop may not work properly for ${formatCount(
                  manualReviewVideos.length,
                )} selected video${
                  manualReviewVideos.length === 1 ? '' : 's'
                } marked for manual review. You can still try auto-crop or import the selected files into Premiere Pro.`}
                role="status"
              />
            )}

            <div className="crop-options-grid">
              <button
                type="button"
                className="crop-option-card"
                disabled={
                  eligibleVideos.length === 0 || isPremiereImportSubmitting
                }
                onClick={() => setManualMode('auto-crop')}
              >
                <span>Auto crop videos</span>
                <strong>Create cropped copies with FFmpeg</strong>
                <small>Source files are not modified.</small>
              </button>
              <button
                type="button"
                className="crop-option-card"
                disabled={!canImportToPremiere || isPremiereImportSubmitting}
                onClick={onImportToPremiere}
              >
                <span>Edit in Premiere Pro</span>
                <strong>
                  {isPremiereImportSubmitting
                    ? 'Requesting Premiere import...'
                    : 'Import selected files only'}
                </strong>
                <small>No effects, fixes, sequences, or Media Encoder queue.</small>
              </button>
            </div>

            {!canImportToPremiere && (
              <Message
                severity="warn"
                text="Premiere bridge must be ready before importing selected files."
                role="status"
              />
            )}
          </>
        )}

        {!result && mode === 'auto-crop' && (
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

            {manualReviewVideos.length > 0 && (
              <Message
                severity="warn"
                text={`Auto-crop may not work properly for ${formatCount(
                  manualReviewVideos.length,
                )} selected video${
                  manualReviewVideos.length === 1 ? '' : 's'
                } marked for manual review.`}
                role="status"
              />
            )}

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

            {isCanceled && (
              <Message
                severity="info"
                text="Auto-crop was canceled. The current FFmpeg process was stopped."
                role="status"
              />
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
