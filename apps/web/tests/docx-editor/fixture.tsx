import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { docxCodec, MemoryAssetStore, readDocxModel } from '@pulpo/client-core/office/docx'
import type { DocxEditor } from '@pulpo/client-core/office/docx/view'
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness'
import * as Y from 'yjs'
import '../../src/index.css'
import '../../src/i18n'
import { DocxEditorView } from '../../src/features/files/live/docx/DocxEditorView'

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

function Harness() {
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
