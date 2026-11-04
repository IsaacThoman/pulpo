// Dev-only harness for the spreadsheet editor: loads a workbook into a local Y.Doc shared by two
// simulated collaborators (synced in the page, optionally with latency), for Playwright and manual
// testing. Query parameters: file (URL of an xlsx/csv), name, split=1, dark=1, readonly=1, lang=es,
// latency=<ms>.
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import * as Y from 'yjs'
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness'
import { MemoryAssetStore } from '@pulpo/client-core/office'
import { SheetCodec } from '@pulpo/client-core/office/sheets'
import type { SheetView } from '@pulpo/client-core/office/sheets/view'
import '../../src/index.css'
import i18n from '../../src/i18n'
import { SheetEditor } from '../../src/features/files/live/sheets/SheetEditor'
import demoUrl from './fixtures/demo.xlsx?url'

const params = new URLSearchParams(location.search)
const fileUrl = params.get('file') ?? demoUrl
const fileName = params.get('name') ?? (params.get('file') ? decodeURIComponent(fileUrl.split('/').pop()!.split('?')[0]!) : 'Budget.xlsx')
const split = params.get('split') === '1'
const latency = Number(params.get('latency') ?? 0)
if (params.get('dark') === '1') document.documentElement.classList.add('dark')
if (params.get('lang') === 'es') void i18n.changeLanguage('es-ES')

const codec = new SheetCodec()
const assets = new MemoryAssetStore()
const docs = [new Y.Doc(), new Y.Doc()]
const awareness = docs.map((doc) => new Awareness(doc))
const views: (SheetView | undefined)[] = [undefined, undefined]

/** Relays document and presence updates between the two replicas, like the document socket. */
function connect(): void {
  const send = (run: () => void) => (latency ? setTimeout(run, latency) : run())
  docs.forEach((doc, index) => {
    const other = docs[1 - index]!
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === 'remote') return
      send(() => Y.applyUpdate(other, update, 'remote'))
    })
    awareness[index]!.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      if (origin === 'remote') return
      const changed = [...added, ...updated, ...removed]
      const update = encodeAwarenessUpdate(awareness[index]!, changed)
      send(() => applyAwarenessUpdate(awareness[1 - index]!, update, 'remote'))
    })
  })
}

let loading: Promise<void> | undefined

/** Imports once, even when StrictMode runs the effect twice. */
function load(): Promise<void> {
  loading ??= importWorkbook()
  return loading
}

async function importWorkbook(): Promise<void> {
  const bytes = new Uint8Array(await (await fetch(fileUrl)).arrayBuffer())
  await codec.importFile(docs[0]!, bytes, { name: fileName, assets })
  Y.applyUpdate(docs[1]!, Y.encodeStateAsUpdate(docs[0]!), 'remote')
  connect()
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return btoa(binary)
}

Object.assign(window, {
  __sheets: {
    docs,
    awareness,
    views,
    codec,
    assets,
    fileName,
    /** The workbook as file bytes (base64), as a download would produce. */
    exportFile: async (name = fileName, replica = 0) => bytesToBase64(await codec.exportFile(docs[replica]!, { name, assets })),
    toText: (replica = 0) => codec.toText(docs[replica]!),
  },
})

const USERS = [
  { name: 'Ada', color: '#1A73E8' },
  { name: 'Grace', color: '#D93025' },
]

function Harness() {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string>()
  useEffect(() => {
    load().then(() => setReady(true), (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
  }, [])
  if (error) return <p role="alert" className="p-4 text-destructive">{error}</p>
  if (!ready) return <p className="p-4 text-muted-foreground">Loading…</p>
  const editors = split ? [0, 1] : [0]
  return (
    <div className="flex h-screen w-screen gap-px bg-border">
      {editors.map((index) => (
        <div key={index} className="flex min-w-0 flex-1 flex-col bg-background" data-replica={index}>
          <SheetEditor
            doc={docs[index]!}
            awareness={awareness[index]!}
            readOnly={params.get('readonly') === '1'}
            assets={assets}
            user={USERS[index]!}
            onView={(view) => {
              views[index] = view
            }}
          />
        </div>
      ))}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
)
