import { useEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { OverlayPanel } from 'primereact/overlaypanel'
import { apiBaseUrl, getRowDisplayFileName } from '../helpers/utils'
import type { VideoRow } from '../types/video'

type VideoThumbnailPreviewProps = {
  row: VideoRow
}

const getThumbnailSrc = (url: string) =>
  url.startsWith('/api/') ? `${apiBaseUrl}${url}` : url

export function VideoThumbnailPreview({ row }: VideoThumbnailPreviewProps) {
  const overlayRef = useRef<OverlayPanel | null>(null)
  const timeoutRef = useRef<number | null>(null)
  const [failedThumbnailUrl, setFailedThumbnailUrl] = useState<string | null>(
    null,
  )
  const thumbnailUrl = row.thumbnail?.url
  const hasImageError =
    Boolean(thumbnailUrl) && failedThumbnailUrl === thumbnailUrl
  const hasThumbnail =
    row.thumbnail?.generated === true && Boolean(thumbnailUrl) && !hasImageError
  const thumbnailSrc = thumbnailUrl ? getThumbnailSrc(thumbnailUrl) : ''
  const fileName = getRowDisplayFileName(row)

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  const hidePreview = () => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }

    overlayRef.current?.hide()
  }

  const showPreview = (event: MouseEvent<HTMLImageElement>) => {
    if (!hasThumbnail) {
      return
    }

    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current)
    }

    timeoutRef.current = window.setTimeout(() => {
      overlayRef.current?.show(event, event.currentTarget)
    }, 1000)
  }

  if (!hasThumbnail) {
    return (
      <span
        className="video-thumbnail-placeholder"
        title={row.thumbnail?.error || 'No thumbnail generated'}
        aria-label={row.thumbnail?.error || 'No thumbnail'}
      >
        No thumbnail
      </span>
    )
  }

  return (
    <>
      <img
        className="video-row-thumbnail"
        src={thumbnailSrc}
        alt={`Thumbnail for ${fileName}`}
        loading="lazy"
        onError={() => setFailedThumbnailUrl(thumbnailUrl ?? null)}
        onMouseEnter={showPreview}
        onMouseLeave={hidePreview}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      />
      <OverlayPanel
        ref={overlayRef}
        appendTo={document.body}
        dismissable={false}
        showCloseIcon={false}
      >
        <img
          className="video-thumbnail-preview-large"
          src={thumbnailSrc}
          alt={`Large thumbnail preview for ${fileName}`}
          onError={hidePreview}
        />
      </OverlayPanel>
    </>
  )
}
