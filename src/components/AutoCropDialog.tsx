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
  isSubmitting,
  isPremiereImportSubmitting,
  onHide,
  onImportToPremiere,
  onSubmit,
  progress,
  result,
  selectedVideos,
  visible,
}: AutoCropDialogProps) {
  const [mode, setMode] = useState<'choose' | 'auto-crop'>('choose')
  const eligibleVideos = selectedVideos.filter(isAutoCropCandidate)
  const skippedVideos = selectedVideos.filter((video) => !isAutoCropCandidate(video))
  const skippedReasons = summarizeSkippedReasons(skippedVideos)
  const failedItems =
    result?.items.filter((item) => item.status === 'failed').slice(0, 5) ?? []
  const handleHide = () => {
    if (isSubmitting || isPremiereImportSubmitting) {
      return
    }

    setMode('choose')
    onHide()
  }

  const footer = result ? (
    <div className="auto-crop-dialog-actions">
      <Button type="button" label="Close" onClick={handleHide} />
    </div>
  ) : mode === 'choose' ? (
    <div className="auto-crop-dialog-actions">
      <Button
        type="button"
        label="Cancel"
        severity="secondary"
        text
        disabled={isPremiereImportSubmitting}
        onClick={handleHide}
      />
    </div>
  ) : (
    <div className="auto-crop-dialog-actions">
      <Button
        type="button"
        label="Back"
        severity="secondary"
        text
        disabled={isSubmitting}
        onClick={() => setMode('choose')}
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
                <span>Auto-crop ready</span>
                <strong>{formatCount(eligibleVideos.length)}</strong>
              </div>
              <div>
                <span>Manual review</span>
                <strong>{formatCount(selectedVideos.length - eligibleVideos.length)}</strong>
              </div>
            </div>

            <div className="crop-options-grid">
              <button
                type="button"
                className="crop-option-card"
                disabled={eligibleVideos.length === 0 || isPremiereImportSubmitting}
                onClick={() => setMode('auto-crop')}
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
