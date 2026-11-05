import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BODY_FRAGMENT, diffDocxDocs, docxCodec, docxSchema, MemoryAssetStore, packJml, readDocxModel, writeFragment, type DocxDiff } from '@pulpo/client-core/office/docx'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { DocxEditor } from '@pulpo/client-core/office/docx/view'
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness'
import * as Y from 'yjs'
import '../../src/index.css'
import '../../src/i18n'
import { DocxDiffView } from '../../src/features/files/live/docx/DocxDiffView'
import { DocxEditorView } from '../../src/features/files/live/docx/DocxEditorView'

/** An agent-style revision of the document for the diff view: reworded, trimmed, extended, bolded. */
function revised(doc: Y.Doc): Y.Doc {
  const copy = new Y.Doc()
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc))
  const schema = docxSchema()
  const body = readDocxModel(copy).body
  const children: ProseMirrorNode[] = []
  body.forEach((node, _offset, index) => {
    if (node.type.name !== 'paragraph' || !node.textContent) return children.push(node)
    if (index === 2) return
    if (index === 1) return children.push(node.type.create(node.attrs, schema.text(node.textContent.replace(/\b(\w+)$/, 'revised $1'))))
    if (index === 4) children.push(node.type.create(node.attrs, schema.text(node.textContent, [schema.mark('b', { v: packJml(['w:b', {}]) })])))
    else children.push(node)
    if (index === 3) children.push(schema.node('paragraph', null, schema.text('A paragraph the agent added.')))
  })
  copy.transact(() => writeFragment(copy, copy.getXmlFragment(BODY_FRAGMENT), body.type.create(null, children)))
  return copy
}

export function DiffHarness({ doc }: { doc: Y.Doc }) {
  const [diff] = useState<DocxDiff>(() => diffDocxDocs(doc, revised(doc)))
  useEffect(() => { window.harness = { editors: [], docs: [doc], exportFile: async () => '', text: () => '', model: () => diff, ready: true } }, [doc, diff])
  return <div className="mx-auto max-w-3xl p-6"><DocxDiffView diff={diff} /></div>
}

/**
 * A dev-only page for the Word editor: loads a fixture into a Y.Doc and syncs it with a second
 * collaborator through an in-memory relay. `?file=<fixture>` picks the file (blank otherwise),
 * `?view=split` shows both collaborators, `?dark=1` the dark theme, `?layout=web` the web
 * layout. Tests drive it through `window.harness`.
 */

const fixtures = import.meta.glob('../../../../packages/client-core/fixtures/docx/**/*.docx', { query: '?url', import: 'default' }) as Record<string, () => Promise<string>>

const params = new URLSearchParams(location.search)
if (params.get('dark') === '1') document.documentElement.classList.add('dark')
const assets = new MemoryAssetStore()

interface Peer {
  doc: Y.Doc
  awareness: Awareness
  user: { name: string; color: string }
}

function connect(a: Peer, b: Peer, latency: number) {
  const send = (target: Peer, update: Uint8Array, apply: (doc: Peer, update: Uint8Array) => void) => {
    if (latency) setTimeout(() => apply(target, update), latency)
    else apply(target, update)
  }
  for (const [from, to] of [[a, b], [b, a]] as const) {
    from.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin !== 'relay') send(to, update, (peer, data) => Y.applyUpdate(peer.doc, data, 'relay'))
    })
    from.awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      if (origin === 'relay') return
      const changed = [...added, ...updated, ...removed]
      send(to, encodeAwarenessUpdate(from.awareness, changed), (peer, data) => applyAwarenessUpdate(peer.awareness, data, 'relay'))
    })
  }
}

function peer(name: string, color: string): Peer {
  const doc = new Y.Doc()
  return { doc, awareness: new Awareness(doc), user: { name, color } }
}

async function load(): Promise<{ peers: [Peer, Peer]; name: string }> {
  const name = params.get('file') ?? ''
  const ada = peer('Ada', '#1a73e8')
  const grace = peer('Grace', '#d93025')
  const loader = Object.entries(fixtures).find(([path]) => path.endsWith(`/${name}`))?.[1]
  if (loader) {
    const bytes = new Uint8Array(await (await fetch(await loader())).arrayBuffer())
    await docxCodec.importFile(ada.doc, bytes, { name, assets })
  } else {
    await docxCodec.createEmpty(ada.doc, { name: 'Document.docx', assets })
    // `?generate=N` fills the document with N paragraphs (headings every 20) for performance runs.
    const count = Number(params.get('generate') ?? 0)
    if (count > 0) {
      const schema = docxSchema()
      const sentence = 'The quick brown fox jumps over the lazy dog while the editor lays out pages and keeps every paragraph in place. '
      const blocks = Array.from({ length: count }, (_, index) => index % 20 === 0
        ? schema.node('paragraph', { pStyle: 'Heading1' }, schema.text(`Section ${index / 20 + 1}`))
        : schema.node('paragraph', null, schema.text(`${index}. ${sentence.repeat(1 + (index % 3))}`)))
      ada.doc.transact(() => writeFragment(ada.doc, ada.doc.getXmlFragment(BODY_FRAGMENT), schema.node('doc', null, blocks)))
    }
  }
  Y.applyUpdate(grace.doc, Y.encodeStateAsUpdate(ada.doc), 'relay')
  connect(ada, grace, Number(params.get('latency') ?? 0))
  return { peers: [ada, grace], name: name || 'Document.docx' }
}

declare global {
  interface Window {
    harness?: {
      editors: (DocxEditor | null)[]
      docs: Y.Doc[]
      exportFile: (index?: number) => Promise<string>
      text: (index?: number) => string
      model: (index?: number) => unknown
      ready: boolean
    }
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return btoa(binary)
}

export function Harness() {
  const [loaded, setLoaded] = useState<{ peers: [Peer, Peer]; name: string } | null>(null)
  const [editors, setEditors] = useState<(DocxEditor | null)[]>([null, null])
  useEffect(() => { void load().then(setLoaded) }, [])
  useEffect(() => {
    if (!loaded) return
    window.harness = {
      editors,
      docs: loaded.peers.map((entry) => entry.doc),
      exportFile: async (index = 0) => toBase64(await docxCodec.exportFile(loaded.peers[index]!.doc, { name: loaded.name, assets })),
      text: (index = 0) => docxCodec.toText(loaded.peers[index]!.doc),
      model: (index = 0) => readDocxModel(loaded.peers[index]!.doc).body.toJSON(),
      ready: Boolean(editors[0]),
    }
  }, [loaded, editors])
  if (!loaded) return null
  if (params.get('view') === 'diff') return <DiffHarness doc={loaded.peers[0].doc} />
  const split = params.get('view') === 'split'
  const layout = params.get('layout') === 'web' ? 'web' : 'print'
  const shown = split ? loaded.peers : [loaded.peers[0]]
  return (
    <div className={split ? 'grid h-screen grid-cols-2 divide-x' : 'h-screen'}>
      {shown.map((entry, index) => (
        <DocxEditorView
          key={entry.user.name}
          doc={entry.doc}
          awareness={entry.awareness}
          assets={assets}
          user={entry.user}
          layout={layout}
          readOnly={params.get('readonly') === '1'}
          onEditor={(editor) => setEditors((current) => current[index] === editor ? current : Object.assign([...current], { [index]: editor }))}
        />
      ))}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>)
