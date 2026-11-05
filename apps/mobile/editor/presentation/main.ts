/*
 * The presentation editor that runs inside the app's web view: the shared view core
 * (@pulpo/client-core/office/presentation/view) on a replica of the document the app owns. Like the
 * other pages it has no network access and talks only through the bridge
 * (src/features/files/editor/protocol.ts); images in the deck are fetched by the app on request.
 */
import { LiveFormatError, type LiveAssetRef, type LiveAssetStore } from '@pulpo/client-core/office'
import { PRESENTATION_SCHEMA_VERSION } from '@pulpo/client-core/office/presentation'
import { PresentationController, Presenter, SlideCanvas, SlideList } from '@pulpo/client-core/office/presentation/view'
import { applyAwarenessUpdate, Awareness, removeAwarenessStates } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { base64ToBytes, bytesToBase64 } from '../../src/features/files/editor/base64'
import { EDITOR_PROTOCOL_VERSION, type EditorMessage, type EditorTheme, type HostMessage, type PresentationEditorState } from '../../src/features/files/editor/protocol'
import { showPresentationDiff, type ShownDiff } from './diff'
import './presentation.css'

declare global {
  interface Window {
    webkit?: { messageHandlers?: { pulpoEditor?: { postMessage(message: string): void } } }
    pulpoEditorAndroid?: { postMessage(message: string): void }
    pulpoEditor: { receive(message: string): void }
  }
}

const HOST = 'host'
const REMOTE = 'remote'

function post(message: EditorMessage): void {
  const data = JSON.stringify(message)
  if (window.webkit?.messageHandlers?.pulpoEditor) window.webkit.messageHandlers.pulpoEditor.postMessage(data)
  else window.pulpoEditorAndroid?.postMessage(data)
}

/** Assets come from the app, which fetches them from the document; new ones cannot be added here. */
class BridgeAssets implements LiveAssetStore {
  private readonly pending = new Map<string, { resolve: (bytes: Uint8Array) => void; reject: (error: Error) => void }>()
  private readonly cache = new Map<string, Promise<Uint8Array>>()
  private next = 0

  constructor(private readonly session: number) {}

  put(): Promise<LiveAssetRef> {
    return Promise.reject(new LiveFormatError('unsupported', 'Adding pictures is not available on this device'))
  }

  get(hash: string): Promise<Uint8Array> {
    let request = this.cache.get(hash)
    if (!request) {
      const requestId = `${this.session}:${this.next++}`
      request = new Promise<Uint8Array>((resolve, reject) => this.pending.set(requestId, { resolve, reject }))
      request.catch(() => this.cache.delete(hash))
      this.cache.set(hash, request)
      post({ type: 'asset', session: this.session, requestId, hash })
    }
    return request
  }

  answer(message: Extract<HostMessage, { type: 'asset' }>): void {
    const pending = this.pending.get(message.requestId)
    this.pending.delete(message.requestId)
    if (!pending) return
    if (message.data) pending.resolve(base64ToBytes(message.data))
    else pending.reject(new Error(message.error ?? 'Unavailable'))
  }
}

interface Open {
  session: number
  doc: Y.Doc
  awareness: Awareness
  assets: BridgeAssets
  controller: PresentationController
  canvas: SlideCanvas
  strip: SlideList
  presenter?: Presenter
  unsubscribe: () => void
  report: () => void
}

let open: Open | null = null
const canvasRoot = document.getElementById('canvas')!
const stripRoot = document.getElementById('strip')!

function applyTheme(theme: EditorTheme): void {
  const style = document.documentElement.style
  style.setProperty('--background', theme.background)
  style.setProperty('--foreground', theme.foreground)
  style.setProperty('--muted', theme.muted)
  style.setProperty('--muted-foreground', theme.mutedForeground)
  style.setProperty('--border', theme.border)
  style.setProperty('--ring', theme.primary)
  style.setProperty('--bottom-padding', `${theme.bottomPadding}px`)
  document.documentElement.classList.toggle('dark', theme.dark)
  document.documentElement.style.colorScheme = theme.dark ? 'dark' : 'light'
}

function close(): void {
  if (!open) return
  const current = open
  open = null
  current.presenter?.exit()
  current.unsubscribe()
  current.canvas.destroy()
  current.strip.destroy()
  current.controller.destroy()
  removeAwarenessStates(current.awareness, [current.doc.clientID], 'local')
  current.awareness.destroy()
  current.doc.destroy()
  canvasRoot.replaceChildren()
  stripRoot.replaceChildren()
}

function stateOf(controller: PresentationController, presenting: boolean): PresentationEditorState {
  const format = controller.formatState()
  return {
    canUndo: controller.canUndo(),
    canRedo: controller.canRedo(),
    bold: format.bold,
    italic: format.italic,
    bullets: format.bullets !== 'none',
    canFormatText: format.canFormatText,
    hasSelection: controller.state.shapes.length > 0,
    slideCount: controller.slideKeys().length,
    readOnly: controller.readOnly,
    presenting,
  }
}

