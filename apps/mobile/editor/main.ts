/*
 * The document editor that runs inside the app's web view. It renders a replica of the
 * document the app owns, with the same schema, suggestion rules, and toolbar commands as the
 * web editor, and reports edits, formatting, and suggestions back. It has no network access:
 * everything it knows arrives through the bridge (see src/features/files/editor/protocol.ts).
 */
import {
  adjacentHunk,
  createEditorExtensions,
  docSuggestions,
  formattingState,
  hunkAt,
  isFormatCommand,
  runFormatCommand,
  sameFormattingState,
  summarizeHunk,
  SUGGESTION_REVIEW_META,
  type FormattingState,
} from '@pulpo/client-core/doc-editor'
import { DOC_SCHEMA_VERSION, resolveSuggestions, ydocToMarkdown, type SuggestionAction, type SuggestionHunk } from '@pulpo/client-core/doc-schema'
import { Editor } from '@tiptap/core'
import { Selection } from '@tiptap/pm/state'
import { applyAwarenessUpdate, Awareness, removeAwarenessStates } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { base64ToBytes, bytesToBase64 } from '../src/features/files/editor/base64'
import {
  EDITOR_PROTOCOL_VERSION,
  type EditorMessage,
  type EditorTheme,
  type HostMessage,
  type ReviewAction,
} from '../src/features/files/editor/protocol'
import './editor.css'

declare global {
  interface Window {
    webkit?: { messageHandlers?: { pulpoEditor?: { postMessage(message: string): void } } }
    pulpoEditorAndroid?: { postMessage(message: string): void }
    pulpoEditor: { receive(message: string): void }
  }
}

/** Updates from the app; never sent back to it. */
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
  editor: Editor
  formatting: FormattingState | null
  focused: boolean
  suggestions: string
  hunkIds: string
  /** The hunk last stepped to, and where that put the cursor, while the cursor stays there. */
  stepped: { id: string; pos: number } | null
}

let open: Open | null = null
const root = document.getElementById('editor')!
const activeStyle = document.getElementById('active-suggestion') as HTMLStyleElement

function applyTheme(theme: EditorTheme): void {
  const style = document.documentElement.style
  style.setProperty('--background', theme.background)
  style.setProperty('--foreground', theme.foreground)
  style.setProperty('--muted', theme.muted)
  style.setProperty('--muted-foreground', theme.mutedForeground)
  style.setProperty('--border', theme.border)
  style.setProperty('--primary', theme.primary)
  style.setProperty('--code', theme.code)
  style.setProperty('--code-foreground', theme.codeForeground)
  style.setProperty('--font-size', `${theme.fontSize}px`)
  style.setProperty('--bottom-padding', `${theme.bottomPadding}px`)
  document.documentElement.classList.toggle('dark', theme.dark)
  document.documentElement.style.colorScheme = theme.dark ? 'dark' : 'light'
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
  activeStyle.textContent = ''
}

/** The hunk the cursor is in: the one last stepped to while the cursor stays there, else the innermost. */
function cursorHunk(current: Open, hunks: readonly SuggestionHunk[]): SuggestionHunk | null {
  const pos = current.editor.state.selection.from
  const stepped = current.stepped
  if (stepped && stepped.pos === pos) {
    const hunk = hunks.find((item) => item.id === stepped.id)
    if (hunk) return hunk
  }
  return hunkAt(hunks, pos)
}

function report(current: Open): void {
  const formatting = formattingState(current.editor)
  const focused = current.editor.isFocused
  if (!current.formatting || !sameFormattingState(current.formatting, formatting) || current.focused !== focused) {
    current.formatting = formatting
    current.focused = focused
    post({ type: 'formatting', session: current.session, formatting, focused })
  }
  const hunks = docSuggestions(current.editor.state.doc)
  const active = cursorHunk(current, hunks)
  activeStyle.textContent = active
    ? `.pulpo-doc-editor [data-suggestion-id="${active.id.replace(/[^\w-]/g, '')}"] { outline: 1.5px solid var(--pulpo-suggestion-focus); outline-offset: 1px; border-radius: 2px; }`
    : ''
  const message: EditorMessage = {
    type: 'suggestions',
    session: current.session,
    count: hunks.length,
    index: active ? hunks.indexOf(active) : null,
    active: active ? { id: active.id, changeId: active.changeId, summary: summarizeHunk(active) } : null,
  }
  const key = JSON.stringify(message)
  if (key !== current.suggestions) {
    current.suggestions = key
    post(message)
  }
  // Undo, redo, and typing can also resolve suggestions without a review button.
  const ids = hunks.map((hunk) => hunk.id).join(',')
  if (ids !== current.hunkIds) {
    current.hunkIds = ids
    post({ type: 'resolved', session: current.session })
  }
}

