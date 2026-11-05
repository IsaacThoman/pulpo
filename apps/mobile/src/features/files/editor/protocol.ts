import type { FormatCommand, FormattingState, HunkSummary } from '@pulpo/client-core/doc-editor'
import type { TextEditorState } from '@pulpo/client-core/office/text/view'

/**
 * Messages between the app and the document editor running in its web view.
 *
 * The app owns the document: its Y.Doc, local copy, and sync. The editor holds a replica built
 * from `init` and exchanges Yjs updates with it, so a web view that crashes or is torn down never
 * loses edits the app has seen. Every message after `ready` carries the `session` it belongs to;
 * the editor reloads with a new session, and both sides drop messages from earlier ones.
 * Updates are idempotent CRDT merges, and either side can ask for what it lacks with `sync`.
 *
 * Each live format ships its own page (Markdown's TipTap editor, text's CodeMirror editor) that
 * speaks this protocol: the sync messages are shared, and each format adds its own commands and
 * state (`format`/`review`/`formatting` for Markdown, `command`/`textState` for text). A page says
 * which format and schema version it edits in `ready`.
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
    /** The file name, for formats whose editor depends on it (a code file's language). */
    name?: string
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
  /** A text or presentation editor command from the app's toolbar. */
  | { type: 'command'; session: number; command: TextCommand | PresentationCommand }
  /** The answer to the editor's `asset` request: the bytes (base64), or why there are none. */
  | { type: 'asset'; session: number; requestId: string; data?: string; error?: string }
  /** The file was renamed; text editors pick their language from the name. */
  | { type: 'name'; session: number; name: string }
  /**
   * Shows an agent's proposed deck against the current one instead of an editor: both versions
   * as .pptx bytes (base64). The page answers `loaded`, or `error` when a version cannot be read.
   */
  | { type: 'presentationDiff'; session: number; before: string; after: string; theme: EditorTheme }

export type TextCommand = 'undo' | 'redo' | 'indentMore' | 'indentLess' | 'find' | 'wrap'

/** The presentation editor's toolbar. */
export type PresentationCommand = 'undo' | 'redo' | 'newSlide' | 'textBox' | 'shape' | 'bold' | 'italic' | 'bullets' | 'delete' | 'present' | 'endShow'

/** What a presentation editor's toolbar shows. */
export interface PresentationEditorState {
  canUndo: boolean
  canRedo: boolean
  bold: boolean
  italic: boolean
  bullets: boolean
  /** Text formatting applies (text is being edited, or a shape with text is selected). */
  canFormatText: boolean
  /** Shapes are selected, so Delete removes them (otherwise it removes the slide). */
  hasSelection: boolean
  slideCount: number
  readOnly: boolean
  /** The slide show is running: the app gives the page the whole screen. Older pages omit it. */
  presenting?: boolean
}

export interface ActiveSuggestion {
  id: string
  changeId: string
  summary: HunkSummary
}

/** The editor to the app. */
export type EditorMessage =
  /** The page loaded; the app answers with `init` for a new session. */
  /** `format` is the live format the page edits; pages from before it are Markdown. */
  | { type: 'ready'; protocolVersion: number; schemaVersion: number; format?: string }
  | { type: 'loaded'; session: number }
  /** A local edit, or what the app lacked after `sync` (base64). */
  | { type: 'update'; session: number; update: string }
  /** Asks the app for what the editor lacks (state vector, base64). */
  | { type: 'sync'; session: number; stateVector: string }
  | { type: 'formatting'; session: number; formatting: FormattingState; focused: boolean }
  /** What a text editor's toolbar shows: undo state, cursor position, wrapping. */
  | { type: 'textState'; session: number; state: TextEditorState }
  /** What a presentation editor's toolbar shows. */
  | { type: 'presentationState'; session: number; state: PresentationEditorState }
  /**
   * Asks the app for an asset's bytes (an image in a deck): the page has no network access, so the
   * app fetches them from the document's assets.
   */
  | { type: 'asset'; session: number; requestId: string; hash: string }
  | { type: 'suggestions'; session: number; count: number; index: number | null; active: ActiveSuggestion | null }
  /** The editor's own cursor, as Yjs relative positions, for other sessions' awareness. */
  | { type: 'cursor'; session: number; cursor: { anchor: unknown; head: unknown } | null; presentation?: { slide: string | null; shapes: string[]; editing?: string | null } | null }
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
