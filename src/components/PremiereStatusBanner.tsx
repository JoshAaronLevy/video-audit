import { useEffect, useRef } from 'react'
import { Button } from 'primereact/button'
import { Toast } from 'primereact/toast'
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
  const toast = useRef<Toast>(null)

  useEffect(() => {
    toast.current?.replace({
      id: 'premiere-status',
      severity: getBannerSeverity(status),
      sticky: true,
      closable: false,
      className: 'premiere-status-toast-message',
      content: () => (
        <div className="premiere-status-toast-content" role="status">
          <span className="premiere-status-toast-text">
            {getBannerText(status, isLoading)}
          </span>
          <Button
            type="button"
            label="Retry"
            severity="info"
            raised
            loading={isLoading}
            onClick={onRetry}
          />
        </div>
      ),
    })
  }, [isLoading, onRetry, status])

  return (
    <section className="premiere-status-section" aria-label="Premiere status">
      <Toast
        ref={toast}
        appendTo="self"
        position="top-center"
        transitionOptions={{ timeout: 0 }}
        className="premiere-status-toast"
      />
    </section>
  )
}
