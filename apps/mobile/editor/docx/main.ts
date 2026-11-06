/*
 * The Word editor that runs inside the app's web view: the docx view core
 * (@pulpo/client-core/office/docx/view) on a replica of the document the app owns. Like the other
 * pages it has no network access: pictures come from the app over the bridge
 * (src/features/files/editor/protocol.ts), which fetches them from the server.
 */
import type { LiveAssetRef, LiveAssetStore } from '@pulpo/client-core/office'
import { DOCX_SCHEMA_VERSION } from '@pulpo/client-core/office/docx/format'
import { DocxEditor } from '@pulpo/client-core/office/docx/view'
import { applyAwarenessUpdate, Awareness, removeAwarenessStates } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { base64ToBytes, bytesToBase64 } from '../../src/features/files/editor/base64'
import { EDITOR_PROTOCOL_VERSION, type DocxCommand, type DocxPhoneState, type EditorMessage, type EditorTheme, type HostMessage } from '../../src/features/files/editor/protocol'
import './docx.css'

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

/** Assets by hash from the app; this page never adds any. */
class BridgeAssetStore implements LiveAssetStore {
  private readonly pending = new Map<string, { resolve: (bytes: Uint8Array) => void; reject: (error: Error) => void }>()
  private next = 0

  constructor(private readonly session: number) {}

  put(): Promise<LiveAssetRef> {
    return Promise.reject(new Error('Adding pictures is not available on this device'))
  }

  get(hash: string): Promise<Uint8Array> {
    const requestId = `${this.session}:${this.next++}`
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject })
      post({ type: 'asset', session: this.session, requestId, hash })
    })
  }

  answer(requestId: string, data: string | undefined, error: string | undefined): void {
    const pending = this.pending.get(requestId)
    this.pending.delete(requestId)
    if (!pending) return
    if (data !== undefined) pending.resolve(base64ToBytes(data))
    else pending.reject(new Error(error ?? 'The picture is unavailable'))
  }

  dispose(): void {
    for (const pending of this.pending.values()) pending.reject(new Error('The editor closed'))
    this.pending.clear()
  }
}

interface Open {
  session: number
  doc: Y.Doc
  awareness: Awareness
  editor: DocxEditor
  assets: BridgeAssetStore
  listeners: AbortController
}

let open: Open | null = null
const root = document.getElementById('editor')!

function applyTheme(theme: EditorTheme): void {
  const style = document.documentElement.style
  style.setProperty('--desk', theme.dark ? theme.background : theme.muted)
  style.setProperty('--bottom-padding', `${theme.bottomPadding}px`)
  document.documentElement.classList.toggle('dark', theme.dark)
  // The page stays as the document colors it: white paper, in both themes.
  document.documentElement.style.colorScheme = 'light'
}

function phoneState(editor: DocxEditor): DocxPhoneState {
  const state = editor.state()
  return {
    bold: state.bold,
    italic: state.italic,
    underline: state.underline,
    strike: state.strike,
    list: state.list,
    alignment: state.alignment,
    styleId: state.styleId,
    link: state.link,
    canUndo: state.canUndo,
    canRedo: state.canRedo,
    canComment: state.canComment,
    suggesting: state.mode === 'suggesting',
    layout: state.layout,
    focused: editor.hasFocus,
    editable: !state.readOnly,
  }
}

function close(): void {
  if (!open) return
  const current = open
  open = null
  current.listeners.abort()
  current.editor.destroy()
  current.assets.dispose()
  removeAwarenessStates(current.awareness, [current.doc.clientID], 'local')
  current.awareness.destroy()
  current.doc.destroy()
  root.replaceChildren()
  root.classList.remove('docx-empty')
}

/** A style by id, else by its name (documents from other editors name theirs differently). */
function styleId(editor: DocxEditor, id: string, name: string): string | null {
  const styles = editor.styles()
  return styles.find((style) => style.id === id)?.id ?? styles.find((style) => style.name.toLowerCase() === name)?.id ?? null
}

