import { useEffect, useRef, useState } from 'react'
import { Button } from 'primereact/button'
import { ProgressBar } from 'primereact/progressbar'
import type { AuditProgress } from '../types/video'
import { formatProgressNumber } from '../helpers/utils'

type AuditProgressPanelProps = {
  auditPercent: number | null
  auditProgress: AuditProgress
  isAuditActive: boolean
  onCancelAudit: () => void
}

function formatElapsedTime(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    const paddedMinutes = String(minutes).padStart(2, '0')
    const paddedSeconds = String(seconds).padStart(2, '0')

    return `${hours}h ${paddedMinutes}m ${paddedSeconds}s`
  }

  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`
  }

  return `${seconds}s`
}

export function AuditProgressPanel({
  auditPercent,
  auditProgress,
  isAuditActive,
  onCancelAudit,
}: AuditProgressPanelProps) {
  const startedAtMsRef = useRef<number | null>(null)
  const timerJobIdRef = useRef<string | null>(null)
  const [timerState, setTimerState] = useState({
    jobId: null as string | null,
    elapsedSeconds: 0,
  })

  useEffect(() => {
    if (!isAuditActive) return

    if (timerJobIdRef.current !== auditProgress.jobId) {
      timerJobIdRef.current = auditProgress.jobId
      startedAtMsRef.current = Date.now()
    }

    const startTime = startedAtMsRef.current ?? Date.now()
    const intervalId = window.setInterval(() => {
      setTimerState({
        jobId: auditProgress.jobId,
        elapsedSeconds: Math.floor((Date.now() - startTime) / 1000),
      })
    }, 1000)

    return () => window.clearInterval(intervalId)
  }, [auditProgress.jobId, isAuditActive])

  const displayElapsedSeconds =
    isAuditActive && timerState.jobId !== auditProgress.jobId
      ? 0
      : timerState.elapsedSeconds
  const progressTitle =
    auditProgress.status === 'complete'
      ? 'Audit complete'
      : auditProgress.status === 'canceled'
        ? 'Audit canceled'
        : auditProgress.message || 'Audit running'

  return (
    <div className="audit-progress" aria-live="polite">
      <div className="audit-progress-header">
        <span className="cell-title">{progressTitle}</span>
        {isAuditActive && (
          <Button
            type="button"
            label="Cancel"
            severity="danger"
            size="small"
            onClick={onCancelAudit}
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
        <span>Elapsed: {formatElapsedTime(displayElapsedSeconds)}</span>
      </div>
    </div>
  )
}
