import { ChevronLeft, ChevronRight, ExternalLink, Image, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { imageSourceTime } from './image-refinements'
import { safeHttpUrl } from './navigation'
import { ResultImage } from './ResultImage'
import { licenseLabel } from './reusable-images'
import type { ResultWithUrl } from './result-order'
import './reusable-images.css'

const imageDateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' })

interface ImageViewerProps {
  entries: readonly ResultWithUrl[]
  startIndex: number
  opener: HTMLButtonElement
  newTab: boolean
  close: () => void
}

export function ImageViewer({ entries, startIndex, opener, newTab, close }: ImageViewerProps) {
  const [index, setIndex] = useState(startIndex)
  const [copyFeedback, setCopyFeedback] = useState<{ index: number; copied: boolean }>()
  const dialog = useRef<HTMLDialogElement>(null)
  const gesture = useRef<{ pointer: number; x: number; y: number } | null>(null)
  const titleId = useId()
  const entry = entries[index]

  useEffect(() => {
    const current = dialog.current
    if (!current) return
    current.showModal()
    return () => {
      current.close()
      if (opener.isConnected && (current.contains(document.activeElement) || document.activeElement === document.body)) {
        opener.focus({ preventScroll: true })
      }
    }
  }, [opener])

  function step(offset: number) {
    setIndex(current => Math.max(0, Math.min(entries.length - 1, current + offset)))
  }

  if (!entry) return null
  const title = entry.result.title || entry.host
  const { imageUrl, thumbnailUrl, imageDimensions, imageLicense, snippet, publishedAt } = entry.result
  const sourceDate = imageSourceTime(publishedAt)
  const original = safeHttpUrl(imageUrl)
  const license = imageLicense && licenseLabel(imageLicense.code, imageLicense.version)
  const licenseUrl = safeHttpUrl(imageLicense?.url)
  const creatorUrl = safeHttpUrl(imageLicense?.creatorUrl)
  const attribution = imageLicense?.attribution
  const target = newTab ? '_blank' : undefined

  return (
    <dialog ref={dialog} className="dialog image-viewer" aria-labelledby={titleId}
      onCancel={event => { event.preventDefault(); close() }}
      onClick={event => { if (event.target === event.currentTarget) close() }}
      onKeyDown={event => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault()
          step(event.key === 'ArrowLeft' ? -1 : 1)
        }
      }}>
      <div className="image-viewer-content">
        <header className="image-viewer-header">
          <h2 id={titleId}>Image preview</h2>
          <button type="button" className="icon-button" aria-label="Close image preview" onClick={close}>
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        <div className="image-viewer-media"
          onPointerDown={event => {
            if (event.pointerType === 'touch' && event.isPrimary) gesture.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY }
          }}
          onPointerCancel={() => { gesture.current = null }}
          onPointerUp={event => {
            const start = gesture.current
            gesture.current = null
            if (!start || start.pointer !== event.pointerId) return
            const deltaX = event.clientX - start.x
            const deltaY = event.clientY - start.y
            if (Math.abs(deltaX) >= 44 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) step(deltaX < 0 ? 1 : -1)
          }}>
          <ResultImage key={index} sources={[imageUrl, thumbnailUrl]} alt={title} fallback={
            <div className="image-viewer-unavailable" role="status">
              <Image size={32} aria-hidden="true" />
              <span>Image unavailable</span>
            </div>
          } />
        </div>
        <footer className="image-viewer-footer">
          <div className="image-viewer-navigation" role="group" aria-label="Browse images">
            <button type="button" className="icon-button" aria-label="Previous image" aria-disabled={index === 0} onClick={() => step(-1)}>
              <ChevronLeft size={21} aria-hidden="true" />
            </button>
            <span className="image-viewer-position" role="status" aria-label={title}>{index + 1} of {entries.length}</span>
            <button type="button" className="icon-button" aria-label="Next image" aria-disabled={index === entries.length - 1} onClick={() => step(1)}>
              <ChevronRight size={21} aria-hidden="true" />
            </button>
          </div>
          <div className="image-viewer-source">
            <h3>{title}</h3>
            <span>{entry.host}{imageDimensions && ' · ' + imageDimensions.width + ' × ' + imageDimensions.height}
              {sourceDate !== undefined && <> · <time dateTime={new Date(sourceDate).toISOString()}>{imageDateFormat.format(sourceDate)}</time></>}
            </span>
            {snippet && <p className="image-viewer-description">{snippet}</p>}
            {imageLicense && <div className="image-viewer-license" role="group" aria-label="Image reuse details">
              <p><strong>Reported license</strong>{' '}
                {licenseUrl ? <a href={licenseUrl.href} target={target} rel="noreferrer">{license}</a> : license}
                {imageLicense.creator && <>{' · By '}{creatorUrl
                  ? <a href={creatorUrl.href} target={target} rel="noreferrer">{imageLicense.creator}</a>
                  : imageLicense.creator}</>}
              </p>
              {attribution && <details>
                <summary>Attribution</summary>
                <p>{attribution}</p>
                {typeof navigator.clipboard?.writeText === 'function' && (
                  <div className="image-viewer-attribution-actions">
                    <button type="button" className="text-button" onClick={async () => {
                      try {
                        await navigator.clipboard.writeText([attribution, entry.url.href, licenseUrl?.href].filter(Boolean).join('\n'))
                        setCopyFeedback({ index, copied: true })
                      } catch {
                        setCopyFeedback({ index, copied: false })
                      }
                    }}>Copy attribution</button>
                    {copyFeedback?.index === index && <span role="status">
                      {copyFeedback.copied ? 'Attribution copied' : 'Select the attribution text to copy it.'}
                    </span>}
                  </div>
                )}
              </details>}
              <p>Check the original source before reusing this image.</p>
            </div>}
          </div>
          <div className="image-viewer-actions">
            {original && <a className="secondary-button" href={original.href} target="_blank" rel="noreferrer" title="Opens in a new tab">
              Open image <ExternalLink size={13} aria-hidden="true" />
            </a>}
            <a className="button" href={entry.url.href} target={target} rel="noreferrer">{imageLicense ? 'Visit original source' : 'Visit site'}</a>
          </div>
        </footer>
      </div>
    </dialog>
  )
}
