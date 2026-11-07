// @vitest-environment jsdom
import { expect, it } from 'vitest'
import * as Y from 'yjs'
import { DEFAULT_THEME } from '../render/deck.js'
import { bodyLayout } from '../render/text.js'
import { InlineTextEditor } from './text-editor.js'

it('rejects local text commands and transactions in read-only mode but accepts remote updates', () => {
  const doc = new Y.Doc()
  const fragment = doc.getXmlFragment('text')
  const editor = new InlineTextEditor({
    mount: document.body,
    fragment,
    style: { context: { chain: [], theme: DEFAULT_THEME, colors: { scheme: DEFAULT_THEME.colors, colorMap: {} } }, body: bodyLayout([]) },
    onUndo: () => {},
    onRedo: () => {},
  })
  try {
    editor.view.dispatch(editor.view.state.tr.insertText('Before'))
    editor.setReadOnly(true)
    const before = Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64')
    editor.view.dispatch(editor.view.state.tr.insertText('Forbidden'))
    editor.run((state, dispatch) => { dispatch?.(state.tr.insertText('Also forbidden')); return true })
    expect(Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64')).toBe(before)
    const text = (fragment.get(0) as Y.XmlElement).get(0) as Y.XmlText
    text.insert(text.length, ' remote')
    expect(editor.view.state.doc.textContent).toBe('Before remote')
    editor.setReadOnly(false)
    editor.view.dispatch(editor.view.state.tr.insertText(' allowed'))
    expect(editor.view.state.doc.textContent).toContain(' allowed')
  } finally {
    editor.destroy()
    document.body.replaceChildren()
    doc.destroy()
  }
})