function scrollToSelection(editor: Editor): void {
  const { node } = editor.view.domAtPos(editor.state.selection.from)
  const element = node instanceof Element ? node : node.parentElement
  element?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

function review(current: Open, action: ReviewAction): void {
  const { editor } = current
  const hunks = docSuggestions(editor.state.doc)
  const active = cursorHunk(current, hunks)
  if (action === 'next' || action === 'previous') {
    const target = adjacentHunk(hunks, editor.state.selection.from, active?.id ?? null, action === 'next' ? 1 : -1)
    if (!target) return
    const { tr } = editor.state
    const selection = Selection.near(tr.doc.resolve(target.from))
    current.stepped = { id: target.id, pos: selection.from }
    editor.view.dispatch(tr.setSelection(selection))
    scrollToSelection(editor)
    return
  }
  if (!editor.isEditable) return
  const resolve: SuggestionAction = action === 'accept' || action === 'acceptAll' ? 'accept' : 'reject'
  const all = action === 'acceptAll' || action === 'rejectAll'
  if (!all && !active) return
  // Through the editor's own transaction, so its undo covers the review.
  const tr = resolveSuggestions(editor.state.tr.setMeta(SUGGESTION_REVIEW_META, true), (ref) => all || ref.id === active!.id, resolve)
  if (tr.docChanged) editor.view.dispatch(tr)
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
  const editor = new Editor({
    element: root,
    editable: message.editable,
    extensions: createEditorExtensions({ doc, awareness, user: message.user, placeholder: message.placeholder }),
    editorProps: {
      attributes: { class: 'pulpo-doc-editor', 'aria-label': 'Document', autocapitalize: 'sentences' },
      handleClickOn: (_view, _pos, _node, _nodePos, event) => {
        const link = (event.target as Element | null)?.closest?.('a[href]')
        if (!link || editor.isEditable) return false
        post({ type: 'link', session, href: link.getAttribute('href')! })
        event.preventDefault()
        return true
      },
    },
  })
  open = { session, doc, awareness, editor, formatting: null, focused: false, suggestions: '', hunkIds: '', stepped: null }
  open.hunkIds = docSuggestions(editor.state.doc).map((hunk) => hunk.id).join(',')
  const current = open
  editor.on('transaction', () => { if (open === current) report(current) })
  editor.on('focus', () => { if (open === current) report(current) })
  editor.on('blur', () => { if (open === current) report(current) })
  post({ type: 'loaded', session })
  // Whatever reached the app after it sent `init`.
  post({ type: 'sync', session, stateVector: bytesToBase64(Y.encodeStateVector(doc)) })
  report(current)
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
      if (current.editor.isEditable !== message.editable) current.editor.setEditable(message.editable)
      report(current)
      break
    case 'theme':
      applyTheme(message.theme)
      break
    case 'format':
      if (isFormatCommand(message.command)) runFormatCommand(current.editor, message.command, { href: message.href })
      break
    case 'review':
      review(current, message.action)
      break
    case 'focus':
      current.editor.commands.focus(message.at ?? null, { scrollIntoView: true })
      break
    case 'blur':
      current.editor.commands.blur()
      break
    case 'export':
      try {
        post({ type: 'export', session: current.session, requestId: message.requestId, markdown: ydocToMarkdown(current.doc, 'base') })
      } catch (error) {
        post({ type: 'export', session: current.session, requestId: message.requestId, markdown: null, error: error instanceof Error ? error.message : String(error) })
      }
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

post({ type: 'ready', protocolVersion: EDITOR_PROTOCOL_VERSION, schemaVersion: DOC_SCHEMA_VERSION })
