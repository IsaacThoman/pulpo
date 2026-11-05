import { textToPlain } from '../text.js'
import type { PresentationController } from './controller.js'
import { MediaPlayer } from './media.js'
import { ensureStyles } from './styles.js'

/**
 * Present mode: one slide at a time, full screen, scaled to fit, advanced by keyboard, click,
 * tap, or swipe; hidden slides are skipped. The presenter view adds the next slide, speaker
 * notes, a timer, and the slide count. Transitions play as a cross-fade; animations are kept in
 * the file but not played.
 */

export interface PresenterOptions {
  /** Slide to start from (defaults to the first visible slide). */
  startAt?: string
  presenterView?: boolean
  onExit(): void
}

export class Presenter {
  readonly element: HTMLElement
  private index = 0
  private ended = false
  private readonly started = Date.now()
  private timer?: ReturnType<typeof setInterval>
  private touch?: { x: number; y: number; time: number }
  private readonly unsubscribe: () => void
  private numberBuffer = ''
  private readonly media: MediaPlayer

  constructor(
    private readonly controller: PresentationController,
    private readonly options: PresenterOptions,
  ) {
    ensureStyles(document)
    this.media = new MediaPlayer(controller)
    this.element = document.createElement('div')
    this.element.className = options.presenterView ? 'pp-presenter' : 'pp-present'
    this.element.tabIndex = 0
    this.element.setAttribute('role', 'dialog')
    this.element.setAttribute('aria-modal', 'true')
    document.body.append(this.element)
    this.index = options.startAt ? this.visibleIndexFrom(options.startAt) : 0
    // On the document, not the element: menus that opened the show hand focus back to their trigger.
    document.addEventListener('keydown', this.onKeyDown, true)
    this.element.addEventListener('click', this.onClick)
    this.element.addEventListener('pointerdown', this.onPointerDown)
    this.element.addEventListener('pointerup', this.onPointerUp)
    window.addEventListener('resize', this.draw)
    this.unsubscribe = controller.subscribe(() => this.draw())
    if (options.presenterView) this.timer = setInterval(() => this.drawTimer(), 1000)
    this.draw()
    this.element.focus()
    if (!options.presenterView) void this.element.requestFullscreen?.().catch(() => undefined)
    document.addEventListener('fullscreenchange', this.onFullscreenChange)
  }

  /** Slides shown in the show: everything but hidden slides. */
  visibleSlides(): string[] {
    return this.controller.slideKeys().filter((key) => !this.controller.slide(key)?.hidden)
  }

  /** The shown slide at or after `key` in the deck (a hidden slide starts the show at the next one). */
  private visibleIndexFrom(key: string): number {
    const all = this.controller.slideKeys()
    const visible = this.visibleSlides()
    const start = Math.max(0, all.indexOf(key))
    for (let index = start; index < all.length; index++) {
      const at = visible.indexOf(all[index]!)
      if (at >= 0) return at
    }
    return Math.max(0, visible.length - 1)
  }

  /** Slide number `number` of the deck, counting hidden slides, as PowerPoint's number + Enter does. */
  goToSlideNumber(number: number): void {
    const key = this.controller.slideKeys()[Math.max(0, Math.min(this.controller.slideKeys().length - 1, number - 1))]
    if (key) this.goTo(this.visibleIndexFrom(key))
  }

  current(): string | undefined {
    return this.visibleSlides()[this.index]
  }

  next(): void {
    const slides = this.visibleSlides()
    if (this.index < slides.length - 1) this.index++
    else this.ended = true
    this.draw()
  }

  previous(): void {
    if (this.ended) this.ended = false
    else this.index = Math.max(0, this.index - 1)
    this.draw()
  }

  goTo(index: number): void {
    this.index = Math.max(0, Math.min(this.visibleSlides().length - 1, index))
    this.ended = false
    this.draw()
  }

  exit(): void {
    if (this.timer) clearInterval(this.timer)
    this.media.stop()
    this.unsubscribe()
    window.removeEventListener('resize', this.draw)
    document.removeEventListener('keydown', this.onKeyDown, true)
    document.removeEventListener('fullscreenchange', this.onFullscreenChange)
    if (document.fullscreenElement === this.element) void document.exitFullscreen?.().catch(() => undefined)
    this.element.remove()
    this.options.onExit()
  }

  private readonly onFullscreenChange = (): void => {
    // Leaving full screen with the browser's own Escape ends the show too.
    if (!this.options.presenterView && !document.fullscreenElement && this.element.isConnected) this.exit()
  }

  private slideMarkup(key: string | undefined, width: number, height: number, prefix: string): string {
    if (!key) return ''
    const size = this.controller.size()
    const scale = Math.min(width / size.width, height / size.height)
    return `<div class="pp-present-stage" style="width:${size.width * scale}px;height:${size.height * scale}px"><div class="pp-present-content" style="transform:scale(${scale})">${this.controller.slideHtml(key, 'view', prefix)}</div></div>`
  }

