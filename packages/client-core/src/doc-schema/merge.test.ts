import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  applyNodeToYDoc,
  docView,
  hasSuggestions,
  listSuggestions,
  mergeMarkdown,
  parseBlockSuggestion,
  SUGGESTION_BLOCK_ATTR,
  suggestionFromMark,
  ydocToNode,
} from './index.js'
import { md, normalize, parse, resolve, sample, suggest, throughYjs, write } from './suggestions.test.helpers.js'

/** Every suggestion piece as `kind:changeId:id:text`, in document order. */
function pieces(doc: ProseMirrorNode): string[] {
  const out: string[] = []
  doc.descendants((node) => {
    const block = parseBlockSuggestion(node.attrs[SUGGESTION_BLOCK_ATTR])
    if (block) out.push(`${block.kind}:${block.changeId}:${block.id}:${node.textContent}`)
    for (const mark of node.marks) {
      const ref = suggestionFromMark(mark)
      if (ref) out.push(`${ref.kind}:${ref.changeId}:${ref.id}:${node.text ?? node.type.name}`)
    }
  })
  return out
}

/** The invariants every merge must keep, checked on one original document and one push. */
function expectConsistent(original: ProseMirrorNode, markdown: string) {
  const suggested = suggest(original, markdown)
  const written = write(original, markdown)
  suggested.doc.check()
  written.doc.check()
  const proposed = docView(suggested.doc, 'proposed')
  expect(md(proposed)).toBe(normalize(markdown))
  expect(docView(suggested.doc, 'base').eq(docView(original, 'base'))).toBe(true)
  expect(md(written.doc)).toBe(md(proposed))
  expect(written.doc.eq(proposed)).toBe(true)
  expect(throughYjs(suggested.doc).eq(suggested.doc)).toBe(true)
  return suggested
}

