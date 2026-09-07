export type ComposerSelection = { start: number; end: number }

/** Update the controlled native selection and its synchronous snapshot together. */
export function setComposerSelection(
  setSelection: (selection: ComposerSelection) => void,
  selectionRef: { current: ComposerSelection },
  selection: ComposerSelection,
): void {
  selectionRef.current = selection
  setSelection(selection)
}
