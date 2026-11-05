// Dev-only harness for the presentation editor (not a production route): a fixture deck in two
// Y.Docs kept in sync in memory, standing in for two collaborators. Playwright drives it through
// the page and through `window.harness`.
//
// Query parameters: deck=<path under packages/client-core/fixtures/presentation> (or blank=1),
// split=1 (both collaborators side by side), view=diff, theme=dark, lang=es, readonly=1.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Y from 'yjs'
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness'
import type { LiveAssetStore } from '@pulpo/client-core/office'
import { blankPresentation, presentationCodec, presentationCommands } from '@pulpo/client-core/office/presentation'
import { printSlides, type PresentationController } from '@pulpo/client-core/office/presentation/view'
import '../../src/index.css'
import i18n from '../../src/i18n'
import { HarnessApp } from './HarnessApp'

const params = new URLSearchParams(location.search)
if (params.get('theme') === 'dark') document.documentElement.classList.add('dark')
if (params.get('lang') === 'es') await i18n.changeLanguage('es-ES')

const fixtures = import.meta.glob('../../../../packages/client-core/fixtures/presentation/**/*.{pptx,potx,ppsx,pptm}', { query: '?url', import: 'default' })

function memoryAssets(): LiveAssetStore {
  const store = new Map<string, Uint8Array>()
  return {
    async put(bytes, mimeType) {
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>))
      const hash = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
      store.set(hash, bytes)
      return { hash, mimeType, sizeBytes: bytes.byteLength }
    },
    async get(hash) {
      const bytes = store.get(hash)
      if (!bytes) throw new Error(`Missing asset ${hash}`)
      return bytes
    },
  }
}

async function loadDeck(): Promise<{ bytes: Uint8Array; name: string }> {
  if (params.get('blank') === '1') return { bytes: blankPresentation(), name: 'Blank.pptx' }
  const deck = params.get('deck') ?? 'generated/text-formatting.pptx'
  const loader = Object.entries(fixtures).find(([path]) => path.endsWith(`/fixtures/presentation/${deck}`))?.[1]
  if (!loader) throw new Error(`Unknown fixture ${deck}`)
  const url = (await loader()) as string
  return { bytes: new Uint8Array(await (await fetch(url)).arrayBuffer()), name: deck.split('/').pop()! }
}

const assets = memoryAssets()
const { bytes, name } = await loadDeck()
const original = new Y.Doc()
await presentationCodec.importFile(original, bytes, { name, assets })
// big=N grows the deck to N slides by duplicating its slides, for performance checks.
const big = Number(params.get('big') ?? 0)
if (big > 0) {
  const keys = presentationCommands.slideKeys(original)
  const copies = []
  for (let index = keys.length; index < big; index++) {
    const slide = presentationCommands.readSlide(original, keys[index % keys.length]!)
    if (slide) copies.push(presentationCommands.cloneSlide(slide))
  }
  presentationCommands.insertSlides(original, copies, keys.length)
}
const docA = new Y.Doc()
const docB = new Y.Doc()
Y.applyUpdate(docA, Y.encodeStateAsUpdate(original))
Y.applyUpdate(docB, Y.encodeStateAsUpdate(original))
const awarenessA = new Awareness(docA)
const awarenessB = new Awareness(docB)

// The "network": updates flow between the two documents while online, and queue while offline.
let online = true
const queued: { to: Y.Doc; update: Uint8Array }[] = []
const relay = (from: Y.Doc, to: Y.Doc) =>
  from.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === 'relay') return
    if (online) Y.applyUpdate(to, update, 'relay')
    else queued.push({ to, update })
  })
relay(docA, docB)
relay(docB, docA)
const relayAwareness = (from: Awareness, to: Awareness) =>
  from.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin === 'relay') return
    applyAwarenessUpdate(to, encodeAwarenessUpdate(from, [...added, ...updated, ...removed]), 'relay')
  })
relayAwareness(awarenessA, awarenessB)
relayAwareness(awarenessB, awarenessA)

const controllers: { a?: PresentationController; b?: PresentationController } = {}
const toBase64 = (data: Uint8Array) => btoa(Array.from(data, (byte) => String.fromCharCode(byte)).join(''))

Object.assign(window, {
  harness: {
    docA,
    docB,
    assets,
    controllers,
    commands: presentationCommands,
    codec: presentationCodec,
    printSlides,
    setOnline(value: boolean) {
      online = value
      if (value) for (const { to, update } of queued.splice(0)) Y.applyUpdate(to, update, 'relay')
    },
    async exportFile(which: 'a' | 'b' = 'a', fileName = name) {
      return toBase64(await presentationCodec.exportFile(which === 'a' ? docA : docB, { name: fileName, assets }))
    },
    async applyFile(base64: string) {
      const data = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      return presentationCodec.applyFile(docA, data, { name, assets }, 'agent')
    },
    text: (which: 'a' | 'b' = 'a') => presentationCodec.toText(which === 'a' ? docA : docB),
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HarnessApp name={name} original={original} docA={docA} docB={docB} awarenessA={awarenessA} awarenessB={awarenessB} assets={assets} controllers={controllers} params={params} />
  </StrictMode>,
)