describe('mergeMarkdown', () => {
  const original = parse(sample)

  it('leaves the document alone when the Markdown matches its proposed view', () => {
    const unchanged = suggest(original, md(original))
    expect(unchanged).toMatchObject({ changed: false, hunks: 0 })
    expect(unchanged.doc.eq(original)).toBe(true)
    expect(write(original, sample).changed).toBe(false)

    const suggested = suggest(original, sample.replace('Ship the beta', 'Ship the private beta')).doc
    const again = suggest(suggested, md(docView(suggested, 'proposed')), 'c2')
    expect(again).toMatchObject({ changed: false, hunks: 0 })
    expect(again.doc.eq(suggested)).toBe(true)
  })

  it('suggests word-level changes inside paragraphs', () => {
    const result = expectConsistent(parse('The quick brown fox jumps over the lazy dog.'), 'The slow brown fox leaps over the lazy cat.')
    expect(result.hunks).toBe(3)
    expect(pieces(result.doc)).toEqual([
      'delete:c1:c1-1:quick', 'insert:c1:c1-1:slow',
      'delete:c1:c1-2:jumps', 'insert:c1:c1-2:leaps',
      'delete:c1:c1-3:dog', 'insert:c1:c1-3:cat',
    ])
  })

  it('joins changes separated by a single space into one hunk', () => {
    const result = expectConsistent(parse('Keep the quick fox here.'), 'Keep a slow fox here.')
    expect(result.hunks).toBe(1)
    expect(listSuggestions(result.doc)).toMatchObject([{ deleted: 'the quick', inserted: 'a slow' }])
  })

  it('replaces the whole text of a block', () => {
    const doc = parse('# Title\n\nCompletely different words.\n\nTail.')
    const result = expectConsistent(doc, '# Title\n\nNothing alike here at all.\n\nTail.')
    expect(listSuggestions(result.doc)).toMatchObject([{ deleted: 'Completely different words', inserted: 'Nothing alike here at all' }])
    expect(md(resolve(result.doc, 'reject'))).toBe(md(doc))
  })

  it('keeps formatting, links, and Markdown-special characters', () => {
    const doc = parse('Use **bold**, `a_b * c`, [docs](https://example.com/a_b), and 2 * 3 < 7 & [x].')
    expectConsistent(doc, 'Use **strong bold**, `a_b * d`, [the docs](https://example.com/a_b), and 2 * 4 < 7 & [y].')
    // Formatting changes are changes too.
    const formatted = expectConsistent(doc, 'Use *bold*, `a_b * c`, [docs](https://example.com/other), and 2 * 3 < 7 & [x].')
    expect(listSuggestions(formatted.doc).map((hunk) => hunk.inserted)).toEqual(['bold', 'docs'])
  })

  it('handles whitespace and line breaks', () => {
    expectConsistent(parse('Trailing spaces   \n\nline one\nline two\n\nTabs\tand  doubles.'), 'Trailing spaces\n\nline one\nline 2\n\nTabs\tand doubles.')
    expectConsistent(parse('A hard  \nbreak here.'), 'A hard  \nbreak there.')
  })

  it('inserts and deletes list items', () => {
    const doc = parse('- one\n- two\n  - two a\n  - two b\n- three')
    const added = expectConsistent(doc, '- one\n- two\n  - two a\n  - two and a half\n  - two b\n- three\n- four')
    expect(pieces(added.doc)).toEqual(['insert:c1:c1-1:two and a half', 'insert:c1:c1-2:four'])
    const removed = expectConsistent(doc, '- one\n- three')
    expect(pieces(removed.doc)).toEqual(['delete:c1:c1-1:twotwo atwo b'])
    // Rejecting keeps a valid list; accepting drops the item with its children.
    expect(md(resolve(removed.doc, 'accept'))).toBe('- one\n- three')
  })

  it('handles ordered lists, renumbering, and nested structure', () => {
    const doc = parse('1. first\n2. second\n3. third')
    expectConsistent(doc, '1. first\n2. second, edited\n3. third')
    expectConsistent(doc, '1. first\n2. inserted\n3. second\n4. third')
    expectConsistent(doc, 'a. first\nb. second\nc. third')
    const restarted = expectConsistent(doc, '3. first\n4. second\n5. third')
    expect(pieces(restarted.doc).map((piece) => piece.split(':')[0])).toEqual(['delete', 'insert'])
  })

  it('changes heading levels as whole blocks and heading text inline', () => {
    const doc = parse('# Plan\n\nBody.')
    const level = expectConsistent(doc, '## Plan\n\nBody.')
    expect(pieces(level.doc)).toEqual(['delete:c1:c1-1:Plan', 'insert:c1:c1-1:Plan'])
    const text = expectConsistent(doc, '# Better plan\n\nBody.')
    expect(pieces(text.doc)).toEqual(['delete:c1:c1-1:Plan', 'insert:c1:c1-1:Better plan'])
  })

  it('toggles task items', () => {
    const doc = parse('- [ ] Book the venue\n- [x] Order the shirts')
    const toggled = expectConsistent(doc, '- [x] Book the venue\n- [x] Order the shirts')
    expect(pieces(toggled.doc)).toEqual(['delete:c1:c1-1:Book the venue', 'insert:c1:c1-1:Book the venue'])
    expect(md(resolve(toggled.doc, 'accept'))).toBe('- [x] Book the venue\n- [x] Order the shirts')
  })

  it('edits table cells and rows, and replaces tables whose columns change', () => {
    const doc = parse('| Task | Owner |\n| --- | --- |\n| Website | Ana |\n| Press kit | Ben |')
    const cell = expectConsistent(doc, '| Task | Owner |\n| --- | --- |\n| Website | Ana Lopez |\n| Press kit | Ben |')
    expect(pieces(cell.doc)).toEqual(['insert:c1:c1-1: Lopez'])
    const row = expectConsistent(doc, '| Task | Owner |\n| --- | --- |\n| Website | Ana |\n| Blog | Cy |\n| Press kit | Ben |')
    expect(pieces(row.doc)).toEqual(['insert:c1:c1-1:BlogCy'])
    const column = expectConsistent(doc, '| Task | Owner | Due |\n| --- | --- | --- |\n| Website | Ana | May |\n| Press kit | Ben | June |')
    expect(pieces(column.doc).map((piece) => piece.split(':')[0])).toEqual(['delete', 'insert'])
    expectConsistent(doc, '| Task | Owner |\n| :--- | ---: |\n| Website | Ana |\n| Press kit | Ben |')
  })

  it('edits code blocks line by line and replaces them when the language changes', () => {
    const doc = parse('```ts\nconst a = 1\nconst b = 2\n```')
    const edited = expectConsistent(doc, '```ts\nconst a = 1\nconst b = 3\nconst c = 4\n```')
    expect(listSuggestions(edited.doc)).toMatchObject([{ deleted: '2', inserted: '3\nconst c = 4' }])
    const language = expectConsistent(doc, '```js\nconst a = 1\nconst b = 2\n```')
    expect(pieces(language.doc).map((piece) => piece.split(':')[0])).toEqual(['delete', 'insert'])
  })

  it('inserts and deletes blocks of every kind', () => {
    expectConsistent(original, `${sample}\n\n> A new quote\n\n---\n\n\`\`\`\nnew code\n\`\`\``)
    expectConsistent(original, sample.replace(/\n\n> Quotes keep us honest\.\n>\n> - even with lists inside/, '').replace('\n\n---', ''))
    expectConsistent(original, sample.replace('## Goals', '## Goals\n\nA new intro paragraph.\n\n### Details'))
  })

  it('works on an empty document', () => {
    const empty = ydocToNode(new Y.Doc())
    expect(empty.childCount).toBe(0)
    const result = suggest(empty, '# Title\n\nHello.')
    expect(result).toMatchObject({ changed: true, hunks: 1 })
    expect(pieces(result.doc)).toEqual(['insert:c1:c1-1:Title', 'insert:c1:c1-1:Hello.'])
    expect(md(docView(result.doc, 'proposed'))).toBe('# Title\n\nHello.')
    expect(write(empty, '# Title\n\nHello.').doc.eq(docView(result.doc, 'proposed'))).toBe(true)
    // Rejecting everything leaves the empty paragraph a document needs.
    const rejected = resolve(result.doc, 'reject')
    rejected.check()
    expect(md(rejected)).toBe('')
    expect(suggest(empty, '')).toMatchObject({ changed: false, hunks: 0 })
    const cleared = suggest(original, '')
    expect(md(docView(cleared.doc, 'proposed'))).toBe('')
    expect(docView(cleared.doc, 'base').eq(original)).toBe(true)
    expect(write(original, '').doc.childCount).toBe(0)
  })

  it('works on a document that only holds suggestions', () => {
    const empty = ydocToNode(new Y.Doc())
    const first = suggest(empty, 'Proposed paragraph.\n\n- proposed item').doc
    expect(md(docView(first, 'base'))).toBe('')
    // The agent edits its own pending insertion in place.
    const second = suggest(first, 'Proposed paragraph, edited.\n\n- proposed item', 'c2')
    expect(second.hunks).toBe(0)
    expect(pieces(second.doc)).toEqual(['insert:c1:c1-1:Proposed paragraph, edited.', 'insert:c1:c1-1:proposed item'])
    expect(md(docView(second.doc, 'base'))).toBe('')
    expect(md(docView(second.doc, 'proposed'))).toBe('Proposed paragraph, edited.\n\n- proposed item')
    // Dropping it removes it outright.
    const third = suggest(second.doc, '- proposed item', 'c3')
    expect(third.changed).toBe(true)
    expect(pieces(third.doc)).toEqual(['insert:c1:c1-1:proposed item'])
  })

  it('keeps earlier suggestions untouched in a later reply', () => {
    const first = suggest(parse('Alpha beta gamma.\n\nDelta epsilon.\n\nZeta.'), 'Alpha BETA gamma.\n\nDelta epsilon.\n\nZeta.', 'c1').doc
    const second = expectConsistentFrom(first, 'Alpha BETA gamma.\n\nDelta EPSILON.\n\nZeta and more.', 'c2')
    expect(pieces(second)).toEqual([
      'delete:c1:c1-1:beta', 'insert:c1:c1-1:BETA',
      'delete:c2:c2-1:epsilon', 'insert:c2:c2-1:EPSILON',
      'insert:c2:c2-2: and more',
    ])
    expect(md(docView(resolve(second, 'reject', (ref) => ref.changeId === 'c1'), 'proposed'))).toBe('Alpha beta gamma.\n\nDelta EPSILON.\n\nZeta and more.')
  })

  it('removes text an earlier suggestion inserted instead of suggesting its deletion', () => {
    const first = suggest(parse('One two three.'), 'One two and a half three.', 'c1').doc
    const second = expectConsistentFrom(first, 'One two half three.', 'c2')
    expect(pieces(second)).toEqual(['insert:c1:c1-1:half '])
    const gone = expectConsistentFrom(first, 'One two three.', 'c2')
    expect(hasSuggestions(gone)).toBe(false)
    // Same for whole blocks.
    const block = suggest(parse('Keep.'), 'Keep.\n\nProposed block.', 'c1').doc
    expect(hasSuggestions(expectConsistentFrom(block, 'Keep.', 'c2'))).toBe(false)
  })

  it('leaves content an earlier suggestion deletes where it is', () => {
    const first = suggest(parse('One two three four.\n\nGone paragraph.\n\nEnd.'), 'One three four.\n\nEnd.', 'c1').doc
    const second = expectConsistentFrom(first, 'One three five.\n\nNew paragraph.\n\nEnd.', 'c2')
    expect(pieces(second)).toEqual([
      'delete:c1:c1-1:two ',
      'delete:c2:c2-1:four', 'insert:c2:c2-1:five',
      'delete:c1:c1-2:Gone paragraph.',
      'insert:c2:c2-2:New paragraph.',
    ])
    expect(md(docView(second, 'base'))).toBe('One two three four.\n\nGone paragraph.\n\nEnd.')
  })

  it('applies Write mode without touching other pending suggestions', () => {
    const first = suggest(parse('One two three.\n\nFour five.'), 'One 2 three.\n\nFour five.', 'c1').doc
    const written = mergeMarkdown(first, 'One 2 three.\n\nFour 5 and six.', { mode: 'write', changeId: 'c2' })
    expect(written).toMatchObject({ changed: true, hunks: 1 })
    expect(pieces(written.doc)).toEqual(['delete:c1:c1-1:two', 'insert:c1:c1-1:2'])
    expect(md(docView(written.doc, 'base'))).toBe('One two three.\n\nFour 5 and six.')
  })

  it('never suggests deleting blank paragraphs', () => {
    const schema = original.type.schema
    const doc = schema.nodes.doc!.create(null, [
      schema.nodes.paragraph!.create(null, schema.text('First.')),
      schema.nodes.paragraph!.create(),
      schema.nodes.paragraph!.create(),
      schema.nodes.paragraph!.create(null, schema.text('Second.')),
    ])
    for (const mode of ['suggest', 'write'] as const) {
      const result = mergeMarkdown(doc, 'First.\n\nSecond.', { mode, changeId: 'c1' })
      expect(result.changed).toBe(false)
      expect(result.doc.eq(doc)).toBe(true)
    }
  })

  it('generates hunk ids that are unique in the document', () => {
    const first = suggest(parse('a b c'), 'a x c', 'c1', () => 'same').doc
    const ids = ['same', 'same', 'other']
    const second = suggest(first, 'a x y', 'c2', () => ids.shift()!).doc
    expect(listSuggestions(second).map((hunk) => hunk.id)).toEqual(['same', 'other'])
    const generated = mergeMarkdown(parse('a b c'), 'a b d', { mode: 'suggest', changeId: 'c1' }).doc
    expect(listSuggestions(generated)[0]!.id).toMatch(/^[0-9a-z]{12}$/)
  })

  it('is fast on long documents and produces small Yjs updates', () => {
    const paragraphs = Array.from({ length: 2000 }, (_, i) => `Paragraph ${i} talks about **topic ${i % 17}** and [link ${i}](https://example.com/${i}).`)
    const doc = parse(paragraphs.join('\n\n'))
    paragraphs[1000] = 'Paragraph 1000 talks about something else entirely now.'
    paragraphs.splice(1500, 0, 'A brand new paragraph.')
    const markdown = paragraphs.join('\n\n')

    const started = performance.now()
    const result = suggest(doc, markdown)
    const elapsed = performance.now() - started
    expect(result.hunks).toBe(2)
    expect(elapsed).toBeLessThan(500)

    const ydoc = new Y.Doc()
    applyNodeToYDoc(ydoc, doc)
    const before = Y.encodeStateVector(ydoc)
    applyNodeToYDoc(ydoc, result.doc)
    expect(Y.encodeStateAsUpdate(ydoc, before).byteLength).toBeLessThan(1000)
    expect(md(docView(ydocToNode(ydoc), 'proposed'))).toBe(normalize(markdown))
  })

  it('still diffs each block when an edit touches every one of them', () => {
    const paragraphs = Array.from({ length: 400 }, (_, i) => `Paragraph ${i} says something about item ${i % 13}.`)
    const edited = paragraphs.map((paragraph) => paragraph.replace('says', 'claims'))
    edited.splice(100, 0, 'Inserted paragraph.')
    edited.splice(300, 3)
    const result = expectConsistent(parse(paragraphs.join('\n\n')), edited.join('\n\n'))
    const hunks = listSuggestions(result.doc)
    expect(hunks).toHaveLength(397 + 2)
    expect(hunks.filter((hunk) => hunk.deleted === 'says' && hunk.inserted === 'claims')).toHaveLength(397)
    expect(hunks.find((hunk) => !hunk.inserted)?.deleted.split('\n')).toHaveLength(3)
  })

  it('falls back to replacing the changed middle of huge blocks', () => {
    const words = (seed: string) => Array.from({ length: 2500 }, (_, i) => `${seed}${i}`).join(' ')
    const doc = parse(`Start ${words('a')} end.`)
    const started = performance.now()
    const result = expectConsistent(doc, `Start ${words('b')} end.`)
    expect(performance.now() - started).toBeLessThan(2000)
    expect(listSuggestions(result.doc)).toHaveLength(1)
  })
})