function run(editor: DocxEditor, command: DocxCommand, value: string | undefined): void {
  switch (command) {
    case 'undo': editor.undo(); break
    case 'redo': editor.redo(); break
    case 'bold': editor.toggleBold(); break
    case 'italic': editor.toggleItalic(); break
    case 'underline': editor.toggleUnderline(); break
    case 'strike': editor.toggleStrike(); break
    case 'bulletList': editor.toggleList('bullet'); break
    case 'numberedList': editor.toggleList('decimal'); break
    case 'indent': editor.indent(); break
    case 'outdent': editor.outdent(); break
    case 'alignLeft': editor.setAlignment('left'); break
    case 'alignCenter': editor.setAlignment('center'); break
    case 'alignRight': editor.setAlignment('right'); break
    case 'heading1': editor.setStyle(styleId(editor, 'Heading1', 'heading 1') ?? 'Heading1'); break
    case 'heading2': editor.setStyle(styleId(editor, 'Heading2', 'heading 2') ?? 'Heading2'); break
    case 'normal': editor.setStyle(null); break
    case 'link': editor.setLink(value ? value : null); break
    case 'comment': if (value) editor.addComment(value); break
    case 'suggest': editor.setMode(editor.mode === 'suggesting' ? 'editing' : 'suggesting'); break
    case 'layout': editor.setLayout(editor.layout === 'print' ? 'web' : 'print'); break
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
  const assets = new BridgeAssetStore(session)
  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== HOST && open?.session === session) post({ type: 'update', session, update: bytesToBase64(update) })
  })
  awareness.on('update', ({ added, updated }: { added: number[]; updated: number[] }, origin: unknown) => {
    if (origin === REMOTE || open?.session !== session) return
    if (![...added, ...updated].includes(doc.clientID)) return
    const cursor = (awareness.getLocalState() as { cursor?: { anchor: unknown; head: unknown } | null } | null)?.cursor ?? null
    post({ type: 'cursor', session, cursor })
  })
  const listeners = new AbortController()
  const editor = new DocxEditor({
    container: root,
    doc,
    awareness,
    assets,
    readOnly: !message.editable,
    user: message.user,
    layout: 'web',
  })
  // An empty document shows the app's placeholder, as the other editors do.
  root.style.setProperty('--docx-placeholder', JSON.stringify(message.placeholder))
  const showPlaceholder = () => {
    const body = editor.view.state.doc
    const only = body.childCount === 1 ? body.firstChild : null
    root.classList.toggle('docx-empty', body.childCount === 0 || (only?.type.name === 'paragraph' && only.content.size === 0))
  }
  showPlaceholder()
  let frame = 0
  editor.on('update', () => {
    showPlaceholder()
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      if (open?.session === session) post({ type: 'docxState', session, state: phoneState(editor) })
    })
  })
  // Read-only, a tapped link opens through the app (as in the Markdown page); editing, a tap
  // places the caret and the bar's Link button edits it.
  root.addEventListener('click', (event) => {
    if (open?.session !== session || !editor.readOnly) return
    const link = (event.target as Element | null)?.closest?.('a[href]')
    const href = link?.getAttribute('href')
    if (!href) return
    event.preventDefault()
    event.stopPropagation()
    if (href.startsWith('#')) editor.goToBookmark(decodeURIComponent(href.slice(1)))
    else if (/^(https?:|mailto:)/i.test(href)) post({ type: 'link', session, href })
  }, { capture: true, signal: listeners.signal })
  open = { session, doc, awareness, editor, assets, listeners }
  post({ type: 'loaded', session })
  post({ type: 'sync', session, stateVector: bytesToBase64(Y.encodeStateVector(doc)) })
  post({ type: 'docxState', session, state: phoneState(editor) })
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
    case 'editable':
      current.editor.setReadOnly(!message.editable)
      break
    case 'theme':
      applyTheme(message.theme)
      break
    case 'docxCommand':
      run(current.editor, message.command, message.value)
      break
    case 'asset':
      if ('requestId' in message) current.assets.answer(message.requestId, message.data, message.error)
      break
    case 'focus':
      current.editor.focus()
      break
    case 'blur':
      ;(current.editor.view.dom as HTMLElement).blur()
      break
    case 'export':
      // The app exports Word documents through the server; answer with the text for previews.
      post({ type: 'export', session: current.session, requestId: message.requestId, markdown: current.editor.text() })
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

post({ type: 'ready', protocolVersion: EDITOR_PROTOCOL_VERSION, schemaVersion: DOCX_SCHEMA_VERSION, format: 'document' })
