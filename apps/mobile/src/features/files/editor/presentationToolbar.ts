import type { EditorBridgeState } from './bridge'
import type { PresentationCommand } from './protocol'
import type { NativeToolbarItem } from './textToolbar'

/**
 * The presentation editor's bar on phones: what people do most on a small screen (add slides and
 * text, quick formatting, present). Arranging and detailed formatting stay on larger screens.
 */
export const PRESENTATION_TOOLBAR: ReadonlyArray<NativeToolbarItem & { command: PresentationCommand }> = [
  { command: 'undo', label: 'Undo', systemImage: 'arrow.uturn.backward' },
  { command: 'redo', label: 'Redo', systemImage: 'arrow.uturn.forward' },
  { command: 'newSlide', label: 'New slide', systemImage: 'plus.rectangle.on.rectangle' },
  { command: 'textBox', label: 'Text box', systemImage: 'textformat' },
  { command: 'shape', label: 'Shape', systemImage: 'square.on.circle' },
  { command: 'bold', label: 'Bold', systemImage: 'bold' },
  { command: 'italic', label: 'Italic', systemImage: 'italic' },
  { command: 'bullets', label: 'Bulleted list', systemImage: 'list.bullet' },
  { command: 'delete', label: 'Delete', systemImage: 'trash' },
  { command: 'present', label: 'Present', systemImage: 'play.rectangle' },
]

/** What the presentation bar shows as on or unavailable. */
export function presentationToolbarState(state: EditorBridgeState): { active: string[]; disabled: string[] } {
  const deck = state.presentation
  if (!deck) return { active: [], disabled: PRESENTATION_TOOLBAR.map((item) => item.command) }
  const active = [...deck.bold ? ['bold'] : [], ...deck.italic ? ['italic'] : [], ...deck.bullets ? ['bullets'] : []]
  const disabled = [
    ...!deck.canUndo ? ['undo'] : [],
    ...!deck.canRedo ? ['redo'] : [],
    ...!deck.canFormatText ? ['bold', 'italic', 'bullets'] : [],
    ...!deck.hasSelection && deck.slideCount < 2 ? ['delete'] : [],
  ]
  return { active, disabled }
}
