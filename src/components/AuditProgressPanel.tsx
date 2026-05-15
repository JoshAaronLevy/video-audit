import { useEffect, useRef, useState } from 'react'
import { Button } from 'primereact/button'
import { ProgressBar } from 'primereact/progressbar'
import type { AuditProgress } from '../types/video'
import { formatProgressNumber } from '../helpers/utils'

const LARGE_SCAN_FILE_THRESHOLD = 50
const MIN_ESTIMATE_PROCESSED_FILES = 10
const MIN_ESTIMATE_ANALYZING_SECONDS = 15

type AuditProgressPanelProps = {
  auditPercent: number | null
  auditProgress: AuditProgress
  isAuditActive: boolean
  onCancelAudit: () => void
}

type FirstEstimateSnapshot = {
  estimatedAtElapsedSeconds: number
  estimatedAtProcessedFiles: number
  estimatedRemainingSeconds: number
  estimatedAtTimestampMs: number
}

type RemainingEstimate = {
  jobId: string | null
  analyzingStartedAtMs: number | null
  baseRemainingSeconds: number | null
  calculatedAtMs: number | null
  calculatedAtProcessedFiles: number
  firstEstimate: FirstEstimateSnapshot | null
  diagnosticText: string | null
}

type TimerState = {
  jobId: string | null
  elapsedSeconds: number
  nowMs: number
  remainingEstimate: RemainingEstimate
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

function formatFlaggedPercentage(flaggedCount: number, processedFiles: number) {
  if (processedFiles <= 0) return '0%'

  return `${((flaggedCount / processedFiles) * 100).toFixed(1)}%`
}

function formatRemainingTime(totalSeconds: number) {
  if (totalSeconds < 60) {
    return formatElapsedTime(totalSeconds)
  }

  const roundedMinutes = Math.max(1, Math.round(totalSeconds / 60))

  if (roundedMinutes < 60) {
    return `about ${roundedMinutes}m`
  }

  const hours = Math.floor(roundedMinutes / 60)
  const minutes = roundedMinutes % 60

  return minutes > 0 ? `about ${hours}h ${minutes}m` : `about ${hours}h`
}

function buildEstimateDiagnostic(
  firstEstimate: FirstEstimateSnapshot,
  completedAtMs: number,
  totalFiles: number | null,
) {
  const actualRemainingSeconds = Math.max(
    0,
    Math.round((completedAtMs - firstEstimate.estimatedAtTimestampMs) / 1000),
  )
  const totalText = totalFiles ? formatProgressNumber(totalFiles) : 'unknown'

  return `First estimate: ${formatRemainingTime(
    firstEstimate.estimatedRemainingSeconds,
  )} remaining at ${formatProgressNumber(
    firstEstimate.estimatedAtProcessedFiles,
  )}/${totalText} files; actual from then: ${formatElapsedTime(
    actualRemainingSeconds,
  )}`
}

function createEmptyEstimate(jobId: string | null): RemainingEstimate {
  return {
    jobId,
    analyzingStartedAtMs: null,
    baseRemainingSeconds: null,
    calculatedAtMs: null,
    calculatedAtProcessedFiles: 0,
    firstEstimate: null,
    diagnosticText: null,
  }
}

function updateRemainingEstimate(
  current: RemainingEstimate,
  auditProgress: AuditProgress,
  nowMs: number,
) {
  const next =
    current.jobId === auditProgress.jobId
      ? current
      : createEmptyEstimate(auditProgress.jobId)
  const totalFiles = auditProgress.totalFiles ?? 0
  const isLargeScan = totalFiles >= LARGE_SCAN_FILE_THRESHOLD

  if (!isLargeScan) {
    return next
  }

  let updated = next
  const applyUpdate = (changes: Partial<RemainingEstimate>) => {
    updated = { ...updated, ...changes }
  }

  if (auditProgress.phase === 'analyzing' && updated.analyzingStartedAtMs === null) {
    applyUpdate({ analyzingStartedAtMs: nowMs })
  }

  if (auditProgress.status === 'complete') {
    applyUpdate({
      baseRemainingSeconds: 0,
      calculatedAtMs: nowMs,
      calculatedAtProcessedFiles: auditProgress.processedFiles,
      diagnosticText:
        updated.firstEstimate && !updated.diagnosticText
          ? buildEstimateDiagnostic(updated.firstEstimate, nowMs, auditProgress.totalFiles)
          : updated.diagnosticText,
    })

    return updated
  }

  if (
    auditProgress.status === 'canceled' ||
    auditProgress.status === 'error' ||
    auditProgress.phase !== 'analyzing' ||
    updated.analyzingStartedAtMs === null ||
    auditProgress.processedFiles < MIN_ESTIMATE_PROCESSED_FILES
  ) {
    return updated
  }

  const analyzingSeconds = Math.floor((nowMs - updated.analyzingStartedAtMs) / 1000)

  if (
    analyzingSeconds < MIN_ESTIMATE_ANALYZING_SECONDS ||
    updated.calculatedAtProcessedFiles === auditProgress.processedFiles
  ) {
    return updated
  }

  const secondsPerFile = analyzingSeconds / auditProgress.processedFiles
  const remainingFiles = Math.max(0, totalFiles - auditProgress.processedFiles)
  const estimatedRemainingSeconds = Math.round(remainingFiles * secondsPerFile)
  const firstEstimate =
    updated.firstEstimate ??
    ({
      estimatedAtElapsedSeconds: analyzingSeconds,
      estimatedAtProcessedFiles: auditProgress.processedFiles,
      estimatedRemainingSeconds,
      estimatedAtTimestampMs: nowMs,
    } satisfies FirstEstimateSnapshot)

  applyUpdate({
    baseRemainingSeconds: estimatedRemainingSeconds,
    calculatedAtMs: nowMs,
    calculatedAtProcessedFiles: auditProgress.processedFiles,
    firstEstimate,
  })

  return updated
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
    nowMs: 0,
    remainingEstimate: createEmptyEstimate(auditProgress.jobId),
  } satisfies TimerState)

  useEffect(() => {
    if (!isAuditActive) return

    if (timerJobIdRef.current !== auditProgress.jobId) {
      timerJobIdRef.current = auditProgress.jobId
      startedAtMsRef.current = Date.now()
    }

    const startTime = startedAtMsRef.current ?? Date.now()
    const intervalId = window.setInterval(() => {
      const nowMs = Date.now()

      setTimerState((current) => ({
        jobId: auditProgress.jobId,
        elapsedSeconds: Math.floor((nowMs - startTime) / 1000),
        nowMs,
        remainingEstimate: updateRemainingEstimate(
          current.remainingEstimate,
          auditProgress,
          nowMs,
        ),
      }))
    }, 1000)

    return () => window.clearInterval(intervalId)
  }, [auditProgress, isAuditActive])

  useEffect(() => {
    if (
      isAuditActive ||
      (auditProgress.status !== 'complete' &&
        auditProgress.status !== 'canceled' &&
        auditProgress.status !== 'error')
    ) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      const nowMs = Date.now()

      setTimerState((current) => ({
        ...current,
        nowMs,
        remainingEstimate: updateRemainingEstimate(
          current.remainingEstimate,
          auditProgress,
          nowMs,
        ),
      }))
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [auditProgress, isAuditActive])

  const displayElapsedSeconds =
    isAuditActive && timerState.jobId !== auditProgress.jobId
      ? 0
      : timerState.elapsedSeconds
  const currentTickMs = timerState.nowMs
  const remainingEstimate = timerState.remainingEstimate

  const progressTitle =
    auditProgress.status === 'complete'
      ? 'Audit complete'
      : auditProgress.status === 'canceled'
        ? 'Audit canceled'
        : auditProgress.message || 'Audit running'
  const flaggedPercentage = formatFlaggedPercentage(
    auditProgress.flaggedCount,
    auditProgress.processedFiles,
  )
  const shouldShowRemaining =
    typeof auditProgress.totalFiles === 'number' &&
    auditProgress.totalFiles >= LARGE_SCAN_FILE_THRESHOLD
  const hasFinalStatus =
    auditProgress.status === 'complete' ||
    auditProgress.status === 'canceled' ||
    auditProgress.status === 'error'
  const displayRemainingSeconds =
    remainingEstimate.baseRemainingSeconds !== null &&
    remainingEstimate.calculatedAtMs !== null
      ? Math.max(
          0,
          Math.round(
            remainingEstimate.baseRemainingSeconds -
              (isAuditActive && !hasFinalStatus
                ? (currentTickMs - remainingEstimate.calculatedAtMs) / 1000
                : 0),
          ),
        )
      : null
  const remainingText =
    shouldShowRemaining && displayRemainingSeconds !== null
      ? `Remaining: ${formatRemainingTime(displayRemainingSeconds)}`
      : shouldShowRemaining && !hasFinalStatus
        ? 'Remaining: calculating...'
        : null

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
        <span>
          Flagged: {formatProgressNumber(auditProgress.flaggedCount)} (
          {flaggedPercentage})
        </span>
        <span>Elapsed: {formatElapsedTime(displayElapsedSeconds)}</span>
        {remainingText && <span>{remainingText}</span>}
        {remainingEstimate.diagnosticText && (
          <span className="audit-progress-diagnostic">
            {remainingEstimate.diagnosticText}
          </span>
        )}
      </div>
    </div>
  )
}
