import { EditorState } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  applyMarkdownToYDoc,
  applyNodeToYDoc,
  docSchema,
  docView,
  formatBlockSuggestion,
  hasSuggestions,
  listSuggestions,
  resolveSuggestions,
  SUGGESTION_BLOCK_ATTR,
  ydocToMarkdown,
  ydocToNode,
} from './index.js'
import { md, normalize, parse, resolve, sample, suggest, throughYjs } from './suggestions.test.helpers.js'

describe('suggestions in a Y.Doc', () => {
  it('round-trips marks and block attributes', () => {
    const doc = suggest(parse(sample), sample
      .replace('Ship the beta', 'Ship the **public** beta')
      .replace('- Prepare the public launch', '- Prepare the launch party')
      .replace('| Website | Ana | May |', '| Website | Ana | April |\n| Docs | Cy | May |')
      .replace('The end.', 'The end.\n\nOne more thing.')).doc
    expect(listSuggestions(doc).length).toBeGreaterThan(3)
    const copy = throughYjs(doc)
    expect(copy.eq(doc)).toBe(true)
    expect(listSuggestions(copy)).toEqual(listSuggestions(doc))
  })

  it('reads base and proposed Markdown', () => {
    const ydoc = new Y.Doc()
    applyMarkdownToYDoc(ydoc, 'Alpha beta gamma.\n\nDelta.')
    applyNodeToYDoc(ydoc, suggest(ydocToNode(ydoc), 'Alpha gamma epsilon.\n\nNew paragraph.\n\nDelta.').doc)
    expect(ydocToMarkdown(ydoc)).toBe('Alpha beta gamma.\n\nDelta.')
    expect(ydocToMarkdown(ydoc, 'base')).toBe('Alpha beta gamma.\n\nDelta.')
    expect(ydocToMarkdown(ydoc, 'proposed')).toBe('Alpha gamma epsilon.\n\nNew paragraph.\n\nDelta.')
  })

  it('merges suggestions with concurrent edits as small updates', () => {
    const server = new Y.Doc()
    applyMarkdownToYDoc(server, 'First paragraph.\n\nSecond paragraph.')
    const client = new Y.Doc()
    Y.applyUpdate(client, Y.encodeStateAsUpdate(server))
    const before = Y.encodeStateVector(server)
    applyNodeToYDoc(server, suggest(ydocToNode(server), 'First paragraph.\n\nSecond paragraph, revised.').doc)
    const edit = Y.encodeStateAsUpdate(server, before)
    expect(edit.byteLength).toBeLessThan(200)
    // A concurrent client edit to the other paragraph survives the merge.
    client.getXmlFragment('default').insert(0, [new Y.XmlElement('paragraph')])
    Y.applyUpdate(client, edit)
    Y.applyUpdate(server, Y.encodeStateAsUpdate(client))
    expect(ydocToNode(server).eq(ydocToNode(client))).toBe(true)
    expect(ydocToMarkdown(server, 'proposed')).toContain('Second paragraph, revised.')
    expect(ydocToMarkdown(server, 'base')).toContain('Second paragraph.')
    expect(listSuggestions(ydocToNode(client))).toMatchObject([{ changeId: 'c1', inserted: ', revised', deleted: '' }])
  })
})

describe('listSuggestions', () => {
  it('groups pieces into hunks in document order', () => {
    const doc = suggest(parse('# Title\n\nOne two three four five.\n\n- a\n- b'), '# Title\n\nOne 2 three four 5.\n\n- a\n- b\n- c\n\nAdded.').doc
    const hunks = listSuggestions(doc)
    expect(hunks.map(({ id, changeId, inserted, deleted }) => ({ id, changeId, inserted, deleted }))).toEqual([
      { id: 'c1-1', changeId: 'c1', inserted: '2', deleted: 'two' },
      { id: 'c1-2', changeId: 'c1', inserted: '5', deleted: 'five' },
      { id: 'c1-3', changeId: 'c1', inserted: 'c', deleted: '' },
      { id: 'c1-4', changeId: 'c1', inserted: 'Added.', deleted: '' },
    ])
    for (const hunk of hunks) {
      expect(hunk.from).toBeLessThan(hunk.to)
      expect(doc.textBetween(hunk.from, hunk.to, '\n')).toContain(hunk.inserted.split('\n')[0])
    }
    expect(hunks[0]!.to).toBeLessThan(hunks[1]!.from)
  })

  it('puts line breaks between the blocks of one hunk', () => {
    const doc = suggest(parse('Keep.'), 'Keep.\n\nFirst new.\n\nSecond new.').doc
    expect(listSuggestions(doc)).toMatchObject([{ inserted: 'First new.\nSecond new.', deleted: '' }])
  })

  it('returns nothing for a document without suggestions', () => {
    expect(listSuggestions(parse(sample))).toEqual([])
    expect(hasSuggestions(parse(sample))).toBe(false)
  })
})