/** Like `expectConsistent`, for documents that already hold suggestions. */
function expectConsistentFrom(current: ProseMirrorNode, markdown: string, changeId: string): ProseMirrorNode {
  const suggested = suggest(current, markdown, changeId)
  const written = write(current, markdown, changeId)
  suggested.doc.check()
  expect(md(docView(suggested.doc, 'proposed'))).toBe(normalize(markdown))
  expect(docView(suggested.doc, 'base').eq(docView(current, 'base'))).toBe(true)
  expect(md(docView(written.doc, 'proposed'))).toBe(normalize(markdown))
  expect(throughYjs(suggested.doc).eq(suggested.doc)).toBe(true)
  return suggested.doc
}

describe('mergeMarkdown on random edits', () => {
  const vocabulary = ['alpha', 'beta', 'release', 'team', 'Docs', 'launch', 'quickly', 'new', 'and', 'the']

  function random(seed: number) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  /** A few word-level and line-level edits to Markdown source, the way an agent rewrites a file. */
  function edit(source: string, next: () => number, count: number): string {
    const pick = <T>(items: T[]) => items[Math.floor(next() * items.length)]!
    for (let n = 0; n < count; n++) {
      const words = [...source.matchAll(/[A-Za-z]{2,}/g)]
      const word = pick(words)
      const at = word.index
      const end = at + word[0].length
      const lines = source.split('\n')
      const line = Math.floor(next() * lines.length)
      switch (Math.floor(next() * 8)) {
        case 0: source = source.slice(0, at) + pick(vocabulary) + source.slice(end); break
        case 1: source = source.slice(0, at) + source.slice(source[end] === ' ' ? end + 1 : end); break
        case 2: source = `${source.slice(0, end)} ${pick(vocabulary)}${source.slice(end)}`; break
        case 3: source = `${source.slice(0, at)}**${word[0]}**${source.slice(end)}`; break
        case 4: lines.splice(line, 1); source = lines.join('\n'); break
        case 5: lines.splice(line, 0, lines[line]!); source = lines.join('\n'); break
        case 6: source = source.replace(next() < 0.5 ? '- [ ]' : '- [x]', next() < 0.5 ? '- [x]' : '- [ ]'); break
        default: {
          const blank = lines.flatMap((text, index) => (text === '' ? [index] : []))
          if (blank.length) lines.splice(pick(blank), 0, '', `${pick(vocabulary)} ${pick(vocabulary)} paragraph.`)
          source = lines.join('\n')
        }
      }
    }
    return source
  }

  it.each(Array.from({ length: 40 }, (_, seed) => seed + 1))('keeps every view consistent (seed %i)', (seed) => {
    const next = random(seed)
    const original = parse(sample)
    const first = edit(sample, next, 1 + Math.floor(next() * 5))
    const suggested = expectConsistent(original, first)
    expect(resolve(suggested.doc, 'reject').eq(original)).toBe(true)
    expect(resolve(suggested.doc, 'accept').eq(write(original, first).doc)).toBe(true)
    expect(suggest(suggested.doc, md(docView(suggested.doc, 'proposed')), 'c2').changed).toBe(false)

    // A second reply edits the proposed view again.
    const second = edit(normalize(first), next, 1 + Math.floor(next() * 4))
    const again = expectConsistentFrom(suggested.doc, second, 'c2')
    expect(resolve(again, 'reject').eq(original)).toBe(true)
    expect(md(resolve(again, 'accept'))).toBe(normalize(second))
    const withoutSecond = resolve(again, 'reject', (ref) => ref.changeId === 'c2')
    withoutSecond.check()
    expect(md(resolve(withoutSecond, 'reject'))).toBe(md(original))
  })
})
