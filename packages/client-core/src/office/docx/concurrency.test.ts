// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EditorState, TextSelection, type Transaction } from '@tiptap/pm/state'
import { EditorView } from '@tiptap/pm/view'
import { ySyncPlugin, ySyncPluginKey } from '@tiptap/y-tiptap'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { docxCodec } from './codec.js'
import { packJml } from './jsonml.js'
import { MemoryAssetStore } from './memory-assets.js'
import { BODY_FRAGMENT, readDocxModel } from './model.js'
import { docxSchema } from './schema.js'

/**
 * Three people editing one document at once through the real Yjs binding, syncing in random
 * order and sometimes offline: every replica must end identical, and export a file that opens.
 */

const schema = docxSchema()

function seeded(seed: number) {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 2 ** 32
    return state / 2 ** 32
  }
}

interface Client {
  doc: Y.Doc
  view: EditorView
  pending: Uint8Array[]
}

function textblockPositions(state: EditorState): { from: number; to: number }[] {
  const blocks: { from: number; to: number }[] = []
  state.doc.descendants((node, pos) => {
    if (node.type.name === 'paragraph') {
      blocks.push({ from: pos + 1, to: pos + 1 + node.content.size })
      return false
    }
    return true
  })
  return blocks
}

function randomEdit(view: EditorView, random: () => number, label: string): void {
  const { state } = view
  const blocks = textblockPositions(state)
  if (!blocks.length) return
  const block = blocks[Math.floor(random() * blocks.length)]!
  const at = block.from + Math.floor(random() * (block.to - block.from + 1))
  let tr: Transaction
  const choice = random()
  try {
    if (choice < 0.35) tr = state.tr.insertText(`${label}${Math.floor(random() * 100)} `, at)
    else if (choice < 0.5 && block.to > block.from) {
      const end = Math.min(block.to, at + 1 + Math.floor(random() * 6))
      tr = state.tr.delete(Math.min(at, end - 1), end)
    } else if (choice < 0.6) tr = state.tr.split(at)
    else if (choice < 0.75 && block.to > block.from) {
      const end = Math.min(block.to, at + 1 + Math.floor(random() * 8))
      const mark = random() < 0.5 ? schema.mark('b', { v: packJml(['w:b', {}]) }) : schema.mark('color', { v: packJml(['w:color', { 'w:val': 'FF0000' }]) })
      tr = state.tr.addMark(Math.min(at, end - 1), end, mark)
    } else if (choice < 0.85) {
      const $pos = state.doc.resolve(block.from)
      tr = state.tr.setNodeMarkup($pos.before(), undefined, { ...$pos.parent.attrs, jc: packJml(['w:jc', { 'w:val': random() < 0.5 ? 'center' : 'right' }]) })
    } else if (choice < 0.92) {
      // Join with the previous paragraph, as Backspace at a paragraph's start does.
      const $pos = state.doc.resolve(block.from)
      const before = $pos.before()
      const previous = state.doc.resolve(before).nodeBefore
      if (previous?.type.name !== 'paragraph') return
      tr = state.tr.join(before)
    } else {
      tr = state.tr.insert(at, schema.node('tab', { v: packJml(['w:tab', {}]) }))
    }
  } catch {
    return
  }
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(at, tr.doc.content.size))))
  view.dispatch(tr)
}

async function run(fixture: string | undefined, seed: number, steps: number) {
  const random = seeded(seed)
  const assets = new MemoryAssetStore()
  const origin = new Y.Doc()
  if (fixture) await docxCodec.importFile(origin, new Uint8Array(readFileSync(join(process.cwd(), 'fixtures/docx', fixture))), { name: fixture, assets })
  else await docxCodec.createEmpty(origin, { name: 'a.docx', assets })
  const clients: Client[] = []
  for (let index = 0; index < 3; index++) {
    const doc = new Y.Doc()
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(origin))
    const view = new EditorView(document.createElement('div'), {
      state: EditorState.create({ schema, plugins: [ySyncPlugin(doc.getXmlFragment(BODY_FRAGMENT))] }),
    })
    const client: Client = { doc, view, pending: [] }
    doc.on('update', (update: Uint8Array, updateOrigin: unknown) => {
      if (updateOrigin === 'remote') return
      for (const other of clients) if (other !== client) other.pending.push(update)
    })
    clients.push(client)
  }
  // Let the binding render the initial content.
  await new Promise((resolve) => setTimeout(resolve, 0))
  for (let step = 0; step < steps; step++) {
    const client = clients[Math.floor(random() * clients.length)]!
    randomEdit(client.view, random, `c${clients.indexOf(client)}`)
    // Sometimes deliver what is pending, in shuffled order (latency, reconnects).
    for (const target of clients) {
      if (random() < 0.3 && target.pending.length) {
        const updates = target.pending.splice(0).sort(() => random() - 0.5)
        for (const update of updates) Y.applyUpdate(target.doc, update, 'remote')
      }
    }
  }
  for (const target of clients) for (const update of target.pending.splice(0)) Y.applyUpdate(target.doc, update, 'remote')
  await new Promise((resolve) => setTimeout(resolve, 0))
  const states = clients.map((client) => JSON.stringify(readDocxModel(client.doc).body.toJSON()))
  expect(new Set(states).size).toBe(1)
  // Editors show what the Y.Doc holds.
  for (const client of clients) expect(JSON.stringify(client.view.state.doc.toJSON())).toBe(states[0])
  for (const client of clients) expect(ySyncPluginKey.getState(client.view.state)).toBeTruthy()
  // The merged document exports a file that reads back as the same document.
  const bytes = await docxCodec.exportFile(clients[0]!.doc, { name: 'a.docx', assets })
  const reread = new Y.Doc()
  await docxCodec.importFile(reread, bytes, { name: 'a.docx', assets })
  expect(docxCodec.toText(reread)).toBe(docxCodec.toText(clients[0]!.doc))
  for (const client of clients) client.view.destroy()
}

describe('concurrent editing', () => {
  it('converges from a blank document', { timeout: 60_000 }, () => run(undefined, 1, 300))
  it('converges on lists and formatting', { timeout: 60_000 }, () => run('lists.docx', 2, 300))
  it('converges on tables, sections, and tracked changes', { timeout: 60_000 }, async () => {
    await run('tables.docx', 3, 250)
    await run('review.docx', 4, 250)
    await run('sections-headers.docx', 5, 250)
  })
})
