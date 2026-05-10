import { ProgressBar } from 'primereact/progressbar'
import { Tag } from 'primereact/tag'
import type { AuditProgress } from '../types/video'
import { formatProgressNumber } from '../helpers/utils'

type AuditProgressPanelProps = {
  auditPercent: number | null
  auditProgress: AuditProgress
  isAuditActive: boolean
}

export function AuditProgressPanel({
  auditPercent,
  auditProgress,
  isAuditActive,
}: AuditProgressPanelProps) {
  return (
    <div className="audit-progress" aria-live="polite">
      <div className="audit-progress-header">
        <span className="cell-title">
          {auditProgress.status === 'complete'
            ? 'Audit complete'
            : auditProgress.message || 'Audit running'}
        </span>
        {auditProgress.phase && (
          <Tag
            severity={
              auditProgress.status === 'error'
                ? 'danger'
                : auditProgress.status === 'complete'
                  ? 'success'
                  : 'info'
            }
            value={auditProgress.phase}
          />
        )}
      </div>
      <ProgressBar
        mode={auditPercent === null && isAuditActive ? 'indeterminate' : 'determinate'}
        value={auditPercent ?? (auditProgress.status === 'complete' ? 100 : 0)}
        showValue={auditPercent !== null}
      />
      <div className="audit-progress-details">
        <span>
          Analyzing {formatProgressNumber(auditProgress.processedFiles)} /{' '}
          {auditProgress.totalFiles
            ? formatProgressNumber(auditProgress.totalFiles)
            : 'unknown'}{' '}
          files
        </span>
        <span>Flagged: {formatProgressNumber(auditProgress.flaggedCount)}</span>
        <span>Errors: {formatProgressNumber(auditProgress.errorCount)}</span>
        {auditProgress.currentFile && (
          <span>Current: {auditProgress.currentFile}</span>
        )}
        {auditProgress.resolvedDirectory && (
          <span>Folder: {auditProgress.resolvedDirectory}</span>
        )}
      </div>
    </div>
  )
}
