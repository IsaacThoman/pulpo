import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { LiveFormatError } from '../live-format.js'
import { OoxmlPackage } from '../ooxml/package.js'
import { blankDocx } from './blank.js'
import { docxCodec } from './codec.js'
import { packJml } from './jsonml.js'
import { MemoryAssetStore } from './memory-assets.js'
import { BODY_FRAGMENT, readDocxModel, writeDocxModel, writeFragment } from './model.js'
import { docxSchema } from './schema.js'

const schema = docxSchema()
const context = (assets = new MemoryAssetStore(), name = 'Test.docx') => ({ name, assets })

const run = (text: string, ...marks: string[]) => schema.text(text, marks.map((name) => schema.mark(name, { v: packJml([`w:${name}`, {}]) })))
const paragraph = (attrs: Record<string, unknown>, ...content: ProseMirrorNode[]) => schema.node('paragraph', attrs, content)

function setBody(doc: Y.Doc, body: ProseMirrorNode, origin?: unknown) {
  doc.transact(() => writeFragment(doc, doc.getXmlFragment(BODY_FRAGMENT), body), origin)
}

function bodyOf(doc: Y.Doc): ProseMirrorNode {
  return readDocxModel(doc).body
}

/** Returns the body with `edit` applied to paragraph `index`'s text. */
function withParagraphText(body: ProseMirrorNode, index: number, text: string): ProseMirrorNode {
  const children: ProseMirrorNode[] = []
  body.forEach((child, _offset, position) => {
    children.push(position === index ? child.type.create(child.attrs, text ? schema.text(text) : null) : child)
  })
  return body.type.create(body.attrs, children)
}

async function fromBlank(): Promise<{ doc: Y.Doc; assets: MemoryAssetStore }> {
  const assets = new MemoryAssetStore()
  const doc = new Y.Doc()
  await docxCodec.createEmpty(doc, context(assets))
  return { doc, assets }
}

function documentXml(bytes: Uint8Array): string {
  return OoxmlPackage.read(bytes).text('word/document.xml')!
}

