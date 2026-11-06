import type { PresentationController } from './controller.js'

/**
 * Plays a slide's embedded audio or video in place, one player at a time: only formats browsers
 * play natively, loaded from the asset store first (the first click on a not yet loaded video
 * still plays it). The player lives in a layer of its own, so redrawing the slide keeps it.
 */
export class MediaPlayer {
  private media?: HTMLMediaElement
  private token = 0
  /** The slide the player belongs to. */
  slide?: string

  constructor(private readonly controller: PresentationController) {}

  get element(): HTMLMediaElement | undefined {
    return this.media
  }

  async play(button: HTMLElement, currentLayer: () => HTMLElement | undefined, slide: string): Promise<void> {
    const part = button.dataset.media
    const shape = button.closest<HTMLElement>('[data-key]')
    if (!part || !shape) return
    this.stop()
    const token = this.token
    const kind = button.dataset.mediaKind === 'audio' ? 'audio' : 'video'
    // Loading an asset redraws the slide before the await resumes, detaching its shape.
    const style = `position:absolute;left:${shape.offsetLeft}px;top:${shape.offsetTop}px;width:${shape.offsetWidth}px;height:${kind === 'audio' ? 40 : shape.offsetHeight}px;transform:rotate(${Number(shape.dataset.rot) || 0}deg);z-index:1`
    const url = await this.controller.loadAssetUrl(part)
    if (!url || token !== this.token) return
    // Present mode also replaces the layer; the view resolves it only while this slide is active.
    const layer = currentLayer()
    if (!layer?.isConnected) return
    const media = document.createElement(kind)
    media.src = url
    media.controls = true
    media.autoplay = true
    media.className = 'pp-media-player'
    media.setAttribute('style', style)
    media.addEventListener('ended', () => {
      if (this.media === media) this.stop()
    })
    layer.append(media)
    this.media = media
    this.slide = slide
  }

  stop(): void {
    this.token++
    this.media?.pause()
    this.media?.remove()
    this.media = undefined
    this.slide = undefined
  }
}
