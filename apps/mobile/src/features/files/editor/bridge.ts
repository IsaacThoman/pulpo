import type { FormatCommand, FormattingState } from '@pulpo/client-core/doc-editor'
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
  type ReviewAction,
} from './protocol'

/** Edits arriving from the editor; the session's store and provider treat them as local. */
export const EDITOR_ORIGIN = 'pulpo-editor'

export interface EditorBridgeState {
  /** The editor has loaded the current session's document. */
  loaded: boolean
  formatting: FormattingState | null
  focused: boolean
  suggestions: { count: number; index: number | null; active: ActiveSuggestion | null }
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
  onLink?: (href: string) => void
  /** The owner resolved suggestions in the editor; replies' change counts may be stale. */
  onResolved?: () => void
  onError?: (message: string) => void
}

const INITIAL_STATE: EditorBridgeState = {
  loaded: false,
  formatting: null,
  focused: false,
  suggestions: { count: 0, index: null, active: null },
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
    Y.applyUpdate(this.options.doc, base64ToBytes(update), EDITOR_ORIGIN)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.options.doc.off('update', this.onDocUpdate)
    this.options.awareness.off('update', this.onAwarenessUpdate)
    // This session's cursor leaves with its editor.
    if (this.options.awareness.getLocalState()) this.options.awareness.setLocalStateField('cursor', null)
    this.rejectExports(new Error('The editor closed'))
    this.listeners.clear()
  }

  private start(message: Extract<EditorMessage, { type: 'ready' }>): void {
    if (message.protocolVersion !== EDITOR_PROTOCOL_VERSION || message.schemaVersion !== this.options.schemaVersion) {
      this.setState({ ...INITIAL_STATE, incompatible: true })
      return
    }
    this.session += 1
    this.rejectExports(new Error('The editor reloaded'))
    this.setState(INITIAL_STATE)
    const { doc, awareness, editable, placeholder, user, theme } = this.options
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
    })
  }

  private handle(message: Exclude<EditorMessage, { type: 'ready' | 'error' }>): void {
    switch (message.type) {
      case 'loaded':
        // Changes between `init` and now reach the editor through the `sync` it sends next.
        this.setState({ ...this.state, loaded: true })
        break
      case 'update':
        Y.applyUpdate(this.options.doc, base64ToBytes(message.update), EDITOR_ORIGIN)
        break
      case 'sync':
        this.post({ type: 'update', session: this.session, update: bytesToBase64(Y.encodeStateAsUpdate(this.options.doc, base64ToBytes(message.stateVector))) })
        break
      case 'formatting':
        this.setState({ ...this.state, formatting: message.formatting, focused: message.focused })
        break
      case 'suggestions':
        this.setState({ ...this.state, suggestions: { count: message.count, index: message.index, active: message.active } })
        break
      case 'cursor':
        this.options.awareness.setLocalStateField('cursor', message.cursor)
        break
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

  private otherClients(): number[] {
    return [...this.options.awareness.getStates().keys()].filter((clientId) => clientId !== this.options.doc.clientID)
  }

  private readonly onDocUpdate = (update: Uint8Array, origin: unknown) => {
    // The editor already has its own edits.
    if (origin === EDITOR_ORIGIN || !this.state.loaded) return
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