describe('docxCodec', () => {
  it('describes its formats', () => {
    expect(docxCodec.id).toBe('document')
    expect(docxCodec.extensions[0]).toBe('docx')
    expect(docxCodec.mimeType('docx')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    expect(docxCodec.mimeType('DOCM')).toBe('application/vnd.ms-word.document.macroEnabled.12')
  })

  it('creates a blank document that exports and reads back', async () => {
    const { doc, assets } = await fromBlank()
    expect(docxCodec.toText(doc)).toBe('\n')
    const bytes = await docxCodec.exportFile(doc, context(assets))
    const reread = new Y.Doc()
    await docxCodec.importFile(reread, bytes, context(assets))
    expect(bodyOf(reread).toJSON()).toEqual(bodyOf(doc).toJSON())
    // A blank export is the template, byte for byte.
    expect(OoxmlPackage.read(bytes).paths()).toEqual(OoxmlPackage.read(blankDocx()).paths())
  })

  it('refuses to import into a document that has content', async () => {
    const { doc, assets } = await fromBlank()
    await expect(docxCodec.importFile(doc, blankDocx(), context(assets))).rejects.toThrow(LiveFormatError)
  })

  it('writes edits as WordprocessingML in schema order', async () => {
    const { doc, assets } = await fromBlank()
    setBody(doc, schema.node('doc', null, [
      paragraph({ pStyle: 'Heading1' }, run('Title')),
      paragraph({ jc: packJml(['w:jc', { 'w:val': 'center' }]), spacing: packJml(['w:spacing', { 'w:after': '0' }]) }, run('Bold ', 'b'), run('and italic', 'b', 'i'), run('  spaced  ')),
      paragraph({}, schema.text('A', [schema.mark('del', { v: packJml(['w:del', { 'w:id': '9', 'w:author': 'Ana' }, '\u0000']) })])),
    ]))
    const bytes = await docxCodec.exportFile(doc, context(assets))
    const xml = documentXml(bytes)
    expect(xml).toContain('<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Title</w:t></w:r></w:p>')
    // spacing comes before jc in CT_PPr.
    expect(xml).toContain('<w:pPr><w:spacing w:after="0"/><w:jc w:val="center"/></w:pPr>')
    expect(xml).toContain('<w:r><w:rPr><w:b/><w:i/></w:rPr><w:t>and italic</w:t></w:r>')
    expect(xml).toContain('<w:t xml:space="preserve">  spaced  </w:t>')
    expect(xml).toContain('<w:del w:id="9" w:author="Ana"><w:r><w:delText>A</w:delText></w:r></w:del>')
    const reread = new Y.Doc()
    await docxCodec.importFile(reread, bytes, context(assets))
    expect(bodyOf(reread).toJSON()).toEqual(bodyOf(doc).toJSON())
    expect(docxCodec.toText(reread)).toBe('# Title\nBold and italic  spaced  \n\n')
  })

  it('exports to the content type of the target extension', async () => {
    const { doc, assets } = await fromBlank()
    const template = await docxCodec.exportFile(doc, context(assets, 'Letter.dotx'))
    expect(OoxmlPackage.read(template).contentType('word/document.xml')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml')
  })

  it('drops macros when a macro-enabled document is saved as .docx, and keeps them as .docm', async () => {
    const pkg = OoxmlPackage.read(blankDocx())
    pkg.set('word/vbaProject.bin', new Uint8Array([1, 2, 3]))
    pkg.addRelationship('word/document.xml', 'http://schemas.microsoft.com/office/2006/relationships/vbaProject', 'vbaProject.bin')
    pkg.setContentType('word/document.xml', 'application/vnd.ms-word.document.macroEnabled.main+xml')
    const assets = new MemoryAssetStore()
    const doc = new Y.Doc()
    await docxCodec.importFile(doc, pkg.write(), context(assets, 'Macro.docm'))
    const docm = OoxmlPackage.read(await docxCodec.exportFile(doc, context(assets, 'Macro.docm')))
    expect(docm.get('word/vbaProject.bin')).toEqual(new Uint8Array([1, 2, 3]))
    const docx = OoxmlPackage.read(await docxCodec.exportFile(doc, context(assets, 'Macro.docx')))
    expect(docx.has('word/vbaProject.bin')).toBe(false)
    expect(docx.relationships('word/document.xml').some((rel) => rel.type.endsWith('vbaProject'))).toBe(false)
  })

  it('keeps parts it does not model byte for byte through edits', async () => {
    const pkg = OoxmlPackage.read(blankDocx())
    pkg.set('customXml/item1.xml', strToU8('<root><x a="1"/></root>'))
    const assets = new MemoryAssetStore()
    const doc = new Y.Doc()
    await docxCodec.importFile(doc, pkg.write(), context(assets))
    setBody(doc, schema.node('doc', null, [paragraph({}, run('Changed'))]))
    const out = OoxmlPackage.read(await docxCodec.exportFile(doc, context(assets)))
    expect(out.text('customXml/item1.xml')).toBe('<root><x a="1"/></root>')
    expect(out.get('word/styles.xml')).toEqual(OoxmlPackage.read(blankDocx()).get('word/styles.xml'))
  })

  describe('applyFile', () => {
    async function threeParagraphs() {
      const { doc, assets } = await fromBlank()
      setBody(doc, schema.node('doc', null, [paragraph({}, run('One')), paragraph({}, run('Two')), paragraph({}, run('Three'))]))
      return { doc, assets }
    }

    it('reports no change for the same file', async () => {
      const { doc, assets } = await threeParagraphs()
      const bytes = await docxCodec.exportFile(doc, context(assets))
      expect(await docxCodec.applyFile(doc, bytes, context(assets), 'agent')).toEqual({ changed: false })
    })

    it('applies an agent edit as a minimal diff that merges with a concurrent user edit', async () => {
      const { doc: server, assets } = await threeParagraphs()
      // A user's replica, in sync, then edits the first paragraph without syncing yet.
      const user = new Y.Doc()
      Y.applyUpdate(user, Y.encodeStateAsUpdate(server))
      setBody(user, withParagraphText(bodyOf(user), 0, 'One, edited by the user'))

      // The agent pulled the file, changed the third paragraph, and pushed it.
      const agentDoc = new Y.Doc()
      Y.applyUpdate(agentDoc, Y.encodeStateAsUpdate(server))
      setBody(agentDoc, withParagraphText(bodyOf(agentDoc), 2, 'Three, edited by the agent'))
      const pushed = await docxCodec.exportFile(agentDoc, context(assets))
      const updates: Uint8Array[] = []
      server.on('update', (update: Uint8Array, origin: unknown) => { if (origin === 'agent') updates.push(update) })
      expect(await docxCodec.applyFile(server, pushed, context(assets), 'agent')).toEqual({ changed: true })
      expect(updates.length).toBe(1)

      Y.applyUpdate(server, Y.encodeStateAsUpdate(user))
      Y.applyUpdate(user, Y.encodeStateAsUpdate(server))
      const expected = ['One, edited by the user', 'Two', 'Three, edited by the agent']
      for (const doc of [server, user]) {
        const texts: string[] = []
        bodyOf(doc).forEach((child) => { texts.push(child.textContent) })
        expect(texts).toEqual(expected)
      }
      // The untouched paragraph kept its Y item, so nothing but the third changed.
      expect(docxCodec.toText(server)).toBe(expected.join('\n') + '\n')
    })

    it('applies style and comment changes from the file', async () => {
      const { doc, assets } = await threeParagraphs()
      const agentDoc = new Y.Doc()
      Y.applyUpdate(agentDoc, Y.encodeStateAsUpdate(doc))
      agentDoc.transact(() => {
        agentDoc.getMap<string>('styles').set('style:Agent', packJml(['w:style', { 'w:type': 'paragraph', 'w:styleId': 'Agent' }, ['w:name', { 'w:val': 'Agent' }]]))
        agentDoc.getMap<string>('comments').set('0', JSON.stringify({ author: 'Agent' }))
        agentDoc.getMap<string>('stories').set('comment:0', JSON.stringify({ kind: 'comment' }))
      })
      const pushed = await docxCodec.exportFile(agentDoc, context(assets))
      await docxCodec.applyFile(doc, pushed, context(assets), 'agent')
      expect(doc.getMap<string>('styles').get('style:Agent')).toContain('"Agent"')
      expect(JSON.parse(doc.getMap<string>('comments').get('0')!)).toMatchObject({ author: 'Agent' })
    })
  })

  it('exports the same document to the same bytes at any time, so versions only change with content', async () => {
    const doc = new Y.Doc()
    const assets = new MemoryAssetStore()
    await docxCodec.importFile(doc, blankDocx(), { name: 'a.docx', assets })
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-01-01T10:00:00Z'))
      const first = await docxCodec.exportFile(doc, { name: 'a.docx', assets })
      vi.setSystemTime(new Date('2026-01-01T10:00:09Z'))
      const second = await docxCodec.exportFile(doc, { name: 'a.docx', assets })
      expect(Buffer.from(second).equals(Buffer.from(first))).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the ids of comments made in Pulpo when a pushed file comes back, whatever order replicas got them in', async () => {
    const assets = new MemoryAssetStore()
    const context = { name: 'a.docx', assets }
    const base = new Y.Doc()
    await docxCodec.createEmpty(base, context)
    const comment = (doc: Y.Doc, id: string, text: string, parentId?: string) => doc.transact(() => {
      doc.getMap('comments').set(id, JSON.stringify({ author: 'Ada', ...(parentId ? { parentId } : {}) }))
      doc.getMap('stories').set(`comment:${id}`, JSON.stringify({ kind: 'comment' }))
      writeFragment(doc, doc.getXmlFragment(`story:comment:${id}`), schema.node('doc', null, [schema.node('paragraph', null, schema.text(text))]))
    })
    const replica = (clientID: number) => {
      const doc = new Y.Doc()
      doc.clientID = clientID
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(base))
      return doc
    }
    const a = replica(100)
    const b = replica(5)
    comment(a, 'nzzz1', 'From A')
    comment(b, 'naaa2', 'From B', 'nzzz1')
    const merged = (first: Y.Doc, second: Y.Doc) => {
      const doc = new Y.Doc()
      for (const source of [base, first, second]) Y.applyUpdate(doc, Y.encodeStateAsUpdate(source))
      return doc
    }
    const one = merged(a, b)
    const two = merged(b, a)
    expect(Buffer.from(await docxCodec.exportFile(one, context)).equals(Buffer.from(await docxCodec.exportFile(two, context)))).toBe(true)

    await docxCodec.applyFile(one, await docxCodec.exportFile(one, context), context, 'agent')
    const comments = [...one.getMap('stories').keys()].filter((id) => id.startsWith('comment:')).sort()
    expect(comments).toEqual(['comment:naaa2', 'comment:nzzz1'])
    expect(JSON.parse(one.getMap<string>('comments').get('naaa2')!).parentId).toBe('nzzz1')
    expect(one.getXmlFragment('story:comment:nzzz1').toString()).toContain('From A')
    expect((await docxCodec.applyFile(one, await docxCodec.exportFile(one, context), context, 'agent')).changed).toBe(false)
  })

  it('keeps comment ranges on their comments after a push, when later edits renumber them', async () => {
    const assets = new MemoryAssetStore()
    const context = { name: 'a.docx', assets }
    const doc = new Y.Doc()
    await docxCodec.createEmpty(doc, context)
    const words: Record<string, string> = { nAAA: 'alpha', nBBB: 'beta', nCCC: 'gamma' }
    doc.transact(() => {
      for (const [id, word] of Object.entries(words)) {
        doc.getMap('comments').set(id, JSON.stringify({ author: 'Ada' }))
        doc.getMap('stories').set(`comment:${id}`, JSON.stringify({ kind: 'comment' }))
        writeFragment(doc, doc.getXmlFragment(`story:comment:${id}`), schema.node('doc', null, [schema.node('paragraph', null, schema.text(`about ${word}`))]))
      }
      writeFragment(doc, doc.getXmlFragment(BODY_FRAGMENT), schema.node('doc', null, Object.entries(words).map(([id, word]) => schema.node('paragraph', null, [
        schema.node('commentMark', { edge: 'start', id }), schema.text(word), schema.node('commentMark', { edge: 'end', id }),
      ]))))
    })
    // An agent pushes the file back with a line added.
    const agent = new Y.Doc()
    await docxCodec.importFile(agent, await docxCodec.exportFile(doc, context), context)
    const body = readDocxModel(agent).body
    agent.transact(() => writeFragment(agent, agent.getXmlFragment(BODY_FRAGMENT), body.copy(body.content.addToEnd(schema.node('paragraph', null, schema.text('agent line'))))))
    await docxCodec.applyFile(doc, await docxCodec.exportFile(agent, context), context, 'agent')
    // The user deletes the first comment; the others are numbered again from 0.
    doc.transact(() => {
      doc.getMap('comments').delete('nAAA')
      doc.getMap('stories').delete('comment:nAAA')
      const current = readDocxModel(doc).body
      const paragraphs: ProseMirrorNode[] = []
      current.forEach((paragraph) => {
        const inline: ProseMirrorNode[] = []
        paragraph.forEach((child) => { if (!(child.type.name === 'commentMark' && child.attrs.id === 'nAAA')) inline.push(child) })
        paragraphs.push(paragraph.copy(Fragment.fromArray(inline)))
      })
      writeFragment(doc, doc.getXmlFragment(BODY_FRAGMENT), current.copy(Fragment.fromArray(paragraphs)))
    })
    const files = unzipSync(await docxCodec.exportFile(doc, context))
    const xml = strFromU8(files['word/document.xml']!)
    const comments = strFromU8(files['word/comments.xml']!)
    const anchored = (word: string) => new RegExp(`<w:commentRangeStart w:id="(\\d+)"/><w:r><w:t>${word}</w:t>`).exec(xml)?.[1]
    expect(comments).toMatch(new RegExp(`<w:comment w:id="${anchored('beta')}"[^>]*>.*about beta`))
    expect(comments).toMatch(new RegExp(`<w:comment w:id="${anchored('gamma')}"[^>]*>.*about gamma`))
  })

  it('keeps comment ids through a second proposal made from the agent own earlier file', async () => {
    const assets = new MemoryAssetStore()
    const context = { name: 'a.docx', assets }
    const doc = new Y.Doc()
    await docxCodec.createEmpty(doc, context)
    doc.transact(() => {
      for (const [id, text] of [['nAAA', 'first comment'], ['nBBB', 'second comment']]) {
        doc.getMap('comments').set(id!, JSON.stringify({ author: 'Ada', date: id === 'nAAA' ? '2026-11-01T00:00:00Z' : '2026-11-02T00:00:00Z' }))
        doc.getMap('stories').set(`comment:${id}`, JSON.stringify({ kind: 'comment' }))
        writeFragment(doc, doc.getXmlFragment(`story:comment:${id}`), schema.node('doc', null, [schema.node('paragraph', null, schema.text(text!))]))
      }
    })
    // The agent's first file adds a comment (numbered 2 in its file); its second edits comment 0.
    const first = new Y.Doc()
    await docxCodec.importFile(first, await docxCodec.exportFile(doc, context), context)
    first.transact(() => {
      first.getMap('comments').set('2', JSON.stringify({ author: 'Agent' }))
      first.getMap('stories').set('comment:2', JSON.stringify({ kind: 'comment' }))
      writeFragment(first, first.getXmlFragment('story:comment:2'), schema.node('doc', null, [schema.node('paragraph', null, schema.text('agent comment'))]))
    })
    const firstBytes = await docxCodec.exportFile(first, context)
    const fork = new Y.Doc()
    Y.applyUpdate(fork, Y.encodeStateAsUpdate(doc))
    await docxCodec.applyFile(fork, firstBytes, context, 'agent')
    const second = new Y.Doc()
    await docxCodec.importFile(second, firstBytes, context)
    second.transact(() => writeFragment(second, second.getXmlFragment('story:comment:0'), schema.node('doc', null, [schema.node('paragraph', null, schema.text('first comment, edited'))])))
    await docxCodec.applyFile(fork, await docxCodec.exportFile(second, context), context, 'agent')
    const stories = [...fork.getMap('stories').keys()].filter((id) => id.startsWith('comment:')).sort()
    expect(stories).toEqual(['comment:2', 'comment:nAAA', 'comment:nBBB'])
    expect(fork.getXmlFragment('story:comment:nAAA').toString()).toContain('first comment, edited')
  })

  it.each([['comment', '3'], ['comment', '0'], ['footnote', '3']] as const)('does not give a replacement %s %s the deleted story identity', async (kind, newId) => {
    const { doc, assets } = await fromBlank()
    const ctx = context(assets)
    const story = (text: string) => schema.node('doc', null, [paragraph({}, run(text))])
    const model = readDocxModel(doc)
    model.stories.set(`${kind}:nOLD`, { meta: { kind }, doc: story('Original story') })
    if (kind === 'comment') model.maps.comments.set('nOLD', JSON.stringify({ author: 'Ada' }))
    else model.body = schema.node('doc', null, [paragraph({}, schema.node('noteRef', { kind, id: 'nOLD' }))])
    doc.transact(() => writeDocxModel(doc, model))
    const proposal = new Y.Doc()
    await docxCodec.importFile(proposal, await docxCodec.exportFile(doc, ctx), ctx)
    const changed = readDocxModel(proposal)
    const oldId = kind === 'comment' ? '0' : '1'
    changed.stories.delete(`${kind}:${oldId}`)
    changed.stories.set(`${kind}:${newId}`, { meta: { kind }, doc: story('Unrelated new story') })
    if (kind === 'comment') {
      changed.maps.comments.delete(oldId)
      changed.maps.comments.set(newId, JSON.stringify({ author: 'Agent' }))
    } else changed.body = schema.node('doc', null, [paragraph({}, schema.node('noteRef', { kind, id: newId }))])
    proposal.transact(() => writeDocxModel(proposal, changed))
    const collaborator = new Y.Doc()
    Y.applyUpdate(collaborator, Y.encodeStateAsUpdate(doc))
    collaborator.transact(() => writeFragment(collaborator, collaborator.getXmlFragment(`story:${kind}:nOLD`), story('Original story collaborator edit')))
    await docxCodec.applyFile(doc, await docxCodec.exportFile(proposal, ctx), ctx, 'agent')
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(collaborator))
    const result = readDocxModel(doc)
    expect(result.stories.has(`${kind}:nOLD`)).toBe(false)
    expect(result.stories.get(`${kind}:${newId}`)?.doc.textContent).toBe('Unrelated new story')
  })

  it('numbers a first footnote above the reserved separator ids', async () => {
    const { readFile } = await import('node:fs/promises')
    const { addNote } = await import('./view/stories.js')
    const { DocxViewContext } = await import('./view/context.js')
    const { EditorState } = await import('@tiptap/pm/state')
    const assets = new MemoryAssetStore()
    const ctx = context(assets)
    const doc = new Y.Doc()
    await docxCodec.importFile(doc, await readFile(new URL('../../../fixtures/docx/basic-formatting.docx', import.meta.url)), ctx)
    const viewContext = new DocxViewContext(doc)
    try {
      const result = addNote(EditorState.create({ schema, doc: readDocxModel(doc).body }), viewContext, 'footnote', 'First note')
      doc.transact(() => {
        writeFragment(doc, doc.getXmlFragment(BODY_FRAGMENT), result.tr!.doc)
        for (const story of result.stories) {
          doc.getMap('stories').set(story.id, JSON.stringify(story.meta))
          writeFragment(doc, doc.getXmlFragment(`story:${story.id}`), story.doc!)
        }
      })
      const pkg = OoxmlPackage.read(await docxCodec.exportFile(doc, ctx))
      const ids = [...pkg.text('word/footnotes.xml')!.matchAll(/<w:footnote\b[^>]*w:id="(-?\d+)"/g)].map((match) => match[1]!)
      expect(new Set(ids).size).toBe(ids.length)
      const reference = /<w:footnoteReference w:id="(\d+)"/.exec(pkg.text('word/document.xml')!)![1]!
      expect(Number(reference)).toBeGreaterThanOrEqual(1)
      expect(ids).toContain(reference)
    } finally {
      viewContext.destroy()
    }
  })

  describe('hostile files', () => {
    const fail = async (bytes: Uint8Array, code?: string) => {
      const started = Date.now()
      const error = await docxCodec.importFile(new Y.Doc(), bytes, context()).then(() => undefined, (caught: unknown) => caught)
      expect(error).toBeInstanceOf(LiveFormatError)
      if (code) expect((error as LiveFormatError).code).toBe(code)
      expect(Date.now() - started).toBeLessThan(5_000)
    }

    const withDocument = (xml: string) => {
      const pkg = OoxmlPackage.read(blankDocx())
      pkg.set('word/document.xml', strToU8(xml))
      return pkg.write()
    }

    it('refuses random bytes, other packages, and encrypted files', async () => {
      await fail(strToU8('not a document'), 'corrupt')
      await fail(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]), 'encrypted')
      const sheet = OoxmlPackage.read(blankDocx())
      sheet.setContentType('word/document.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml')
      await fail(sheet.write(), 'corrupt')
    })

    it('refuses deep nesting, DTDs, strict documents, and malformed XML', async () => {
      const deep = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p>' + '<w:hyperlink>'.repeat(5_000) + '</w:hyperlink>'.repeat(5_000) + '</w:p></w:body></w:document>'
      await fail(withDocument(deep), 'corrupt')
      await fail(withDocument('<!DOCTYPE a [<!ENTITY x "x">]><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>'), 'corrupt')
      await fail(withDocument('<w:document xmlns:w="http://purl.oclc.org/ooxml/wordprocessingml/main"><w:body/></w:document>'), 'unsupported')
      await fail(withDocument('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p>'), 'corrupt')
    })

    it('refuses deeply nested tables', async () => {
      const nested = '<w:tbl><w:tr><w:tc>'.repeat(60) + '<w:p/>' + '</w:tc></w:tr></w:tbl>'.repeat(60)
      await fail(withDocument(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${nested}</w:body></w:document>`), 'corrupt')
    })

    it('refuses absurd table widths', async () => {
      const wide = '<w:tbl><w:tr><w:tc><w:tcPr><w:gridSpan w:val="999999999"/></w:tcPr><w:p/></w:tc><w:tc><w:tcPr><w:gridSpan w:val="999999"/></w:tcPr><w:p/></w:tc></w:tr></w:tbl>'
      await fail(withDocument(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${wide}</w:body></w:document>`), 'too_large')
    })

    it('refuses tables made wide by skipped grid columns or grid definitions', async () => {
      const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
      // Rows without cells used to skip the column check, and every editor allocated the width per row.
      const skipped = '<w:tbl>' + '<w:tr><w:trPr><w:gridBefore w:val="2000000"/></w:trPr></w:tr>'.repeat(51) + '</w:tbl>'
      await fail(withDocument(`<w:document ${W}><w:body>${skipped}</w:body></w:document>`), 'too_large')
      const after = '<w:tbl><w:tr><w:trPr><w:gridAfter w:val="20000000"/></w:trPr><w:tc><w:p/></w:tc></w:tr></w:tbl>'
      await fail(withDocument(`<w:document ${W}><w:body>${after}</w:body></w:document>`), 'too_large')
      const grid = `<w:tbl><w:tblGrid>${'<w:gridCol/>'.repeat(1_001)}</w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>`
      await fail(withDocument(`<w:document ${W}><w:body>${grid}</w:body></w:document>`), 'too_large')
      // 1,000 columns are fine, but not on 1,000 rows.
      const tall = `<w:tbl><w:tblGrid>${'<w:gridCol/>'.repeat(1_000)}</w:tblGrid>${'<w:tr><w:tc><w:p/></w:tc></w:tr>'.repeat(1_000)}</w:tbl>`
      await fail(withDocument(`<w:document ${W}><w:body>${tall}</w:body></w:document>`), 'too_large')
    })

    it('refuses zip bombs before inflating them', async () => {
      // One entry claiming 2 GB uncompressed; the size limit rejects it from the directory alone.
      const zip = zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'big.bin': new Uint8Array(1024) })
      const view = new DataView(zip.buffer)
      for (let offset = 0; offset < zip.length - 4; offset++) {
        if (view.getUint32(offset, true) === 0x02014b50 && new TextDecoder().decode(zip.subarray(offset + 46, offset + 53)) === 'big.bin') view.setUint32(offset + 24, 0x7fffffff, true)
      }
      await fail(zip, 'too_large')
    })

    it('survives fuzzed bytes of a real document', async () => {
      const original = blankDocx()
      let seed = 7
      const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
      for (let round = 0; round < 60; round++) {
        const bytes = original.slice()
        for (let flip = 0; flip < 1 + round; flip++) bytes[Math.floor(random() * bytes.length)] = Math.floor(random() * 256)
        const doc = new Y.Doc()
        try {
          await docxCodec.importFile(doc, bytes, context())
        } catch (error) {
          expect(error).toBeInstanceOf(LiveFormatError)
        }
      }
    })
  })
})