  private readonly draw = (): void => {
    const slides = this.visibleSlides()
    if (this.index >= slides.length) this.index = Math.max(0, slides.length - 1)
    const key = slides[this.index]
    // Redrawing replaces the slide's DOM: a playing video moves into the new one, or stops on another slide.
    const playing = this.media.element
    if (playing && (this.media.slide !== key || this.ended)) this.media.stop()
    const resume = playing !== undefined && !playing.paused
    queueMicrotask(() => {
      const media = this.media.element
      if (!media || this.media.slide !== key) return
      const content = this.element.querySelector<HTMLElement>('.pp-present-content')
      if (!content || media.parentElement === content) return
      content.append(media)
      // Taking a media element out of the page pauses it.
      if (resume) void media.play().catch(() => undefined)
    })
    if (!this.options.presenterView) {
      if (this.ended || !key) {
        this.element.innerHTML = `<div class="pp-present-end">${escapeHtml(this.controller.labels.endOfShow)}</div>`
        return
      }
      const previous = this.element.querySelector<HTMLElement>('.pp-present-stage')
      const fade = previous?.dataset.slide !== key && this.controller.slide(key)?.xml.includes('transition')
      this.element.innerHTML = this.slideMarkup(key, window.innerWidth, window.innerHeight, 'present')
      const stage = this.element.querySelector<HTMLElement>('.pp-present-stage')
      if (stage) {
        stage.dataset.slide = key
        if (fade) stage.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 400, easing: 'ease-out' })
      }
      return
    }
    const labels = this.controller.labels
    const notes = key ? this.controller.slide(key)?.notes : undefined
    const notesText = notes ? textToPlain(notes.text).trim() : ''
    const width = window.innerWidth
    const height = window.innerHeight
    this.element.innerHTML = `
      <div class="pp-presenter-bar"><strong data-timer>${formatElapsed(Date.now() - this.started)}</strong><span>${this.index + 1} / ${slides.length}</span></div>
      <div class="pp-presenter-current-wrap">${this.ended ? `<div class="pp-present-end">${escapeHtml(labels.endOfShow)}</div>` : this.slideMarkup(key, width * 0.58, height - 120, 'presenter-current')}</div>
      <div class="pp-presenter-side">
        <div>${escapeHtml(labels.nextSlide)}</div>
        ${this.slideMarkup(slides[this.index + 1], width * 0.36, height * 0.3, 'presenter-next')}
        <div>${escapeHtml(labels.notes)}</div>
        <div class="pp-presenter-notes">${notesText ? escapeHtml(notesText) : `<em>${escapeHtml(labels.noNotes)}</em>`}</div>
      </div>`
  }

  private drawTimer(): void {
    const timer = this.element.querySelector('[data-timer]')
    if (timer) timer.textContent = formatElapsed(Date.now() - this.started)
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    event.stopPropagation()
    const key = event.key
    if (/^\d$/.test(key)) {
      this.numberBuffer += key
      return
    }
    if (key === 'Enter' && this.numberBuffer) {
      this.goToSlideNumber(Number(this.numberBuffer))
      this.numberBuffer = ''
      return
    }
    this.numberBuffer = ''
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n', 'N'].includes(key)) {
      event.preventDefault()
      if (this.ended) this.exit()
      else this.next()
    } else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p', 'P'].includes(key)) {
      event.preventDefault()
      this.previous()
    } else if (key === 'Home') this.goTo(0)
    else if (key === 'End') this.goTo(this.visibleSlides().length - 1)
    else if (key === 'Escape') {
      event.preventDefault()
      this.exit()
    }
  }

  private readonly onClick = (event: MouseEvent): void => {
    const target = event.target as Element
    if (target.closest('.pp-media-player')) return
    const button = target.closest<HTMLElement>('.pp-media')
    if (button) {
      const content = button.closest<HTMLElement>('.pp-present-content')
      const key = this.current()
      if (content && key) void this.media.play(button, content, key)
      return
    }
    if (this.options.presenterView) return
    if (this.ended) this.exit()
    else this.next()
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') this.touch = { x: event.clientX, y: event.clientY, time: Date.now() }
  }

  private readonly onPointerUp = (event: PointerEvent): void => {
    const touch = this.touch
    this.touch = undefined
    if (!touch) return
    const dx = event.clientX - touch.x
    if (Math.abs(dx) > 50 && Date.now() - touch.time < 800) {
      event.preventDefault()
      if (dx < 0) this.next()
      else this.previous()
    }
  }
}

function formatElapsed(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Prints the deck one slide per page at the slide's own size (the browser's "Save as PDF" makes
 * a PDF of it). Hidden slides are left out, as PowerPoint does by default.
 */
export function printSlides(controller: PresentationController): void {
  const size = controller.size()
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  document.body.append(frame)
  const pages = controller
    .slideKeys()
    .filter((key) => !controller.slide(key)?.hidden)
    .map((key, index) => `<div class="pp-print-page">${controller.slideHtml(key, 'view', `print-${index}`)}</div>`)
    .join('')
  const document_ = frame.contentDocument!
  document_.open()
  document_.write(
    `<!doctype html><html><head><style>@page{size:${size.width}px ${size.height}px;margin:0}html,body{margin:0}.pp-print-page{width:${size.width}px;height:${size.height}px;overflow:hidden;break-after:page;page-break-after:always}.pp-print-page:last-child{break-after:auto}.pp-slide p,.pp-slide .pp-p{margin:0}</style></head><body>${pages}</body></html>`,
  )
  document_.close()
  // Images are object URLs of this page; give them a moment to decode before printing.
  setTimeout(() => {
    frame.contentWindow?.focus()
    frame.contentWindow?.print()
    setTimeout(() => frame.remove(), 1000)
  }, 300)
}
