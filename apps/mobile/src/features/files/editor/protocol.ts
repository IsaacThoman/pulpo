import type { FormatCommand, FormattingState, HunkSummary } from '@pulpo/client-core/doc-editor'

/**
 * Messages between the app and the document editor running in its web view.
 *
 * The app owns the document: its Y.Doc, local copy, and sync. The editor holds a replica built
 * from `init` and exchanges Yjs updates with it, so a web view that crashes or is torn down never
 * loses edits the app has seen. Every message after `ready` carries the `session` it belongs to;
 * the editor reloads with a new session, and both sides drop messages from earlier ones.
 * Updates are idempotent CRDT merges, and either side can ask for what it lacks with `sync`.
 */
export const EDITOR_PROTOCOL_VERSION = 1

export interface EditorTheme {
  dark: boolean
  background: string
  foreground: string
  muted: string
  mutedForeground: string
  border: string
  primary: string
  code: string
  codeForeground: string
  /** Body text size in CSS pixels, following the system text size. */
  fontSize: number
  /** Space under the content, e.g. above a floating review bar. */
  bottomPadding: number
}

export type ReviewAction = 'next' | 'previous' | 'accept' | 'reject' | 'acceptAll' | 'rejectAll'

/** The app to the editor. */
export type HostMessage =
  | {
    type: 'init'
    session: number
    /** The whole document as a Yjs update (base64). */
    update: string
    editable: boolean
    placeholder: string
    user: { name: string; color: string }
    theme: EditorTheme
    /** Other sessions' awareness (base64), so their carets show at once. */
    awareness?: string
  }
  | { type: 'update'; session: number; update: string }
  /** Asks the editor for every update the app lacks, given the app's state vector (base64). */
  | { type: 'sync'; session: number; stateVector: string }
  | { type: 'awareness'; session: number; update: string }
  | { type: 'editable'; session: number; editable: boolean }
  | { type: 'theme'; session: number; theme: EditorTheme }
  | { type: 'format'; session: number; command: FormatCommand; href?: string }
  | { type: 'review'; session: number; action: ReviewAction }
  | { type: 'focus'; session: number; at?: 'start' | 'end' }
  | { type: 'blur'; session: number }
  /** Asks for the document's Markdown, without pending suggestions (the base view). */
  | { type: 'export'; session: number; requestId: string }

export interface ActiveSuggestion {
  id: string
  changeId: string
  summary: HunkSummary
}

/** The editor to the app. */
export type EditorMessage =
  /** The page loaded; the app answers with `init` for a new session. */
  | { type: 'ready'; protocolVersion: number; schemaVersion: number }
  | { type: 'loaded'; session: number }
  /** A local edit, or what the app lacked after `sync` (base64). */
  | { type: 'update'; session: number; update: string }
  /** Asks the app for what the editor lacks (state vector, base64). */
  | { type: 'sync'; session: number; stateVector: string }
  | { type: 'formatting'; session: number; formatting: FormattingState; focused: boolean }
  | { type: 'suggestions'; session: number; count: number; index: number | null; active: ActiveSuggestion | null }
  /** The editor's own cursor, as Yjs relative positions, for other sessions' awareness. */
  | { type: 'cursor'; session: number; cursor: { anchor: unknown; head: unknown } | null }
  /** The owner resolved suggestions in the editor (review buttons, undo, or typing). */
  | { type: 'resolved'; session: number }
  | { type: 'link'; session: number; href: string }
  | { type: 'export'; session: number; requestId: string; markdown: string | null; error?: string }
  | { type: 'error'; session: number | null; message: string }

export function parseEditorMessage(data: string): EditorMessage | null {
  try {
    const value = JSON.parse(data) as { type?: unknown }
    return value && typeof value === 'object' && typeof value.type === 'string' ? value as EditorMessage : null
  } catch {
    return null
  }
}
