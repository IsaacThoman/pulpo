import { ChevronLeft, ChevronRight, Image, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { safeHttpUrl } from './navigation'
import { ResultImage } from './ResultImage'
import type { ResultWithUrl } from './result-order'

interface ImageViewerProps {
  entries: readonly ResultWithUrl[]
  startIndex: number
  opener: HTMLButtonElement
  newTab: boolean
  close: () => void
}

export function ImageViewer({ entries, startIndex, opener, newTab, close }: ImageViewerProps) {
  const [index, setIndex] = useState(startIndex)
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
  const { imageUrl, thumbnailUrl, imageDimensions } = entry.result
  const original = safeHttpUrl(imageUrl)
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
            <span>{entry.host}{imageDimensions && ' · ' + imageDimensions.width + ' × ' + imageDimensions.height}</span>
          </div>
          <div className="image-viewer-actions">
            {original && <a className="secondary-button" href={original.href} target={target} rel="noreferrer">Open image</a>}
            <a className="button" href={entry.url.href} target={target} rel="noreferrer">Visit site</a>
          </div>
        </footer>
      </div>
    </dialog>
  )
}
