import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { NodeSelection } from '@tiptap/pm/state'
import type { EditorView, NodeView } from '@tiptap/pm/view'
import { drawingInfo, resizeDrawing, type DrawingInfo } from '../drawing.js'
import { unpackJml, type JmlElement } from '../jsonml.js'
import { ommlToMathml } from '../omml.js'
import type { AssetUrls } from './assets.js'
import type { DocxLabels } from './labels.js'

function jml(value: unknown): JmlElement | undefined {
  return typeof value === 'string' ? unpackJml<JmlElement>(value) : undefined
}

const pt = (value: number) => `${Math.round(value * 100) / 100}pt`

interface DrawingViewOptions {
  urls: AssetUrls
  labels: DocxLabels
  readOnly: () => boolean
}

/**
 * A picture, chart, shape, or text box. Pictures show their image (cropped and sized as in the
 * file); anything a browser cannot draw shows a placeholder of the same size. Floating objects
 * are positioned against their paragraph (`data-anchor-*` lets pagination move page-relative
 * ones). Selected pictures get a resize handle that works with mouse, pen, and touch.
 */
export class DrawingView implements NodeView {
  dom: HTMLElement
  private frame: HTMLElement
  private info: DrawingInfo
  private handle: HTMLElement | undefined

  constructor(
    private node: ProseMirrorNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
    private readonly options: DrawingViewOptions,
  ) {
    this.info = drawingInfo(jml(node.attrs.v) ?? ['w:drawing', {}])
    this.dom = document.createElement('span')
    this.frame = document.createElement('span')
    this.render()
  }

  private render(): void {
    const { info } = this
    this.dom.replaceChildren()
    this.frame = document.createElement('span')
    this.frame.className = 'docx-drawing'
    this.frame.contentEditable = 'false'
    this.frame.style.width = pt(info.width)
    this.frame.style.height = pt(info.height)
    if (info.description) {
      this.frame.title = info.description
      this.frame.setAttribute('aria-label', info.description)
    }
    this.frame.setAttribute('role', 'img')
    if (info.placement === 'anchor') {
      this.dom.className = 'docx-anchor'
      this.frame.classList.add('docx-float')
      this.placeFloat()
    } else {
      this.dom.className = ''
      this.dom.style.display = 'inline'
    }
    this.dom.appendChild(this.frame)
    const src = this.node.attrs.src as string | null
    if (src && (info.content === 'picture' || info.content === 'chart' || info.content === 'object' || info.content === 'shape')) this.showImage(src)
    else this.showPlaceholder()
  }

  private placeFloat(): void {
    const { info, frame } = this
    const horizontal = info.horizontal
    const vertical = info.vertical
    frame.dataset.anchorH = horizontal.relativeFrom
    frame.dataset.anchorV = vertical.relativeFrom
    if (vertical.offset !== undefined) frame.dataset.offsetV = String(vertical.offset)
    if (horizontal.offset !== undefined) frame.dataset.offsetH = String(horizontal.offset)
    if (info.behind) frame.dataset.behind = 'true'
    if (info.wrap === 'square' || info.wrap === 'tight' || info.wrap === 'through') {
      const right = horizontal.align === 'right' || horizontal.align === 'outside'
      frame.dataset.float = right ? 'right' : 'left'
      if (!right && horizontal.offset) frame.style.marginLeft = pt(Math.max(0, horizontal.offset))
      if (vertical.relativeFrom === 'paragraph' && vertical.offset && vertical.offset > 0) frame.style.marginTop = pt(vertical.offset)
      return
    }
    if (info.wrap === 'topAndBottom') {
      frame.style.position = 'relative'
      frame.style.display = 'block'
      frame.style.marginLeft = horizontal.align === 'center' ? 'auto' : pt(Math.max(0, horizontal.offset ?? 0))
      if (horizontal.align === 'center') frame.style.marginRight = 'auto'
      if (horizontal.align === 'right') frame.style.marginLeft = 'auto'
      return
    }
    // In front of or behind the text, positioned against the paragraph.
    frame.style.left = horizontal.align === 'center' ? `calc(50% - ${pt(info.width / 2)})` : horizontal.align === 'right' ? `calc(100% - ${pt(info.width)})` : pt(horizontal.offset ?? 0)
    frame.style.top = pt(vertical.relativeFrom === 'paragraph' || vertical.relativeFrom === 'line' ? (vertical.offset ?? 0) : 0)
  }

