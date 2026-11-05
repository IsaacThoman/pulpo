/*
 * The Jupyter notebook editor that runs inside the app's web view: the shared notebook controller
 * and cell editors (@pulpo/client-core/office/notebook/view) on a replica of the document the app
 * owns, drawn for phones. Like the other pages it has no network access and talks only through the
 * bridge (src/features/files/editor/protocol.ts); the app fetches the images outputs refer to.
 *
 * Notebooks are untrusted. Markdown cells are rendered and then sanitized to a short list of tags
 * and attributes; HTML and Markdown outputs are shown in iframes sandboxed without scripts (and
 * the page's own policy loads nothing from the network); JavaScript and widget outputs never run.
 */
import { indentLess, indentMore } from '@codemirror/commands'
import type { LiveAssetRef, LiveAssetStore } from '@pulpo/client-core/office'
import {
  ansiHtml,
  cellsMap,
  imageDataUrl,
  LiveFormatError,
  NOTEBOOK_SCHEMA_VERSION,
  outputText,
  pickOutputMime,
  resolveAttachmentUrl,
  svgDataUrl,
  type MimeBundle,
  type NotebookCellType,
  type NotebookOutput,
} from '@pulpo/client-core/office/notebook'
import {
  createCellEditor,
  NotebookController,
  readAttachments,
  readOutputs,
  type CellEditor,
  type NotebookCellState,
  type NotebookEditorState,
} from '@pulpo/client-core/office/notebook/view'
import { Marked } from 'marked'
import { applyAwarenessUpdate, Awareness, removeAwarenessStates } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { base64ToBytes, bytesToBase64 } from '../../src/features/files/editor/base64'
import { EDITOR_PROTOCOL_VERSION, type EditorMessage, type EditorTheme, type HostMessage, type NotebookToolbarState } from '../../src/features/files/editor/protocol'
import './notebook.css'

declare global {
  interface Window {
    webkit?: { messageHandlers?: { pulpoEditor?: { postMessage(message: string): void } } }
    pulpoEditorAndroid?: { postMessage(message: string): void }
    pulpoEditor: { receive(message: string): void }
  }
}

const HOST = 'host'
const REMOTE = 'remote'
/** Outputs longer than this show their start; the full text is in the file. */
const MAX_OUTPUT_CHARACTERS = 20_000

function post(message: EditorMessage): void {
  const data = JSON.stringify(message)
  if (window.webkit?.messageHandlers?.pulpoEditor) window.webkit.messageHandlers.pulpoEditor.postMessage(data)
  else window.pulpoEditorAndroid?.postMessage(data)
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
}

/** Assets come from the app, which fetches them from the server by hash. */
class BridgeAssetStore implements LiveAssetStore {
  private readonly pending = new Map<string, { resolve: (bytes: Uint8Array) => void; reject: (error: Error) => void }[]>()
  private readonly cache = new Map<string, Uint8Array>()
  constructor(private readonly session: number) {}

  put(): Promise<LiveAssetRef> {
    return Promise.reject(new LiveFormatError('unsupported', 'Assets are added from the app'))
  }

  get(hash: string): Promise<Uint8Array> {
    const cached = this.cache.get(hash)
    if (cached) return Promise.resolve(cached.slice())
    return new Promise((resolve, reject) => {
      const waiting = this.pending.get(hash)
      if (waiting) {
        waiting.push({ resolve, reject })
        return
      }
      this.pending.set(hash, [{ resolve, reject }])
      post({ type: 'asset', session: this.session, hash })
    })
  }

  receive(hash: string, data: string | null): void {
    const waiting = this.pending.get(hash) ?? []
    this.pending.delete(hash)
    if (data === null) {
      for (const { reject } of waiting) reject(new LiveFormatError('corrupt', 'This image is not on this device'))
      return
    }
    const bytes = base64ToBytes(data)
    this.cache.set(hash, bytes)
    for (const { resolve } of waiting) resolve(bytes.slice())
  }
}

