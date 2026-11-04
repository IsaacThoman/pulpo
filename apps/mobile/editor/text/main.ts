/*
 * The text and code editor that runs inside the app's web view: CodeMirror (the shared view core
 * in @pulpo/client-core/office/text/view) on a replica of the document the app owns. Like the
 * Markdown page, it has no network access and talks only through the bridge
 * (src/features/files/editor/protocol.ts).
 */
import { TEXT_SCHEMA_VERSION } from '@pulpo/client-core/office/text'
import { createTextEditor, type TextEditor } from '@pulpo/client-core/office/text/view'
import { applyAwarenessUpdate, Awareness, removeAwarenessStates } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { base64ToBytes, bytesToBase64 } from '../../src/features/files/editor/base64'
import { EDITOR_PROTOCOL_VERSION, type EditorMessage, type EditorTheme, type HostMessage } from '../../src/features/files/editor/protocol'
import './text.css'

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

interface Open {
  session: number
  doc: Y.Doc
  awareness: Awareness
  editor: TextEditor
}

let open: Open | null = null
const root = document.getElementById('editor')!

function applyTheme(theme: EditorTheme): void {
  const style = document.documentElement.style
  style.setProperty('--background', theme.background)
  style.setProperty('--foreground', theme.foreground)
  style.setProperty('--muted', theme.muted)
  style.setProperty('--muted-foreground', theme.mutedForeground)
  style.setProperty('--border', theme.border)
  style.setProperty('--accent', theme.muted)
  style.setProperty('--ring', theme.primary)
  // Code reads best a little smaller than body text.
  style.setProperty('--pulpo-code-font-size', `${Math.max(11, Math.round(theme.fontSize * 0.85))}px`)
  style.setProperty('--bottom-padding', `${theme.bottomPadding}px`)
  document.documentElement.classList.toggle('dark', theme.dark)
  document.documentElement.style.colorScheme = theme.dark ? 'dark' : 'light'
  open?.editor.setDark(theme.dark)
}

function close(): void {
  if (!open) return
  const current = open
  open = null
  current.editor.destroy()
  removeAwarenessStates(current.awareness, [current.doc.clientID], 'local')
  current.awareness.destroy()
  current.doc.destroy()
  root.replaceChildren()
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
    if (origin !== HOST && open?.session === session) post({ type: 'update', session, update: bytesToBase64(update) })
  })
  awareness.on('update', ({ added, updated }: { added: number[]; updated: number[] }, origin: unknown) => {
    if (origin === REMOTE || open?.session !== session) return
    if (![...added, ...updated].includes(doc.clientID)) return
    const cursor = (awareness.getLocalState() as { cursor?: { anchor: unknown; head: unknown } | null } | null)?.cursor ?? null
    post({ type: 'cursor', session, cursor })
  })
  const editor = createTextEditor({
    container: root,
    doc,
    awareness,
    readOnly: !message.editable,
    user: message.user,
    name: message.name ?? 'untitled.txt',
    dark: message.theme.dark,
    onChange: (state) => { if (open?.session === session) post({ type: 'textState', session, state }) },
  })
  open = { session, doc, awareness, editor }
  post({ type: 'loaded', session })
  // Whatever reached the app after it sent `init`.
  post({ type: 'sync', session, stateVector: bytesToBase64(Y.encodeStateVector(doc)) })
  post({ type: 'textState', session, state: editor.state() })
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
    case 'name':
      current.editor.setName(message.name)
      break
    case 'command':
      switch (message.command) {
        case 'undo': current.editor.undo(); break
        case 'redo': current.editor.redo(); break
        case 'indentMore': current.editor.indent('more'); break
        case 'indentLess': current.editor.indent('less'); break
        case 'find': current.editor.openSearch(); break
        case 'wrap': current.editor.setWrap(!current.editor.state().wrap); break
      }
      break
    case 'focus':
      current.editor.focus()
      break
    case 'blur':
      current.editor.view.contentDOM.blur()
      break
    case 'export':
      // The app exports text documents itself, through the codec; answer with the plain text.
      post({ type: 'export', session: current.session, requestId: message.requestId, markdown: current.doc.getText('text').toString() })
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

post({ type: 'ready', protocolVersion: EDITOR_PROTOCOL_VERSION, schemaVersion: TEXT_SCHEMA_VERSION, format: 'text' })
