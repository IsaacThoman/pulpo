import { Play, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { getVideoEmbed } from './video-embed'
import './video-preview.css'

interface VideoPreviewProps {
  url: string
  title: string
  newTab: boolean
}

export function VideoPreview({ url, title, newTab }: VideoPreviewProps) {
  const opener = useRef<HTMLButtonElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const titleId = useId()
  const video = getVideoEmbed(url)

  useEffect(() => {
    const current = dialog.current
    const trigger = opener.current
    if (!open || !current) return
    current.showModal()
    closeButton.current?.focus()
    return () => {
      const active = document.activeElement
      current.close()
      if (trigger?.isConnected && (current.contains(active) || active === document.body)) {
        trigger.focus({ preventScroll: true })
      }
    }
  }, [open])

  if (!video) return null

  return (
    <>
      <button type="button" ref={opener} className="secondary-button video-preview-trigger"
        aria-label={'Watch here: ' + title} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Play size={14} aria-hidden="true" />
        Watch here
      </button>
      {open && (
        <dialog ref={dialog} className="dialog video-preview" aria-labelledby={titleId}
          onCancel={event => { event.preventDefault(); setOpen(false) }}
          onClick={event => { if (event.target === event.currentTarget) setOpen(false) }}>
          <header className="video-preview-header">
            <h2 id={titleId}>{title}</h2>
            <button type="button" ref={closeButton} className="icon-button" aria-label="Close video preview" onClick={() => setOpen(false)}>
              <X size={20} aria-hidden="true" />
            </button>
          </header>
          <iframe className="video-preview-frame" src={video.playerUrl} title={video.provider + ' video player'}
            referrerPolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin"
            allow="encrypted-media; fullscreen; picture-in-picture" allowFullScreen />
          <footer className="video-preview-footer">
            <a className="secondary-button" href={video.sourceUrl} target={newTab ? '_blank' : undefined} rel="noreferrer">
              Watch on {video.provider}
            </a>
          </footer>
        </dialog>
      )}
    </>
  )
}
