import { Button } from 'primereact/button'
import { Dialog } from 'primereact/dialog'
import { InputText } from 'primereact/inputtext'
import { Message } from 'primereact/message'
import { ProgressBar } from 'primereact/progressbar'
import type {
  AutoFixAction,
  AutoFixProfileId,
  AutoFixProgress,
  AutoFixResultResponse,
} from '../types/video'

type AutoFixDialogProps = {
  destinationRoot: string
  error: string | null
  isSubmitting: boolean
  onDestinationRootChange: (value: string) => void
  onHide: () => void
  onSubmit: () => void
  progress: AutoFixProgress
  result: AutoFixResultResponse | null
  selectedCount: number
  autoFixPercent: number | null
  visible: boolean
}

const outputFolderFor = (destinationRoot: string) => {
  const trimmedRoot = destinationRoot.trim()

  if (!trimmedRoot) {
    return ''
  }

  return `${trimmedRoot.replace(/\/+$/, '')}/ffmpeg`
}

const formatCount = (value: number) => value.toLocaleString()

const getProfileLabel = (profile: AutoFixProfileId | null) => {
  if (profile === 'standard') return 'Standard normalize'
  if (profile === 'high-quality') return 'High quality normalize'
  return 'Pending'
}

const getActionLabel = (action: AutoFixAction | null) => {
  if (action === 'crop-normalize') return 'Crop + normalize'
  if (action === 'normalize') return 'Normalize'
  return 'Pending'
}

export function AutoFixDialog({
  destinationRoot,
  error,
  isSubmitting,
  onDestinationRootChange,
  onHide,
  onSubmit,
  progress,
  result,
  selectedCount,
  autoFixPercent,
  visible,
}: AutoFixDialogProps) {
  const outputFolder = result?.outputDirectory || outputFolderFor(destinationRoot)
  const failedItems =
    result?.items.filter((item) => item.status === 'failed').slice(0, 5) ?? []
  const canSubmit =
    selectedCount > 0 && destinationRoot.trim().length > 0 && !isSubmitting
  const requestedCount = progress.totalVideos ?? selectedCount

  const footer = result ? (
    <div className="auto-fix-dialog-actions">
      <Button type="button" label="Close" severity="info" raised onClick={onHide} />
    </div>
  ) : (
    <div className="auto-fix-dialog-actions">
      <Button
        type="button"
        label="Cancel"
        severity="warning"
        raised
        disabled={isSubmitting}
        onClick={onHide}
      />
      <Button
        type="button"
        label="Fix Videos"
        severity="success"
        raised
        disabled={!canSubmit}
        loading={isSubmitting}
        onClick={onSubmit}
      />
    </div>
  )

  return (
    <Dialog
      header={result ? 'Auto-Fix Complete' : 'Auto-Fix Selected Videos'}
      visible={visible}
      modal
      draggable={false}
      className="auto-fix-dialog"
      footer={footer}
      onHide={() => {
        if (!isSubmitting) {
          onHide()
        }
      }}
    >
      <div className="auto-fix-dialog-content">
        {!result && !isSubmitting && (
          <>
            <p>
              Auto-Fix uses FFmpeg to normalize videos to 1920x1080 without
              stretching. It may add black bars to preserve the original image
              shape. If safe crop metadata exists, it can crop first and then
              normalize.
            </p>
            <div className="auto-fix-summary-grid">
              <div>
                <span>Selected</span>
                <strong>{formatCount(selectedCount)}</strong>
              </div>
            </div>
            <label className="auto-fix-destination-field">
              <span>Destination root</span>
              <InputText
                value={destinationRoot}
                disabled={isSubmitting}
                onChange={(event) => onDestinationRootChange(event.target.value)}
              />
            </label>
            <div className="auto-fix-paths">
              <div>
                <span>Output folder</span>
                <code>{outputFolder || 'Enter a destination root.'}</code>
              </div>
            </div>
            <Message
              severity="warn"
              text="Files are written to the ffmpeg folder. Existing files with the same names will be overwritten."
              role="status"
            />
            <Message
              severity="info"
              text="The app chooses Standard or High Quality automatically for each video."
              role="status"
            />
          </>
        )}

        {!result && isSubmitting && (
          <div className="auto-fix-progress">
            <ProgressBar value={autoFixPercent ?? 0} />
            <p>{progress.message || 'Auto-fixing videos...'}</p>
            <div className="auto-fix-progress-counts">
              <span>
                {formatCount(progress.processedVideos)} /{' '}
                {formatCount(requestedCount)}
              </span>
              <span>{formatCount(progress.succeeded)} succeeded</span>
              <span>{formatCount(progress.failed)} failed</span>
            </div>
            <div className="auto-fix-current-grid">
              <div>
                <span>Current</span>
                <strong>{progress.currentFile || 'Preparing...'}</strong>
              </div>
              <div>
                <span>Profile</span>
                <strong>{getProfileLabel(progress.currentProfile)}</strong>
              </div>
              <div>
                <span>Action</span>
                <strong>{getActionLabel(progress.currentAction)}</strong>
              </div>
            </div>
            {outputFolder && (
              <div className="auto-fix-paths">
                <div>
                  <span>Output folder</span>
                  <code>{progress.outputDirectory || outputFolder}</code>
                </div>
              </div>
            )}
          </div>
        )}

        {result && (
          <>
            <Message
              severity={result.summary.failed > 0 ? 'warn' : 'success'}
              text="Auto-Fix finished. Source videos were not modified."
              role="status"
            />
            <div className="auto-fix-paths">
              <div>
                <span>Output folder</span>
                <code>{result.outputDirectory}</code>
              </div>
            </div>
            <div className="auto-fix-summary-grid">
              <div>
                <span>Requested</span>
                <strong>{formatCount(result.summary.requested)}</strong>
              </div>
              <div>
                <span>Succeeded</span>
                <strong>{formatCount(result.summary.succeeded)}</strong>
              </div>
              <div>
                <span>Failed</span>
                <strong>{formatCount(result.summary.failed)}</strong>
              </div>
              <div>
                <span>Standard profile</span>
                <strong>
                  {formatCount(result.summary.standardProfileCount)}
                </strong>
              </div>
              <div>
                <span>High quality profile</span>
                <strong>
                  {formatCount(result.summary.highQualityProfileCount)}
                </strong>
              </div>
              <div>
                <span>Cropped + normalized</span>
                <strong>{formatCount(result.summary.croppedCount)}</strong>
              </div>
              <div>
                <span>Normalized only</span>
                <strong>
                  {formatCount(result.summary.normalizedOnlyCount)}
                </strong>
              </div>
            </div>
            {failedItems.length > 0 && (
              <div className="auto-fix-failed-items">
                <h3>Failed</h3>
                <ul>
                  {failedItems.map((item) => (
                    <li key={item.sourcePath || item.fileName}>
                      <strong>{item.fileName}</strong>
                      {item.error ? ` - ${item.error}` : ''}
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
            className="auto-fix-error"
            role="alert"
          />
        )}
      </div>
    </Dialog>
  )
}