describe('resolveSuggestions', () => {
  const original = parse(sample)
  const edited = sample
    .replace('Some **bold** text, some *italic* words', 'Some text, some *slanted* words')
    .replace('  - Fix the top three issues\n', '')
    .replace('- [ ] Book the venue', '- [x] Book the venue')
    .replace('| Press kit | Ben | June |', '| Press kit | Ben | July |')
    .replace('The end.', 'The real end.')
  const suggested = suggest(original, edited).doc

  it('accepts or rejects everything', () => {
    expect(md(resolve(suggested, 'accept'))).toBe(normalize(edited))
    expect(resolve(suggested, 'reject').eq(original)).toBe(true)
    expect(docView(suggested, 'proposed').eq(resolve(suggested, 'accept'))).toBe(true)
    expect(docView(suggested, 'base').eq(original)).toBe(true)
    expect(docView(original, 'base')).toBe(original)
  })

  it('resolves some hunks in an editor transaction', () => {
    const state = EditorState.create({ doc: suggested })
    const hunks = listSuggestions(suggested)
    const [first, ...rest] = hunks
    const accepted = state.apply(resolveSuggestions(state.tr, (ref) => ref.id === first!.id, 'accept'))
    accepted.doc.check()
    expect(listSuggestions(accepted.doc).map((hunk) => hunk.id)).toEqual(rest.map((hunk) => hunk.id))
    expect(first).toMatchObject({ inserted: '', deleted: 'bold ' })
    expect(md(docView(accepted.doc, 'base'))).toContain('Some text, some *italic* words')
    expect(md(docView(accepted.doc, 'proposed'))).toBe(normalize(edited))

    const removal = rest.find((hunk) => hunk.deleted === 'Fix the top three issues')!
    const rejected = accepted.apply(resolveSuggestions(accepted.tr, (ref) => ref.id === removal.id, 'reject'))
    rejected.doc.check()
    expect(listSuggestions(rejected.doc).map((hunk) => hunk.id)).toEqual(rest.filter((hunk) => hunk !== removal).map((hunk) => hunk.id))
    expect(md(docView(rejected.doc, 'proposed'))).toBe(normalize(edited.replace('  - Collect feedback weekly\n', '  - Collect feedback weekly\n  - Fix the top three issues\n')))
  })

  it('resolves a hunk that spans differently formatted text', () => {
    const doc = parse('Start **bold one** and *italic two* plus `code three` end.')
    const result = suggest(doc, 'Start plain words end.').doc
    expect(listSuggestions(result)).toMatchObject([{ inserted: 'plain words', deleted: 'bold one and italic two plus code three' }])
    expect(md(resolve(result, 'accept'))).toBe('Start plain words end.')
    expect(resolve(result, 'reject').eq(doc)).toBe(true)
  })

  it('only resolves the hunks of the matching change', () => {
    const first = suggest(parse('One two three.\n\nFour five six.'), 'One 2 three.\n\nFour five six.', 'c1').doc
    const second = suggest(first, 'One 2 three.\n\nFour 5 six.', 'c2').doc
    expect(listSuggestions(second).map((hunk) => hunk.changeId)).toEqual(['c1', 'c2'])
    const rejected = resolve(second, 'reject', (ref) => ref.changeId === 'c2')
    expect(md(docView(rejected, 'proposed'))).toBe('One 2 three.\n\nFour five six.')
    expect(listSuggestions(rejected).map((hunk) => hunk.changeId)).toEqual(['c1'])
  })

  it('keeps containers valid when rejecting inserted blocks', () => {
    const doc = parse('- only item\n\n> quoted words here\n\n| a | b |\n| --- | --- |\n| 1 | 2 |')
    const result = suggest(doc, '- only item\n- second item\n  - nested new\n\n> brand new quote\n>\n> another\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |').doc
    for (const action of ['accept', 'reject'] as const) {
      const hunks = listSuggestions(result)
      // Every subset in order: one at a time, the way a user clicks through them.
      let current = result
      for (const hunk of hunks) {
        current = resolve(current, action, (ref) => ref.id === hunk.id)
        current.check()
      }
      expect(hasSuggestions(current)).toBe(false)
    }
    expect(resolve(result, 'reject').eq(doc)).toBe(true)
  })

  it('removes a list emptied by rejecting its only inserted item', () => {
    const schema = docSchema()
    const item = schema.nodes.listItem!.create({ [SUGGESTION_BLOCK_ATTR]: formatBlockSuggestion({ kind: 'insert', changeId: 'c1', id: 'h1' }) }, schema.nodes.paragraph!.create(null, schema.text('new')))
    const doc = schema.nodes.doc!.create(null, [schema.nodes.paragraph!.create(null, schema.text('Keep.')), schema.nodes.bulletList!.create(null, item)])
    const rejected = resolve(doc, 'reject')
    rejected.check()
    expect(md(rejected)).toBe('Keep.')
  })
})