function start(message: Extract<HostMessage, { type: 'init' }>): void {
  close()
  applyTheme(message.theme)
  const doc = new Y.Doc()
  Y.applyUpdate(doc, base64ToBytes(message.update), HOST)
  const awareness = new Awareness(doc)
  if (message.awareness) applyAwarenessUpdate(awareness, base64ToBytes(message.awareness), REMOTE)
  const session = message.session
  const assets = new BridgeAssets(session)
  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== HOST && open?.session === session) post({ type: 'update', session, update: bytesToBase64(update) })
  })
  // The app relays this page's presence (its selection) to the other sessions.
  awareness.on('update', ({ added, updated }: { added: number[]; updated: number[] }, origin: unknown) => {
    if (origin === REMOTE || open?.session !== session) return
    if (![...added, ...updated].includes(doc.clientID)) return
    const cursor = (awareness.getLocalState() as { cursor?: { anchor: unknown; head: unknown } | null } | null)?.cursor ?? null
    post({ type: 'cursor', session, cursor })
  })
  const controller = new PresentationController({ doc, awareness, readOnly: !message.editable, assets, user: message.user })
  const canvas = new SlideCanvas(canvasRoot, controller, { onOpenLink: (href) => post({ type: 'link', session, href }) })
  const strip = new SlideList(stripRoot, controller, { layout: 'strip' })
  let last = ''
  const report = () => {
    if (open?.session !== session) return
    const state = stateOf(controller, Boolean(open?.presenter))
    const key = JSON.stringify(state)
    if (key === last) return
    last = key
    post({ type: 'presentationState', session, state })
  }
  const unsubscribe = controller.subscribe(report)
  open = { session, doc, awareness, assets, controller, canvas, strip, unsubscribe, report }
  post({ type: 'loaded', session })
  post({ type: 'sync', session, stateVector: bytesToBase64(Y.encodeStateVector(doc)) })
  report()
}

let shownDiff: { session: number; view?: ShownDiff } | null = null
const diffRoot = document.getElementById('diff')!

function closeDiff(): void {
  shownDiff?.view?.destroy()
  shownDiff = null
  diffRoot.hidden = true
  document.getElementById('editor')!.hidden = false
}

/** Review mode: an agent's proposed deck against the current one, instead of the editor. */
function showDiff(message: Extract<HostMessage, { type: 'presentationDiff' }>): void {
  close()
  closeDiff()
  applyTheme(message.theme)
  const session = message.session
  const current: { session: number; view?: ShownDiff } = { session }
  shownDiff = current
  document.getElementById('editor')!.hidden = true
  diffRoot.hidden = false
  showPresentationDiff(diffRoot, base64ToBytes(message.before), base64ToBytes(message.after)).then(
    (view) => {
      if (shownDiff !== current) return view.destroy()
      current.view = view
      post({ type: 'loaded', session })
    },
    (error: unknown) => {
      if (shownDiff === current) post({ type: 'error', session, message: error instanceof Error ? error.message : String(error) })
    },
  )
}

function command(current: Open, name: string): void {
  const { controller } = current
  switch (name) {
    case 'undo': controller.undo(); break
    case 'redo': controller.redo(); break
    case 'newSlide': controller.addSlide(); break
    case 'textBox': controller.insertTextBox(); break
    case 'shape': controller.insertShape('roundRect'); break
    case 'bold': controller.toggleMark('b'); break
    case 'italic': controller.toggleMark('i'); break
    case 'bullets': controller.setBullets('char'); break
    case 'delete':
      if (controller.state.shapes.length) controller.deleteSelection()
      else controller.deleteSlides()
      break
    case 'present': {
      current.presenter?.exit()
      const presenter: Presenter = new Presenter(controller, {
        ...(controller.state.slide ? { startAt: controller.state.slide } : {}),
        onExit: () => {
          if (open !== current || current.presenter !== presenter) return
          current.presenter = undefined
          current.report()
        },
      })
      current.presenter = presenter
      current.report()
      break
    }
    case 'endShow':
      current.presenter?.exit()
      break
  }
}

function receive(raw: string): void {
  let message: HostMessage
  try {
    message = JSON.parse(raw) as HostMessage
  } catch {
    return
  }
  if (message.type === 'init') {
    closeDiff()
    start(message)
    return
  }
  if (message.type === 'presentationDiff') {
    showDiff(message)
    return
  }
  const current = open
  if (!current || message.session !== current.session) return
  switch (message.type) {
    case 'update':
      Y.applyUpdate(current.doc, base64ToBytes(message.update), HOST)
      break
    case 'sync':
      post({ type: 'update', session: current.session, update: bytesToBase64(Y.encodeStateAsUpdate(current.doc, base64ToBytes(message.stateVector))) })
      break
    case 'awareness':
      applyAwarenessUpdate(current.awareness, base64ToBytes(message.update), REMOTE)
      break
    case 'asset':
      current.assets.answer(message)
      break
    case 'editable':
      current.controller.setReadOnly(!message.editable)
      break
    case 'theme':
      applyTheme(message.theme)
      break
    case 'command':
      command(current, message.command)
      break
    case 'focus':
      current.canvas.focus()
      break
    case 'export':
      post({ type: 'export', session: current.session, requestId: message.requestId, markdown: null, error: 'Presentations are exported by the app' })
      break
  }
}

window.pulpoEditor = {
  receive: (message) => {
    try {
      receive(message)
    } catch (error) {
      post({ type: 'error', session: open?.session ?? null, message: error instanceof Error ? error.message : String(error) })
    }
  },
}

window.addEventListener('error', (event) => {
  post({ type: 'error', session: open?.session ?? null, message: event.message })
})

/** The whole replica, for the app to merge when it tears the web view down (see the native host). */
;(window as unknown as { pulpoEditorState: () => string | null }).pulpoEditorState = () => open ? bytesToBase64(Y.encodeStateAsUpdate(open.doc)) : null

post({ type: 'ready', protocolVersion: EDITOR_PROTOCOL_VERSION, schemaVersion: PRESENTATION_SCHEMA_VERSION, format: 'presentation' })
