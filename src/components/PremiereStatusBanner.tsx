import { Button } from 'primereact/button'
import { Message } from 'primereact/message'
import type { PremiereStatusResponse } from '../types/premiere'

type PremiereStatusBannerProps = {
  isLoading: boolean
  onRetry: () => void
  status: PremiereStatusResponse | null
}

const getBannerSeverity = (
  status: PremiereStatusResponse | null,
): 'success' | 'info' | 'warn' | 'error' => {
  if (!status) {
    return 'info'
  }

  if (status.status === 'ready') {
    return 'success'
  }

  if (status.status === 'error') {
    return 'error'
  }

  return 'warn'
}

const getBannerText = (
  status: PremiereStatusResponse | null,
  isLoading: boolean,
) => {
  if (isLoading && !status) {
    return 'Checking Premiere bridge status...'
  }

  if (!status) {
    return 'Premiere bridge status is unavailable.'
  }

  if (status.status === 'premiere_not_running') {
    return 'Premiere Pro is not open.'
  }

  if (status.status === 'bridge_disconnected') {
    return 'Premiere Pro is open, but the Video Audit bridge plugin is not connected.'
  }

  if (status.status === 'ready') {
    return 'Premiere bridge is connected and ready.'
  }

  return status.message || 'Unable to check Premiere bridge status.'
}

export function PremiereStatusBanner({
  isLoading,
  onRetry,
  status,
}: PremiereStatusBannerProps) {
  return (
    <section className="premiere-status-section" aria-label="Premiere status">
      <div className="premiere-status-panel">
        <Message
          severity={getBannerSeverity(status)}
          text={getBannerText(status, isLoading)}
          className="premiere-status-message"
          role="status"
        />
        <Button
          type="button"
          label="Retry"
          severity="secondary"
          outlined
          loading={isLoading}
          onClick={onRetry}
        />
      </div>
    </section>
  )
}