// Markdown cells: rendered by marked, then reduced to what reading needs.
const markdown = new Marked({ gfm: true, breaks: false, async: false })
const ALLOWED_TAGS = new Set(['p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'code', 'pre', 'blockquote',
  'ul', 'ol', 'li', 'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'sub', 'sup', 'span', 'div', 'kbd', 'details', 'summary', 'dl', 'dt', 'dd'])
const ALLOWED_ATTRIBUTES = new Set(['href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'align', 'start'])

function sanitize(html: string, attachments: Record<string, MimeBundle>): DocumentFragment {
  const template = document.createElement('template')
  template.innerHTML = html
  const walk = (parent: ParentNode) => {
    for (const node of [...parent.childNodes]) {
      if (node.nodeType === Node.TEXT_NODE) continue
      if (node.nodeType !== Node.ELEMENT_NODE) {
        node.remove()
        continue
      }
      const element = node as Element
      const tag = element.tagName.toLowerCase()
      if (!ALLOWED_TAGS.has(tag)) {
        // Unknown elements keep their text; scripts, styles, and frames go entirely.
        if (['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'form', 'input', 'button', 'textarea', 'select', 'link', 'meta'].includes(tag)) element.remove()
        else element.replaceWith(...element.childNodes)
        walk(parent)
        return
      }
      for (const attribute of [...element.attributes]) {
        const name = attribute.name.toLowerCase()
        let keep = ALLOWED_ATTRIBUTES.has(name)
        if (name === 'href') keep = /^(https?:|mailto:|#)/i.test(attribute.value.trim())
        if (name === 'src') {
          const resolved = attribute.value.startsWith('attachment:') ? resolveAttachmentUrl(attribute.value, attachments) : attribute.value
          const match = resolved ? /^data:(image\/(?:png|jpeg|gif|webp));base64,(.*)$/s.exec(resolved) : null
          const safe = match ? imageDataUrl(match[1]!, match[2]) : resolved?.startsWith('data:image/svg+xml') ? resolved : null
          if (safe) element.setAttribute('src', safe)
          keep = Boolean(safe)
        }
        if (!keep) element.removeAttribute(attribute.name)
      }
      walk(element)
    }
  }
  walk(template.content)
  return template.content
}

function renderMarkdown(source: string, attachments: Record<string, MimeBundle>): DocumentFragment {
  if (source.length > 100_000) {
    const fragment = document.createDocumentFragment()
    const pre = document.createElement('pre')
    pre.textContent = source
    fragment.append(pre)
    return fragment
  }
  return sanitize(markdown.parse(source) as string, attachments)
}

// Outputs.
const OUTPUT_TYPES = ['text/html', 'image/svg+xml', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'text/markdown', 'text/latex', 'application/json', 'text/plain']

/** A document for an output frame: no scripts run in it (the sandbox has none), and nothing loads (the page's policy). */
function frameDocument(body: string, theme: EditorTheme | null): string {
  const dark = theme?.dark ?? false
  const [background, text, stripe, rule] = dark ? ['#0d1117', '#e6edf3', '#161b22', '#30363d'] : ['#ffffff', '#1f2328', '#f6f8fa', '#d0d7de']
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:${background};color:${text}}body{padding:6px 8px;font:13px/1.45 -apple-system,system-ui,sans-serif;overflow-x:auto}table{border:none;border-collapse:collapse;font-size:12px}th,td{padding:3px 8px;text-align:right;border:none}thead{border-bottom:1px solid ${rule}}tbody tr:nth-child(odd){background:${stripe}}img{max-width:100%}</style></head><body>${body}</body></html>`
}

function sandboxedFrame(html: string): HTMLIFrameElement {
  const frame = document.createElement('iframe')
  // Same origin so the page can size the frame to its content, but no scripts, forms, or popups.
  frame.setAttribute('sandbox', 'allow-same-origin')
  frame.setAttribute('title', 'Notebook output')
  frame.className = 'output-frame'
  frame.srcdoc = frameDocument(html, current?.theme ?? null)
  frame.addEventListener('load', () => {
    // The body's height, not the document's, which is at least the frame's own.
    const body = frame.contentDocument?.body
    const height = body ? Math.ceil(body.getBoundingClientRect().height) : 120
    frame.style.height = `${Math.min(1200, Math.max(24, height))}px`
  })
  return frame
}

function outputElement(output: NotebookOutput): HTMLElement | null {
  const pre = (className: string, html: string) => {
    const element = document.createElement('pre')
    element.className = `output ${className}`
    element.innerHTML = html
    return element
  }
  const long = (text: string) => (text.length > MAX_OUTPUT_CHARACTERS ? `${text.slice(0, MAX_OUTPUT_CHARACTERS)}\n…` : text)
  if (output.type === 'stream') return pre(`stream ${output.name}`, ansiHtml(long(output.text)))
  if (output.type === 'error') return pre('error', ansiHtml(long(output.traceback.length ? output.traceback.join('\n') : `${output.ename}: ${output.evalue}`)))
  const mime = pickOutputMime(output.data, OUTPUT_TYPES)
  const data = mime ? output.data[mime] : undefined
  switch (mime) {
    case 'text/html': return sandboxedFrame(String(data))
    case 'text/markdown': return sandboxedFrame(markdown.parse(String(data)) as string)
    case 'image/svg+xml':
    case 'image/png':
    case 'image/jpeg':
    case 'image/gif':
    case 'image/webp': {
      const url = mime === 'image/svg+xml' ? svgDataUrl(data) : imageDataUrl(mime, data)
      if (!url) return null
      const image = document.createElement('img')
      image.className = 'output image'
      image.alt = ''
      image.src = url
      return image
    }
    case 'application/json': return pre('json', escapeHtml(long(outputText(mime, data))))
    case 'text/latex':
    case 'text/plain': return pre('text', ansiHtml(long(String(data))))
    default: {
      const note = document.createElement('p')
      note.className = 'output note'
      note.textContent = output.data['application/vnd.jupyter.widget-view+json'] || output.data['application/javascript']
        ? 'Interactive output runs only in Jupyter.'
        : `This output can’t be shown here (${Object.keys(output.data).join(', ')}).`
      return note
    }
  }
}

const ICONS = {
  up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  down: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
}
function icon(name: keyof typeof ICONS): string {
  return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`
}

interface CellView {
  key: string
  element: HTMLElement
  prompt: HTMLElement
  tools: HTMLElement
  body: HTMLElement
  outputs: HTMLElement
  peers: HTMLElement
  editor: CellEditor | null
  rendered: string | null
  outputsKey: string | null
  near: boolean
}

interface Open {
  session: number
  doc: Y.Doc
  awareness: Awareness
  controller: NotebookController
  assets: BridgeAssetStore
  views: Map<string, CellView>
  theme: EditorTheme
  editable: boolean
  observer: IntersectionObserver
  unsubscribe: () => void
}

let current: Open | null = null
const root = document.getElementById('notebook')!

function applyTheme(theme: EditorTheme): void {
  const style = document.documentElement.style
  style.setProperty('--background', theme.background)
  style.setProperty('--foreground', theme.foreground)
  style.setProperty('--muted', theme.muted)
  style.setProperty('--muted-foreground', theme.mutedForeground)
  style.setProperty('--border', theme.border)
  style.setProperty('--accent', theme.muted)
  style.setProperty('--ring', theme.primary)
  style.setProperty('--primary', theme.primary)
  style.setProperty('--code', theme.code)
  style.setProperty('--font-size', `${theme.fontSize}px`)
  style.setProperty('--pulpo-code-font-size', `${Math.max(11, Math.round(theme.fontSize * 0.8))}px`)
  style.setProperty('--bottom-padding', `${theme.bottomPadding}px`)
  document.documentElement.classList.toggle('dark', theme.dark)
  document.documentElement.style.colorScheme = theme.dark ? 'dark' : 'light'
  if (!current) return
  const darkChanged = current.theme.dark !== theme.dark
  current.theme = theme
  for (const view of current.views.values()) {
    view.editor?.setDark(theme.dark)
    // Output frames carry their own colors.
    if (darkChanged) view.outputsKey = null
  }
  if (darkChanged) render()
}

function toolbarState(state: NotebookEditorState): NotebookToolbarState {
  const active = state.cells.find((cell) => cell.key === state.active) ?? null
  return {
    canUndo: state.canUndo,
    canRedo: state.canRedo,
    cellType: active?.type ?? null,
    editing: state.mode === 'edit',
    outputsCollapsed: active?.outputsCollapsed ?? false,
    readOnly: state.readOnly,
    cells: state.cells.length,
  }
}

function mountEditor(open: Open, view: CellView, cell: NotebookCellState, focus: boolean): void {
  if (view.editor) return
  const text = open.controller.sourceOf(cell.key)
  if (!text) return
  view.body.replaceChildren()
  view.rendered = null
  const { controller } = open
  const key = cell.key
  view.editor = createCellEditor({
    container: view.body,
    text,
    awareness: open.awareness,
    undoManager: controller.undoManager,
    type: cell.type,
    language: controller.getState().language,
    readOnly: !open.editable || controller.getState().readOnly,
    dark: open.theme.dark,
    label: `${cell.type === 'code' ? 'Code' : cell.type === 'markdown' ? 'Markdown' : 'Raw'} cell`,
    placeholder: cell.type === 'markdown' ? 'Write Markdown' : cell.type === 'code' ? 'Write code' : undefined,
    onFocus: () => controller.select(key, { mode: 'edit' }),
    onShiftEnter: () => controller.advance(),
    onModEnter: () => controller.setMode('command'),
    onEscape: () => controller.setMode('command'),
    onLeave: (direction) => { controller.step(direction, { mode: 'edit' }) },
  })
  if (focus) view.editor.focus('end')
}

function unmountEditor(view: CellView): void {
  view.editor?.destroy()
  view.editor = null
  view.body.replaceChildren()
}

function createView(open: Open, cell: NotebookCellState): CellView {
  const element = document.createElement('section')
  element.className = 'cell'
  element.dataset.cellKey = cell.key
  const head = document.createElement('div')
  head.className = 'cell-head'
  const prompt = document.createElement('span')
  prompt.className = 'prompt'
  const peers = document.createElement('span')
  peers.className = 'peers'
  const tools = document.createElement('div')
  tools.className = 'tools'
  head.append(prompt, peers, tools)
  const body = document.createElement('div')
  body.className = 'cell-body'
  const outputs = document.createElement('div')
  outputs.className = 'outputs'
  element.append(head, body, outputs)
  const view: CellView = { key: cell.key, element, prompt, tools, body, outputs, peers, editor: null, rendered: null, outputsKey: null, near: false }
  element.addEventListener('click', (event) => {
    const target = event.target as HTMLElement
    const link = target.closest('a')
    if (link) {
      event.preventDefault()
      const href = link.getAttribute('href')
      if (href && /^(https?:|mailto:)/i.test(href)) post({ type: 'link', session: open.session, href })
      return
    }
    if (target.closest('.tools, .cm-editor')) return
    const state = open.controller.getState()
    const cellState = state.cells.find((item) => item.key === cell.key)
    // A second tap on the active Markdown cell edits it; any tap selects.
    if (state.active === cell.key && cellState?.type === 'markdown' && open.editable && !state.readOnly) open.controller.select(cell.key, { mode: 'edit' })
    else open.controller.select(cell.key)
  })
  tools.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest('button')
    if (!button) return
    event.stopPropagation()
    open.controller.select(cell.key)
    run(button.dataset.command!)
  })
  tools.addEventListener('change', (event) => {
    const select = event.target as HTMLSelectElement
    open.controller.select(cell.key)
    open.controller.setType(select.value as NotebookCellType)
  })
  open.observer.observe(element)
  return view
}

function updateTools(view: CellView, cell: NotebookCellState, active: boolean, editable: boolean): void {
  const signature = `${active}:${editable}:${cell.type}`
  if (view.tools.dataset.signature === signature) return
  view.tools.dataset.signature = signature
  if (!active || !editable) {
    view.tools.replaceChildren()
    return
  }
  view.tools.innerHTML = [
    `<select aria-label="Cell type">${(['code', 'markdown', 'raw'] as const).map((type) => `<option value="${type}"${type === cell.type ? ' selected' : ''}>${type === 'code' ? 'Code' : type === 'markdown' ? 'Markdown' : 'Raw'}</option>`).join('')}</select>`,
    `<button type="button" data-command="moveUp" aria-label="Move cell up">${icon('up')}</button>`,
    `<button type="button" data-command="moveDown" aria-label="Move cell down">${icon('down')}</button>`,
    `<button type="button" data-command="delete" aria-label="Delete cell">${icon('trash')}</button>`,
  ].join('')
}

function updateBody(open: Open, view: CellView, cell: NotebookCellState, editing: boolean): void {
  const wantsEditor = cell.type !== 'markdown' || editing
  if (wantsEditor) {
    if (view.near || editing) mountEditor(open, view, cell, editing && !view.editor)
    else if (view.rendered !== 'static') {
      // Until the cell comes near the screen, its source as plain text.
      const pre = document.createElement('pre')
      pre.className = 'static-source'
      pre.textContent = open.controller.sourceOf(cell.key)?.toString() ?? ''
      view.body.replaceChildren(pre)
      view.rendered = 'static'
    }
    view.editor?.setType(cell.type, open.controller.getState().language)
    return
  }
  if (view.editor) unmountEditor(view)
  const source = open.controller.sourceOf(cell.key)?.toString() ?? ''
  const signature = `md:${source}:${cell.attachments?.json ?? ''}`
  if (view.rendered === signature) return
  view.rendered = signature
  if (!source.trim()) {
    view.body.innerHTML = '<p class="empty">Empty Markdown cell. Tap twice to edit.</p>'
    return
  }
  void readAttachments(cell.attachments, open.assets).catch(() => ({})).then((attachments) => {
    if (view.rendered !== signature) return
    const content = document.createElement('div')
    content.className = 'markdown'
    content.append(renderMarkdown(source, attachments))
    view.body.replaceChildren(content)
  })
}

function updateOutputs(open: Open, view: CellView, cell: NotebookCellState): void {
  const key = cell.type === 'code' && cell.outputs ? `${cell.outputsCollapsed}:${cell.outputs.json}:${cell.outputs.assets.map((slot) => slot.hash).join()}` : ''
  if (view.outputsKey === key) return
  view.outputsKey = key
  if (!key || !cell.outputs || cell.outputs.json === '[]') {
    view.outputs.replaceChildren()
    return
  }
  void readOutputs(cell.outputs, open.assets).then((outputs) => {
    if (view.outputsKey !== key) return
    if (cell.outputsCollapsed) {
      const note = document.createElement('button')
      note.type = 'button'
      note.className = 'collapsed'
      note.textContent = outputs.length === 1 ? '1 output hidden' : `${outputs.length} outputs hidden`
      note.addEventListener('click', (event) => {
        event.stopPropagation()
        open.controller.select(cell.key)
        open.controller.toggleOutputs()
      })
      view.outputs.replaceChildren(note)
      return
    }
    view.outputs.replaceChildren(...outputs.flatMap((output) => outputElement(output) ?? []))
  }).catch(() => {
    if (view.outputsKey !== key) return
    view.outputs.innerHTML = '<p class="output note">The outputs are not on this device yet.</p>'
    // Tried again on the next render (a reconnect brings updates, and with them one).
    view.outputsKey = null
  })
}

let footer: HTMLElement | null = null

function render(): void {
  const open = current
  if (!open) return
  const state = open.controller.getState()
  const editable = open.editable && !state.readOnly
  const seen = new Set<string>()
  let previous: Element | null = null
  for (const cell of state.cells) {
    seen.add(cell.key)
    let view = open.views.get(cell.key)
    if (!view) {
      view = createView(open, cell)
      open.views.set(cell.key, view)
    }
    // Keep DOM order equal to notebook order, moving only what moved.
    const expected: Element | null = previous ? previous.nextElementSibling : root.firstElementChild
    if (expected !== view.element) root.insertBefore(view.element, expected)
    previous = view.element
    const active = cell.key === state.active
    const editing = active && state.mode === 'edit'
    view.element.classList.toggle('active', active)
    view.element.classList.toggle('editing', editing)
    view.element.classList.toggle('selected', state.selected.includes(cell.key))
    view.element.dataset.type = cell.type
    view.prompt.textContent = cell.type === 'code' ? `[${cell.executionCount ?? ' '}]` : cell.type === 'markdown' ? 'Markdown' : 'Raw'
    const peers = state.peers[cell.key] ?? []
    view.peers.replaceChildren(...peers.map((peer) => {
      const badge = document.createElement('span')
      badge.className = 'peer'
      badge.style.backgroundColor = peer.color
      badge.textContent = peer.name
      return badge
    }))
    view.element.style.setProperty('--peer', peers[0]?.color ?? 'transparent')
    updateTools(view, cell, active, editable)
    updateBody(open, view, cell, editing)
    view.editor?.setReadOnly(!editable)
    updateOutputs(open, view, cell)
  }
  for (const [key, view] of open.views) {
    if (seen.has(key)) continue
    open.observer.unobserve(view.element)
    unmountEditor(view)
    view.element.remove()
    open.views.delete(key)
  }
  if (!footer) {
    footer = document.createElement('div')
    footer.className = 'add'
    footer.innerHTML = '<button type="button" data-type="code">+ Code</button><button type="button" data-type="markdown">+ Markdown</button>'
    footer.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest('button')
      if (!button || !current) return
      const cells = current.controller.getState().cells
      if (cells.length) current.controller.select(cells[cells.length - 1]!.key)
      current.controller.insert('below', button.dataset.type as NotebookCellType, { edit: true })
    })
  }
  footer.hidden = !editable
  root.append(footer)
  if (!state.cells.length) root.dataset.empty = 'true'
  else delete root.dataset.empty
  // Leaving edit mode lowers the keyboard.
  if (state.mode === 'command' && root.contains(document.activeElement) && document.activeElement instanceof HTMLElement) document.activeElement.blur()
  const active = state.active ? open.views.get(state.active) : null
  if (active && state.mode === 'edit' && active.editor && !active.editor.view.hasFocus) active.editor.focus('keep')
  const toolbar = toolbarState(state)
  const sent = JSON.stringify(toolbar)
  if (sent !== lastToolbar) {
    lastToolbar = sent
    post({ type: 'notebookState', session: open.session, state: toolbar })
  }
}

/** The toolbar state last sent, so typing does not resend an unchanged one every frame. */
let lastToolbar = ''

function run(command: string): void {
  const open = current
  if (!open) return
  const { controller } = open
  const state = controller.getState()
  const active = state.active ? open.views.get(state.active) : null
  switch (command) {
    case 'undo': controller.undo(); break
    case 'redo': controller.redo(); break
    case 'insertBelow': controller.insert('below', 'code', { edit: true }); break
    case 'moveUp': controller.move('up'); break
    case 'moveDown': controller.move('down'); break
    case 'delete': controller.deleteSelected(); break
    case 'toggleOutputs': controller.toggleOutputs(); break
    case 'clearAllOutputs': controller.clearOutputs('all'); break
    case 'toggleType': {
      const cell = state.cells.find((item) => item.key === state.active)
      if (cell) controller.setType(cell.type === 'code' ? 'markdown' : 'code')
      break
    }
    case 'indentMore':
    case 'indentLess':
      if (active?.editor && !state.readOnly) (command === 'indentMore' ? indentMore : indentLess)(active.editor.view)
      break
  }
}

function close(): void {
  lastToolbar = ''
  if (!current) return
  const open = current
  current = null
  open.unsubscribe()
  open.observer.disconnect()
  for (const view of open.views.values()) unmountEditor(view)
  open.controller.destroy()
  removeAwarenessStates(open.awareness, [open.doc.clientID], 'local')
  open.awareness.destroy()
  open.doc.destroy()
  root.replaceChildren()
  footer = null
}

function start(message: Extract<HostMessage, { type: 'init' }>): void {
  close()
  applyTheme(message.theme)
  const doc = new Y.Doc()
  Y.applyUpdate(doc, base64ToBytes(message.update), HOST)
  const awareness = new Awareness(doc)
  if (message.awareness) applyAwarenessUpdate(awareness, base64ToBytes(message.awareness), REMOTE)
  const session = message.session
  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== HOST && current?.session === session) post({ type: 'update', session, update: bytesToBase64(update) })
  })
  awareness.on('update', ({ added, updated }: { added: number[]; updated: number[] }, origin: unknown) => {
    if (origin === REMOTE || current?.session !== session) return
    if (![...added, ...updated].includes(doc.clientID)) return
    const local = awareness.getLocalState() as { cursor?: { anchor: unknown; head: unknown } | null; notebook?: unknown } | null
    post({ type: 'cursor', session, cursor: local?.cursor ?? null, notebook: local?.notebook ?? null })
  })
  const assets = new BridgeAssetStore(session)
  const controller = new NotebookController({ doc, awareness, assets, readOnly: !message.editable, user: message.user })
  const views = new Map<string, CellView>()
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      const key = (entry.target as HTMLElement).dataset.cellKey
      const view = key ? views.get(key) : undefined
      if (view && !view.near) {
        view.near = true
        render()
      }
    }
  }, { rootMargin: '400px 0px' })
  controller.setCursorProvider((key) => views.get(key)?.editor?.cursor() ?? null)
  // The controller reports structure; typing in a source changes only rendered Markdown, which
  // must follow collaborators' edits too.
  let pending = false
  const onSources = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
    if (pending || !events.some((event) => event.target instanceof Y.Text)) return
    pending = true
    requestAnimationFrame(() => {
      pending = false
      if (current?.session === session) render()
    })
  }
  cellsMap(doc).observeDeep(onSources)
  const unsubscribeState = controller.subscribe(() => render())
  const unsubscribe = () => {
    unsubscribeState()
    cellsMap(doc).unobserveDeep(onSources)
  }
  current = { session, doc, awareness, controller, assets, views, theme: message.theme, editable: message.editable, observer, unsubscribe }
  render()
  post({ type: 'loaded', session })
  // Whatever reached the app after it sent `init`.
  post({ type: 'sync', session, stateVector: bytesToBase64(Y.encodeStateVector(doc)) })
}

