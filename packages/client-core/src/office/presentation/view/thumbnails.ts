import type { ChangeSet, PresentationController } from './controller.js'
import { readClipboard, writeClipboard } from './clipboard-io.js'
import { ensureStyles } from './styles.js'

/**
 * The slide list: a vertical thumbnail strip next to the canvas, or the grid of the slide sorter.
 * Thumbnails are the real renderer output scaled down, drawn lazily as they scroll into view.
 * Slides reorder by dragging (several at once when selected), with keyboard equivalents.
 */

export interface SlideListOptions {
  layout: 'strip' | 'grid'
  onContextMenu?(event: MouseEvent, slideKey: string): void
  /** Double click (or Enter) in the sorter opens a slide. */
  onOpen?(slideKey: string): void
}

interface DragState {
  pointerId: number
  startY: number
  startX: number
  keys: string[]
  active: boolean
  dropIndex?: number
}

export class SlideList {
  readonly element: HTMLElement
  private readonly unsubscribe: () => void
  private readonly observer?: IntersectionObserver
  private readonly visible = new Set<string>()
  private readonly drawn = new Map<string, string>()
  private drag?: DragState
  private width = 0

  constructor(
    container: HTMLElement,
    private readonly controller: PresentationController,
    private readonly options: SlideListOptions,
  ) {
    ensureStyles(container.ownerDocument)
    this.element = document.createElement('div')
    this.element.className = options.layout === 'grid' ? 'pp-sorter' : 'pp-thumbs'
    this.element.tabIndex = 0
    this.element.setAttribute('role', 'listbox')
    this.element.setAttribute('aria-multiselectable', 'true')
    container.append(this.element)
    if (typeof IntersectionObserver !== 'undefined') {
      this.observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const key = (entry.target as HTMLElement).dataset.slide!
            if (entry.isIntersecting) this.visible.add(key)
            else this.visible.delete(key)
          }
          this.drawThumbnails()
        },
        { root: this.element, rootMargin: '400px' },
      )
    }
    this.unsubscribe = controller.subscribe((change) => this.onChange(change))
    this.element.addEventListener('pointerdown', this.onPointerDown)
    this.element.addEventListener('pointermove', this.onPointerMove)
    this.element.addEventListener('pointerup', this.onPointerUp)
    this.element.addEventListener('pointercancel', this.onPointerUp)
    this.element.addEventListener('keydown', this.onKeyDown)
    this.element.addEventListener('dblclick', this.onDoubleClick)
    this.element.addEventListener('contextmenu', this.onContextMenu)
    this.build()
  }

  destroy(): void {
    this.unsubscribe()
    this.observer?.disconnect()
    this.element.remove()
  }

  private onChange(change: ChangeSet): void {
    if (change.order || change.parts) {
      this.build()
      return
    }
    for (const key of change.slides) this.drawn.delete(key)
    if (change.assets) this.drawn.clear()
    if (change.selection || change.presence) this.updateSelection()
    this.drawThumbnails()
  }

  private build(): void {
    const keys = this.controller.slideKeys()
    const sections = this.controller.sections()
    this.observer?.disconnect()
    this.element.replaceChildren()
    this.drawn.clear()
    this.width = 0
    keys.forEach((key, index) => {
      const section = sections.find((entry) => entry.firstSlide === key)
      if (section && this.options.layout === 'strip') {
        const header = document.createElement('div')
        header.className = 'pp-section'
        header.textContent = section.name
        this.element.append(header)
      }
      const item = document.createElement('div')
      item.className = 'pp-thumb'
      item.dataset.slide = key
      item.setAttribute('role', 'option')
      item.setAttribute('aria-label', this.controller.labels.slideNumber.replace('{n}', String(index + 1)))
      item.innerHTML = `<span class="pp-thumb-number">${index + 1}</span><div class="pp-thumb-frame"><div class="pp-thumb-content"></div><div class="pp-thumb-presence"></div></div>`
      this.element.append(item)
      this.observer?.observe(item)
    })
    if (!this.observer) for (const key of keys) this.visible.add(key)
    this.updateSelection()
    requestAnimationFrame(() => this.drawThumbnails())
  }

  private updateSelection(): void {
    const { slide, slides } = this.controller.state
    const remote = this.controller.remoteSelections()
    for (const item of Array.from(this.element.querySelectorAll<HTMLElement>('.pp-thumb'))) {
      const key = item.dataset.slide!
      item.setAttribute('aria-selected', String(slides.includes(key)))
      item.classList.toggle('pp-thumb-current', key === slide)
      item.classList.toggle('pp-thumb-hidden', this.controller.slide(key)?.hidden === true)
      const presence = item.querySelector('.pp-thumb-presence')!
      presence.innerHTML = remote
        .filter((entry) => entry.slide === key)
        .map((entry) => `<span title="${entry.name.replace(/[<>&"]/g, '')}" style="background:${entry.color}"></span>`)
        .join('')
    }
    const current = this.element.querySelector<HTMLElement>('.pp-thumb-current')
    current?.scrollIntoView?.({ block: 'nearest' })
  }

  private drawThumbnails(): void {
    const size = this.controller.size()
    for (const item of Array.from(this.element.querySelectorAll<HTMLElement>('.pp-thumb'))) {
      const key = item.dataset.slide!
      const frame = item.querySelector<HTMLElement>('.pp-thumb-frame')!
      const width = frame.clientWidth || this.width || 160
      this.width = width
      const scale = width / size.width
      frame.style.height = `${size.height * scale}px`
      if (!this.visible.has(key)) continue
      const version = `${this.controller.slideVersion(key)}@${width}`
      if (this.drawn.get(key) === version) continue
      this.drawn.set(key, version)
      const content = frame.querySelector<HTMLElement>('.pp-thumb-content')!
      content.style.transform = `scale(${scale})`
      content.innerHTML = this.controller.slideHtml(key, 'view', `thumb-${key}`)
    }
  }

  private itemAt(target: EventTarget | null): HTMLElement | undefined {
    return target instanceof Element ? (target.closest<HTMLElement>('.pp-thumb') ?? undefined) : undefined
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    const item = this.itemAt(event.target)
    if (!item || event.button !== 0) return
    const key = item.dataset.slide!
    this.element.focus({ preventScroll: true })
    const extend = event.shiftKey ? 'range' : event.metaKey || event.ctrlKey ? 'toggle' : 'replace'
    if (extend !== 'replace' || !this.controller.state.slides.includes(key)) this.controller.goToSlide(key, extend)
    else this.controller.setState({ slide: key, shapes: [], editing: undefined })
    if (this.controller.readOnly) return
    this.drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, keys: this.controller.state.slides, active: false }
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    const drag = this.drag
    if (!drag || drag.pointerId !== event.pointerId) return
    if (!drag.active) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return
      drag.active = true
      this.element.setPointerCapture?.(event.pointerId)
    }
    const items = Array.from(this.element.querySelectorAll<HTMLElement>('.pp-thumb'))
    let index = items.length
    for (const [position, item] of items.entries()) {
      const rect = item.getBoundingClientRect()
      const before = this.options.layout === 'grid' ? event.clientY < rect.bottom && event.clientX < rect.left + rect.width / 2 : event.clientY < rect.top + rect.height / 2
      if (before) {
        index = position
        break
      }
    }
    drag.dropIndex = index
    this.element.querySelector('.pp-thumb-drop')?.remove()
    const marker = document.createElement('div')
    marker.className = 'pp-thumb-drop'
    this.element.insertBefore(marker, items[index] ?? null)
  }

  private readonly onPointerUp = (event: PointerEvent): void => {
    const drag = this.drag
    this.drag = undefined
    this.element.querySelector('.pp-thumb-drop')?.remove()
    if (!drag?.active || drag.dropIndex === undefined || drag.pointerId !== event.pointerId) return
    const keys = this.controller.slideKeys()
    // The drop index counts dragged slides too; convert it to an index among the others.
    const before = keys.slice(0, drag.dropIndex).filter((key) => !drag.keys.includes(key)).length
    this.controller.moveSlides(drag.keys, before)
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const controller = this.controller
    const keys = controller.slideKeys()
    const index = controller.state.slide ? keys.indexOf(controller.state.slide) : -1
    const mod = event.metaKey || event.ctrlKey
    const step = this.options.layout === 'grid' ? { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -this.columns(), ArrowDown: this.columns() } : { ArrowUp: -1, ArrowDown: 1 }
    const delta = (step as Record<string, number>)[event.key]
    if (delta !== undefined) {
      event.preventDefault()
      const next = keys[Math.min(keys.length - 1, Math.max(0, index + delta))]
      if (!next) return
      if (mod && event.shiftKey && !controller.readOnly) {
        // Moves the selection as a block, by `delta` places among the slides not selected.
        const selected = controller.state.slides.filter((key) => keys.includes(key))
        const before = (key: string) => keys.slice(0, keys.indexOf(key)).filter((other) => !selected.includes(other)).length
        const remaining = keys.length - selected.length
        const toIndex = delta < 0 ? before(selected[0]!) + delta : before(selected[selected.length - 1]!) + delta
        if (selected.length) controller.moveSlides(selected, Math.max(0, Math.min(remaining, toIndex)))
      } else controller.goToSlide(next, event.shiftKey ? 'range' : 'replace')
      return
    }
    if (mod && event.key.toLowerCase() === 'c') {
      event.preventDefault()
      void controller.copy('slides').then((copied) => copied && writeClipboard(copied)).catch(() => {})
      return
    }
    if (controller.readOnly) return
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      controller.deleteSlides()
    } else if (mod && event.key.toLowerCase() === 'd') {
      event.preventDefault()
      controller.duplicateSlides()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (this.options.onOpen && controller.state.slide) this.options.onOpen(controller.state.slide)
      else controller.addSlide()
    } else if (mod && event.key.toLowerCase() === 'x') {
      event.preventDefault()
      void controller.copy('slides').then(async (copied) => {
        if (!copied) return
        await writeClipboard(copied)
        controller.deleteSlides()
      }).catch(() => {})
    } else if (mod && event.key.toLowerCase() === 'v') {
      event.preventDefault()
      void readClipboard().then((payload) => (payload ? controller.paste(payload, 'slides') : false))
    }
  }

  private columns(): number {
    const items = Array.from(this.element.querySelectorAll<HTMLElement>('.pp-thumb'))
    if (items.length < 2) return 1
    const top = items[0]!.offsetTop
    return Math.max(1, items.findIndex((item) => item.offsetTop !== top) === -1 ? items.length : items.findIndex((item) => item.offsetTop !== top))
  }

  private readonly onDoubleClick = (event: MouseEvent): void => {
    const item = this.itemAt(event.target)
    if (item && this.options.onOpen) this.options.onOpen(item.dataset.slide!)
  }

  private readonly onContextMenu = (event: MouseEvent): void => {
    const item = this.itemAt(event.target)
    if (!item || !this.options.onContextMenu) return
    event.preventDefault()
    const key = item.dataset.slide!
    if (!this.controller.state.slides.includes(key)) this.controller.goToSlide(key)
    this.options.onContextMenu(event, key)
  }
}
