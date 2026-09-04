import Underline from '@tiptap/extension-underline'

/** GFM has no underline syntax; safe inline HTML preserves it losslessly. */
export const NoteUnderline = Underline.extend({
  renderMarkdown(node, helpers) {
    return `<u>${helpers.renderChildren(node)}</u>`
  },
})
