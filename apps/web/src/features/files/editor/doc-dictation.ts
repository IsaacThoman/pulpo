import { useEffect, useLayoutEffect, useRef, type KeyboardEvent } from 'react'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Extension, type Editor } from '@tiptap/react'
import { useDictationRecorder, type DictationRecorder } from '@/components/chat/use-dictation-recorder'
import { ui } from '@/i18n/ui'
import { insertDictationText } from '@/lib/dictation'
import { hasPrimaryModifier, isAppleShortcut, shortcutLabel } from '../browser/shortcuts'

/**
 * Starts and finishes dictation. Google Docs uses Mod+Shift+S for voice typing, but here that is
 * strikethrough; D is for dictate.
 */
export function dictationShortcut() {
  return {
    label: shortcutLabel('D', { mod: true, shift: true }),
    aria: `${isAppleShortcut() ? 'Meta' : 'Control'}+Shift+D`,
  }
}

/** Line breaks space the transcript like whitespace does; anything else inline, like a word. */
function leafText(node: ProseMirrorNode): string {
  return node.type.name === 'hardBreak' ? '\n' : '\ufffc'
}

/**
 * Types the transcript over the selection, spaced from the words around it like dictation in the
 * composer, and keeps the marks there, as typing would. False when the document can't be edited.
 */
export function insertDictation(editor: Editor, transcript: string): boolean {
  if (!editor.isEditable) return false
  const { from, to, $from, $to } = editor.state.selection
  if (!$from.parent.isTextblock || !$to.parent.isTextblock) {
    // A selected node, such as a divider: replace it the way pasting text would.
    return editor.chain().focus().insertContent({ type: 'text', text: transcript.trim() }).scrollIntoView().run()
  }
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, leafText)
  const after = $to.parent.textBetween($to.parentOffset, $to.parent.content.size, undefined, leafText)
  const spaced = insertDictationText(before + after, transcript, before.length)
  const text = spaced.value.slice(before.length, spaced.value.length - after.length)
  const cursor = from + spaced.cursor - before.length
  return editor.chain().focus().command(({ tr }) => {
    tr.insertText(text, from, to)
    tr.setSelection(TextSelection.create(tr.doc, cursor))
    return true
  }).scrollIntoView().run()
}

const dictationKeys = new WeakMap<Editor, (event: globalThis.KeyboardEvent) => boolean>()

/**
 * Hands keys typed in the document to `useDocDictation`. The editor marks every Escape as handled,
 * so they never reach the page. After the suggestion review's keys, so Escape closes a
 * suggestion's card before it cancels dictation.
 */
export const DictationKeys = Extension.create({
  name: 'dictationKeys',
  priority: 999,
  addProseMirrorPlugins() {
    const editor = this.editor
    return [new Plugin({
      key: new PluginKey('dictationKeys'),
      props: { handleKeyDown: (_view, event) => dictationKeys.get(editor)?.(event) ?? false },
    })]
  },
})

export interface DocDictation {
  enabled: boolean
  recorder: DictationRecorder
  /** Starts dictating at the cursor, or finishes the recording under way. */
  toggle: () => void
  /** Discards the recording and returns to the document. */
  cancel: () => void
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
}

/** Pulpo dictation into a document: the transcript lands at the cursor once it is ready. */
export function useDocDictation(editor: Editor, editable: boolean, enabled: boolean): DocDictation {
  // Whether the user has put the cursor anywhere yet. Before then, dictation continues the document.
  const placedCursor = useRef(editor.isFocused)
  useEffect(() => {
    const placed = () => { placedCursor.current = true }
    editor.on('focus', placed)
    return () => { editor.off('focus', placed) }
  }, [editor])

  const recorder = useDictationRecorder((text) => {
    if (!insertDictation(editor, text)) recorder.setError(ui("The document can't be edited right now, so the dictation wasn't added."))
  })
  const { phase, cancel: discard } = recorder

  // The document stopped taking edits, e.g. it was trashed: there is nowhere for the words to go.
  useEffect(() => {
    if (!editable && phase !== 'idle') discard()
  }, [discard, editable, phase])

  const cancel = () => {
    discard()
    // Keyboard focus would otherwise fall to the page with the bar's cancel button.
    editor.commands.focus()
  }

  const toggle = () => {
    if (phase === 'recording') {
      recorder.stop()
      return
    }
    if (phase !== 'idle' || !editable) return
    // Show where the words will go: the caret stays in the document while recording.
    if (!editor.isFocused) editor.commands.focus(placedCursor.current ? null : 'end')
    recorder.start()
  }

  /** Escape cancels, as in the composer, and the shortcut starts or finishes. True when handled. */
  const handleKey = (event: globalThis.KeyboardEvent): boolean => {
    if (!enabled || event.isComposing) return false
    if (event.key === 'Escape' && phase !== 'idle') {
      cancel()
      return true
    }
    if (event.key.toLowerCase() === 'd' && event.shiftKey && !event.altKey && hasPrimaryModifier(event)) {
      toggle()
      return true
    }
    return false
  }
  useLayoutEffect(() => {
    dictationKeys.set(editor, handleKey)
    return () => { dictationKeys.delete(editor) }
  })

  /** The same keys elsewhere around the document: the toolbar and the dictation bar. */
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const target = event.target as Element
    // Keys in the document went to `handleKey` already; a suggestion card may have used Escape.
    if (editor.view.dom.contains(target) || event.defaultPrevented) return
    if (handleKey(event.nativeEvent)) event.preventDefault()
  }

  return { enabled, recorder, toggle, cancel, onKeyDown }
}
