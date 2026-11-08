import { TextSelection } from '@tiptap/pm/state'
import type { DocxEditor, HeaderFooterKind } from '@pulpo/client-core/office/docx/view'

/**
 * The header or footer band a laid-out page (1-based) shows, read from the page sheets and bands
 * under `pages` (the scroller). Undefined when that page shows none of this kind.
 */
export function storyOnPage(pages: ParentNode, kind: HeaderFooterKind, page: number): HTMLElement | undefined {
  const sheet = pages.querySelectorAll('.docx-page')[page - 1]?.getBoundingClientRect()
  if (!sheet) return undefined
  return [...pages.querySelectorAll<HTMLElement>(`[data-story^="${kind}:"]`)].find((element) => {
    if (element.closest('.docx-story-editor')) return false
    const top = element.getBoundingClientRect().top
    return top >= sheet.top - 1 && top <= sheet.bottom + 1
  })
}

/** Opens the header or footer a band shows, over that band, with the cursor at its end. */
export function openStoryOnPage(editor: DocxEditor, band: HTMLElement): boolean {
  const storyId = band.dataset.story
  if (!storyId) return false
  if (editor.editingStory === storyId) return true
  if (!editor.openStoryEditor(storyId, band)) return false
  editor.run((state) => state.tr.setSelection(TextSelection.atEnd(state.doc)))
  return true
}