function receive(raw: string): void {
  let message: HostMessage
  try {
    message = JSON.parse(raw) as HostMessage
  } catch {
    return
  }
  if (message.type === 'init') {
    start(message)
    return
  }
  const open = current
  if (!open || message.session !== open.session) return
  switch (message.type) {
    case 'update':
      Y.applyUpdate(open.doc, base64ToBytes(message.update), HOST)
      break
    case 'sync':
      post({ type: 'update', session: open.session, update: bytesToBase64(Y.encodeStateAsUpdate(open.doc, base64ToBytes(message.stateVector))) })
      break
    case 'awareness':
      applyAwarenessUpdate(open.awareness, base64ToBytes(message.update), REMOTE)
      break
    case 'editable':
      open.editable = message.editable
      open.controller.setReadOnly(!message.editable)
      render()
      break
    case 'theme':
      applyTheme(message.theme)
      break
    case 'asset':
      open.assets.receive(message.hash, message.data)
      break
    case 'command':
      run(message.command)
      break
    case 'focus': {
      const state = open.controller.getState()
      const key = message.at === 'start' ? state.cells[0]?.key : state.active ?? state.cells[0]?.key
      if (key) open.controller.select(key, { mode: 'edit' })
      break
    }
    case 'blur':
      open.controller.setMode('command')
      break
    case 'export':
      // The app exports notebooks itself, through the codec.
      post({ type: 'export', session: open.session, requestId: message.requestId, markdown: null, error: 'Notebooks export through the app' })
      break
  }
}

window.pulpoEditor = {
  receive: (message) => {
    try {
      receive(message)
    } catch (error) {
      post({ type: 'error', session: current?.session ?? null, message: error instanceof Error ? error.message : String(error) })
    }
  },
}

window.addEventListener('error', (event) => {
  post({ type: 'error', session: current?.session ?? null, message: event.message })
})

// A hardware keyboard (iPad) gets Jupyter's command-mode keys.
document.addEventListener('keydown', (event) => {
  if (!current || (event.target as HTMLElement).closest?.('.cm-editor, select')) return
  if (current.controller.handleCommandKey(event)) event.preventDefault()
})

/** The whole replica, for the app to merge when it tears the web view down (see the native host). */
;(window as unknown as { pulpoEditorState: () => string | null }).pulpoEditorState = () => current ? bytesToBase64(Y.encodeStateAsUpdate(current.doc)) : null

post({ type: 'ready', protocolVersion: EDITOR_PROTOCOL_VERSION, schemaVersion: NOTEBOOK_SCHEMA_VERSION, format: 'notebook' })
