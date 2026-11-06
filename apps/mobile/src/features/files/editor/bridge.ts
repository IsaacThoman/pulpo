import type { FormatCommand, FormattingState } from '@pulpo/client-core/doc-editor'
import type { TextEditorState } from '@pulpo/client-core/office/text/view'
import { encodeAwarenessUpdate, type Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { base64ToBytes, bytesToBase64 } from './base64'
import {
  EDITOR_PROTOCOL_VERSION,
  parseEditorMessage,
  type ActiveSuggestion,
  type EditorMessage,
  type EditorTheme,
  type HostMessage,
  type NotebookCommand,
  type NotebookToolbarState,
  type PresentationCommand,
  type PresentationEditorState,
  type DocxCommand,
  type DocxPhoneState,
  type ReviewAction,
  type TextCommand,
} from './protocol'

/**
 * The origin of edits arriving from one editor page. Each bridge has its own, so edits from one
 * page still reach another page open on the same document; stores and providers treat any of them
 * as local edits.
 */
export interface EditorOrigin {
  readonly editor: true
}

export interface EditorBridgeState {
  /** The editor has loaded the current session's document. */
  loaded: boolean
  formatting: FormattingState | null
  focused: boolean
  suggestions: { count: number; index: number | null; active: ActiveSuggestion | null }
  /** What a text editor reports (text and code files). */
  text: TextEditorState | null
  /** What a notebook editor reports. */
  notebook: NotebookToolbarState | null
  /** What a presentation editor reports. */
  presentation: PresentationEditorState | null
  /** What a Word editor reports. */
  docx?: DocxPhoneState | null
  /** The editor's page reported a protocol or schema this app cannot use. */
  incompatible: boolean
}

export interface EditorBridgeOptions {
  doc: Y.Doc
  awareness: Awareness
  /** Sends a message into the web view. */
  send: (message: string) => void
  editable: boolean
  placeholder: string
  user: { name: string; color: string }
  theme: EditorTheme
  /** The schema version this app's provider joins with; the page must have been built for it. */
  schemaVersion: number
  /** The live format the page must edit (Markdown unless given). */
  format?: string
  /** The file name, for editors that depend on it (a code file's language). */
  name?: string
  onLink?: (href: string) => void
  /** Fetches a document asset for the page (notebook images); without it the page shows none. */
  fetchAsset?: (hash: string) => Promise<Uint8Array>
  /** The owner resolved suggestions in the editor; replies' change counts may be stale. */
  onResolved?: () => void
  onError?: (message: string) => void
}

const INITIAL_STATE: EditorBridgeState = {
  loaded: false,
  formatting: null,
  focused: false,
  suggestions: { count: 0, index: null, active: null },
  text: null,
  notebook: null,
  presentation: null,
  incompatible: false,
}

/**
 * Connects the app's copy of a document to the editor page: starts a session whenever the page
 * (re)loads, relays updates both ways, carries cursors in and out of awareness, and exposes what
 * the editor reports for the native toolbar and review bar.
 */
export class EditorBridge {
  private session = 0
  private state: EditorBridgeState = INITIAL_STATE
  private readonly listeners = new Set<() => void>()
  private readonly exports = new Map<string, { resolve: (markdown: string) => void; reject: (error: Error) => void }>()
  private destroyed = false
  private options: EditorBridgeOptions
  /** Applies this page's edits, which are never sent back to it. */
  readonly origin: EditorOrigin = { editor: true }

  constructor(options: EditorBridgeOptions) {
    this.options = options
    options.doc.on('update', this.onDocUpdate)
    options.awareness.on('update', this.onAwarenessUpdate)
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly getState = (): EditorBridgeState => this.state

  /** Handles a message the page posted. */
  receive(data: string): void {
    if (this.destroyed) return
    const message = parseEditorMessage(data)
    if (!message) return
    if (message.type === 'ready') {
      this.start(message)
      return
    }
    if (message.type === 'error') {
      this.options.onError?.(message.message)
      return
    }
    if (message.session !== this.session) return
    this.handle(message)
  }

  /** The page went away (its process ended, or it is reloading); a new `ready` starts over. */
  reset(): void {
    this.session += 1
    this.rejectExports(new Error('The editor reloaded'))
    this.setState({ ...INITIAL_STATE, incompatible: this.state.incompatible })
  }

  setEditable(editable: boolean): void {
    if (this.options.editable === editable) return
    this.options = { ...this.options, editable }
    this.post({ type: 'editable', session: this.session, editable })
  }

  setTheme(theme: EditorTheme): void {
    this.options = { ...this.options, theme }
    this.post({ type: 'theme', session: this.session, theme })
  }

  format(command: FormatCommand, href?: string): void {
    this.post({ type: 'format', session: this.session, command, href })
  }

  /** A text editor's toolbar command. */
  command(command: TextCommand | NotebookCommand | PresentationCommand): void {
    this.post({ type: 'command', session: this.session, command })
  }

  /** A Word editor's toolbar command. */
  docxCommand(command: DocxCommand, value?: string): void {
    this.post({ type: 'docxCommand', session: this.session, command, value })
  }

  setName(name: string): void {
    if (this.options.name === name) return
    this.options = { ...this.options, name }
    this.post({ type: 'name', session: this.session, name })
  }

  review(action: ReviewAction): void {
    this.post({ type: 'review', session: this.session, action })
  }

  focus(at?: 'start' | 'end'): void {
    this.post({ type: 'focus', session: this.session, at })
  }

  blur(): void {
    this.post({ type: 'blur', session: this.session })
  }

  /** The editor's Markdown (base view), which includes edits not yet synced. */
  exportMarkdown(timeoutMs = 10_000): Promise<string> {
    if (!this.state.loaded) return Promise.reject(new Error('The editor has not loaded'))
    const requestId = `${this.session}:${Math.random().toString(36).slice(2)}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.exports.delete(requestId)
        reject(new Error('The editor did not answer'))
      }, timeoutMs)
      this.exports.set(requestId, {
        resolve: (markdown) => { clearTimeout(timer); resolve(markdown) },
        reject: (error) => { clearTimeout(timer); reject(error) },
      })
      this.post({ type: 'export', session: this.session, requestId })
    })
  }

  /** Merges the page's full state, e.g. pulled by the native host while it tears the view down. */
  mergeFinalState(update: string | null): void {
    if (!update || this.destroyed) return
    Y.applyUpdate(this.options.doc, base64ToBytes(update), this.origin)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.options.doc.off('update', this.onDocUpdate)
    this.options.awareness.off('update', this.onAwarenessUpdate)
    // This session's cursor leaves with its editor.
    if (this.options.awareness.getLocalState()) {
      this.options.awareness.setLocalStateField('cursor', null)
      if (this.options.format === 'notebook') this.options.awareness.setLocalStateField('notebook', null)
      this.options.awareness.setLocalStateField('presentation', null)
    }
    this.rejectExports(new Error('The editor closed'))
    this.listeners.clear()
  }

  private start(message: Extract<EditorMessage, { type: 'ready' }>): void {
    if (message.protocolVersion !== EDITOR_PROTOCOL_VERSION || message.schemaVersion !== this.options.schemaVersion || (message.format ?? 'markdown') !== (this.options.format ?? 'markdown')) {
      this.setState({ ...INITIAL_STATE, incompatible: true })
      return
    }
    this.session += 1
    this.rejectExports(new Error('The editor reloaded'))
    this.setState(INITIAL_STATE)
    const { doc, awareness, editable, placeholder, user, theme, name } = this.options
    const others = this.otherClients()
    this.post({
      type: 'init',
      session: this.session,
      update: bytesToBase64(Y.encodeStateAsUpdate(doc)),
      editable,
      placeholder,
      user,
      theme,
      awareness: others.length ? bytesToBase64(encodeAwarenessUpdate(awareness, others)) : undefined,
      name,
    })
  }

  private handle(message: Exclude<EditorMessage, { type: 'ready' | 'error' }>): void {
    switch (message.type) {
      case 'loaded':
        // Changes between `init` and now reach the editor through the `sync` it sends next.
        this.setState({ ...this.state, loaded: true })
        break
      case 'update':
        Y.applyUpdate(this.options.doc, base64ToBytes(message.update), this.origin)
        break
      case 'sync':
        this.post({ type: 'update', session: this.session, update: bytesToBase64(Y.encodeStateAsUpdate(this.options.doc, base64ToBytes(message.stateVector))) })
        break
      case 'formatting':
        this.setState({ ...this.state, formatting: message.formatting, focused: message.focused })
        break
      case 'textState':
        this.setState({ ...this.state, text: message.state, focused: message.state.focused })
        break
      case 'notebookState':
        this.setState({ ...this.state, notebook: message.state, focused: message.state.editing })
        break
      case 'presentationState':
        this.setState({ ...this.state, presentation: message.state })
        break
      case 'docxState':
        this.setState({ ...this.state, docx: message.state, focused: message.state.focused })
        break
      case 'suggestions':
        this.setState({ ...this.state, suggestions: { count: message.count, index: message.index, active: message.active } })
        break
      case 'cursor':
        this.options.awareness.setLocalStateField('cursor', message.cursor)
        if (message.notebook !== undefined) this.options.awareness.setLocalStateField('notebook', message.notebook)
        if (message.presentation !== undefined) this.options.awareness.setLocalStateField('presentation', message.presentation)
        break
      case 'asset': {
        if ('requestId' in message) {
          void this.sendAsset(message.requestId, message.hash)
          break
        }
        const { session } = this
        const hash = message.hash
        const fetchAsset = this.options.fetchAsset
        if (!fetchAsset || !/^[0-9a-f]{64}$/.test(hash)) {
          this.post({ type: 'asset', session, hash, data: null })
          break
        }
        void fetchAsset(hash).then((bytes) => bytesToBase64(bytes), () => null).then((data) => {
          if (this.session === session) this.post({ type: 'asset', session, hash, data })
        })
        break
      }
      case 'resolved':
        this.options.onResolved?.()
        break
      case 'link':
        this.options.onLink?.(message.href)
        break
      case 'export': {
        const pending = this.exports.get(message.requestId)
        this.exports.delete(message.requestId)
        if (message.markdown === null) pending?.reject(new Error(message.error ?? 'The editor could not export'))
        else pending?.resolve(message.markdown)
        break
      }
    }
  }

  /** Answers the page's request for an asset, from the app's own fetch (the page has no network). */
  private async sendAsset(requestId: string, hash: string): Promise<void> {
    const session = this.session
    const fetchAsset = this.options.fetchAsset
    if (!/^[0-9a-f]{64}$/.test(hash) || !fetchAsset) {
      this.post({ type: 'asset', session, requestId, error: 'Unavailable' })
      return
    }
    try {
      const bytes = await fetchAsset(hash)
      if (session === this.session) this.post({ type: 'asset', session, requestId, data: bytesToBase64(bytes) })
    } catch (error) {
      if (session === this.session) this.post({ type: 'asset', session, requestId, error: error instanceof Error ? error.message : 'Unavailable' })
    }
  }

  private otherClients(): number[] {
    return [...this.options.awareness.getStates().keys()].filter((clientId) => clientId !== this.options.doc.clientID)
  }

  private readonly onDocUpdate = (update: Uint8Array, origin: unknown) => {
    // The page already has its own edits.
    if (origin === this.origin || !this.state.loaded) return
    this.post({ type: 'update', session: this.session, update: bytesToBase64(update) })
  }

  private readonly onAwarenessUpdate = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
    if (!this.state.loaded) return
    const own = this.options.doc.clientID
    const changed = [...added, ...updated, ...removed].filter((clientId) => clientId !== own)
    if (changed.length) this.post({ type: 'awareness', session: this.session, update: bytesToBase64(encodeAwarenessUpdate(this.options.awareness, changed)) })
  }

  private post(message: HostMessage): void {
    if (this.destroyed || this.session === 0) return
    this.options.send(JSON.stringify(message))
  }

  private rejectExports(error: Error): void {
    for (const pending of this.exports.values()) pending.reject(error)
    this.exports.clear()
  }

  private setState(next: EditorBridgeState): void {
    this.state = next
    for (const listener of this.listeners) listener()
  }
}