  private showImage(hash: string): void {
    const { crop } = this.info
    const image = document.createElement('img')
    image.alt = this.info.description ?? ''
    image.draggable = false
    image.decoding = 'async'
    const visibleWidth = 1 - crop.left - crop.right
    const visibleHeight = 1 - crop.top - crop.bottom
    if (visibleWidth < 1 || visibleHeight < 1) {
      this.frame.style.overflow = 'hidden'
      image.style.width = `${100 / visibleWidth}%`
      image.style.height = `${100 / visibleHeight}%`
      image.style.marginLeft = `${(-crop.left / visibleWidth) * 100}%`
      image.style.marginTop = `${(-crop.top / visibleHeight) * 100}%`
    }
    this.frame.appendChild(image)
    void this.options.urls.url(hash).then((url) => {
      if (!this.frame.isConnected && !this.dom.isConnected) return
      if (url) image.src = url
      else {
        image.remove()
        this.showPlaceholder(this.options.labels.unsupportedImage)
      }
    })
  }

  private showPlaceholder(text?: string): void {
    const { labels } = this.options
    this.frame.dataset.placeholder = this.info.content
    const label = text ?? (this.info.content === 'chart' ? labels.chart : this.info.content === 'shape' ? labels.shape : this.info.content === 'textBox' ? '' : this.info.content === 'picture' ? labels.image : labels.embeddedObject)
    if (this.info.text) {
      const content = document.createElement('span')
      content.className = 'docx-drawing-text'
      content.textContent = this.info.text
      this.frame.appendChild(content)
    } else if (label) {
      this.frame.textContent = label
    }
  }

  selectNode(): void {
    this.frame.classList.add('ProseMirror-selectednode')
    if (this.options.readOnly() || this.info.placement !== 'inline') return
    this.handle = document.createElement('span')
    this.handle.className = 'docx-resize-handle'
    Object.assign(this.handle.style, {
      position: 'absolute', right: '-5px', bottom: '-5px', width: '10px', height: '10px', background: '#1a73e8',
      border: '1px solid #fff', borderRadius: '2px', cursor: 'nwse-resize', touchAction: 'none', zIndex: '2',
    })
    this.handle.addEventListener('pointerdown', this.startResize)
    this.frame.appendChild(this.handle)
  }

  deselectNode(): void {
    this.frame.classList.remove('ProseMirror-selectednode')
    this.handle?.remove()
    this.handle = undefined
  }

  private startResize = (event: PointerEvent) => {
    event.preventDefault()
    event.stopPropagation()
    const handle = event.currentTarget as HTMLElement
    handle.setPointerCapture(event.pointerId)
    const start = { x: event.clientX, y: event.clientY, width: this.info.width, height: this.info.height }
    const rect = this.frame.getBoundingClientRect()
    // Screen pixels per point, which includes the editor's zoom.
    const scale = rect.width / this.info.width || 4 / 3
    const ratio = start.height / start.width
    const move = (moveEvent: PointerEvent) => {
      const width = Math.max(8, start.width + (moveEvent.clientX - start.x) / scale)
      const height = moveEvent.shiftKey ? Math.max(8, start.height + (moveEvent.clientY - start.y) / scale) : width * ratio
      this.frame.style.width = pt(width)
      this.frame.style.height = pt(height)
    }
    const end = (endEvent: PointerEvent) => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', end)
      const width = Math.max(8, start.width + (endEvent.clientX - start.x) / scale)
      const height = endEvent.shiftKey ? Math.max(8, start.height + (endEvent.clientY - start.y) / scale) : width * ratio
      const pos = this.getPos()
      const element = jml(this.node.attrs.v)
      if (pos === undefined || !element || endEvent.type === 'pointercancel') {
        this.render()
        return
      }
      const transaction = this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, v: resizeDrawing(element, width, height) })
      transaction.setSelection(NodeSelection.create(transaction.doc, pos))
      this.view.dispatch(transaction)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) return false
    if (node.attrs.v !== this.node.attrs.v || node.attrs.src !== this.node.attrs.src) {
      this.node = node
      this.info = drawingInfo(jml(node.attrs.v) ?? ['w:drawing', {}])
      this.render()
      return true
    }
    this.node = node
    return true
  }

  stopEvent(event: Event): boolean {
    return this.handle !== undefined && event.target === this.handle
  }

  ignoreMutation(): boolean {
    return true
  }
}

/** An equation, drawn as MathML from its Office Math. */
export class MathView implements NodeView {
  dom: HTMLElement

  constructor(private node: ProseMirrorNode, labels: DocxLabels) {
    this.dom = document.createElement('span')
    this.dom.className = 'docx-math'
    this.dom.contentEditable = 'false'
    this.dom.setAttribute('role', 'math')
    this.dom.setAttribute('aria-label', labels.equation)
    this.render()
  }

  private render(): void {
    const element = jml(this.node.attrs.v)
    if (element?.[0] === 'm:oMathPara') this.dom.dataset.display = 'true'
    // The converter builds MathML from escaped text only, so it is safe to parse.
    this.dom.innerHTML = element ? ommlToMathml(element) : ''
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) return false
    const changed = node.attrs.v !== this.node.attrs.v
    this.node = node
    if (changed) this.render()
    return true
  }

  ignoreMutation(): boolean {
    return true
  }
}
