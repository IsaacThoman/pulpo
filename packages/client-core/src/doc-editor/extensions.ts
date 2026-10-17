import type { AnyExtension } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import { Placeholder } from '@tiptap/extensions'
import type { Awareness } from 'y-protocols/awareness'
import type * as Y from 'yjs'
import { createDocExtensions } from '../doc-schema/schema.js'
import { SuggestionTyping } from './suggestion-typing.js'

export interface EditorExtensionOptions {
  doc: Y.Doc
  /** The session's awareness; carets of other sessions render from it. */
  awareness: Awareness
  /** How other sessions label this one's caret. */
  user: { name: string; color: string }
  placeholder: string
}

/**
 * Everything a collaborative document editor runs: the shared schema, the rules that keep the
 * owner's typing out of suggestions, the Yjs binding (which also supplies undo), and carets.
 */
export function createEditorExtensions({ doc, awareness, user, placeholder }: EditorExtensionOptions): AnyExtension[] {
  return [
    ...createDocExtensions(),
    SuggestionTyping,
    Placeholder.configure({ placeholder }),
    Collaboration.configure({ document: doc }),
    // The caret extension only reads the provider's awareness.
    CollaborationCaret.configure({ provider: { awareness }, user }),
  ]
}
