// Dev-only harness for the notebook and text editors (not a production route): a file in two
// Y.Docs kept in sync in memory, standing in for two collaborators, without the API. Playwright
// drives it through the page and through `window.harness`.
//
// Query parameters: format=notebook (default) or text, name=<file name> (text), fixture=<notebook
// under packages/client-core/src/office/notebook/fixtures> or blank=1, split=1 (both collaborators
// side by side), width=narrow|wide|fill, readonly=1, theme=dark, lang=es, agent=1 (offer to run
// the notebook with an agent; runs are counted in `window.agentRuns`).
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Y from 'yjs'
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness'
import type { DocSession } from '@pulpo/client-core/doc-sync'
import { MemoryLiveAssetStore } from '@pulpo/client-core/office'
import { cellSourceText, cellType, metadataValue, cellMetadata, notebookCodec, notebookToScript, orderedCells } from '@pulpo/client-core/office/notebook'
import { textCodec } from '@pulpo/client-core/office/text'
import '../../src/index.css'
import i18n from '../../src/i18n'
import { NotebookDocEditor } from '../../src/features/files/live/notebook/NotebookDocEditor'
import { TextDocEditor } from '../../src/features/files/live/text/TextDocEditor'

const params = new URLSearchParams(location.search)
if (params.get('theme') === 'dark') document.documentElement.classList.add('dark')
if (params.get('lang') === 'es') await i18n.changeLanguage('es-ES')

const fixtures = import.meta.glob('../../../../packages/client-core/src/office/notebook/fixtures/*.ipynb', { query: '?url', import: 'default' }) as Record<string, () => Promise<string>>
const format = params.get('format') === 'text' ? 'text' : 'notebook'
const assets = new MemoryLiveAssetStore()
const original = new Y.Doc()
let name: string
if (format === 'text') {
  name = params.get('name') ?? 'notes.txt'
  const text = params.get('text') ?? 'The quick brown fox\njumps over the lazy dog.\n\nA third paragraph, with café and naïve words.\n'
  await textCodec.importFile(original, new TextEncoder().encode(text), { name, assets })
} else if (params.get('blank') === '1') {
  name = 'Untitled.ipynb'
  await notebookCodec.createEmpty(original, { name, assets })
} else {
  const fixture = params.get('fixture') ?? 'generated-analysis'
  const loader = Object.entries(fixtures).find(([path]) => path.endsWith(`/fixtures/${fixture}.ipynb`))?.[1]
  if (!loader) throw new Error(`Unknown fixture ${fixture}`)
  name = `${fixture}.ipynb`
  const bytes = new Uint8Array(await (await fetch(await loader())).arrayBuffer())
  await notebookCodec.importFile(original, bytes, { name, assets })
}

const docA = new Y.Doc()
const docB = new Y.Doc()
Y.applyUpdate(docA, Y.encodeStateAsUpdate(original))
Y.applyUpdate(docB, Y.encodeStateAsUpdate(original))
const awarenessA = new Awareness(docA)
const awarenessB = new Awareness(docB)
// The "network" between the two collaborators.
const relay = (from: Y.Doc, to: Y.Doc) => from.on('update', (update: Uint8Array, origin: unknown) => {
  if (origin !== 'relay') Y.applyUpdate(to, update, 'relay')
})
relay(docA, docB)
relay(docB, docA)
const relayAwareness = (from: Awareness, to: Awareness) => from.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
  if (origin !== 'relay') applyAwarenessUpdate(to, encodeAwarenessUpdate(from, [...added, ...updated, ...removed]), 'relay')
})
relayAwareness(awarenessA, awarenessB)
relayAwareness(awarenessB, awarenessA)

// The editors only read the provider's awareness.
const sessionA = { doc: docA, provider: { awareness: awarenessA } } as unknown as DocSession
const sessionB = { doc: docB, provider: { awareness: awarenessB } } as unknown as DocSession
const docOf = (which: 'a' | 'b' = 'a') => (which === 'a' ? docA : docB)

Object.assign(window, {
  harness: {
    docA,
    docB,
    /** Each cell's type, source, and hidden flags (notebooks). */
    cells: (which: 'a' | 'b' = 'a') => orderedCells(docOf(which)).map(({ key, cell }) => {
      const jupyter = metadataValue(cellMetadata(cell), 'jupyter') as Record<string, unknown> | undefined
      return { key, type: cellType(cell), source: cellSourceText(cell), sourceHidden: jupyter?.source_hidden === true, outputsHidden: jupyter?.outputs_hidden === true }
    }),
    text: (which: 'a' | 'b' = 'a') => docOf(which).getText('text').toString(),
    script: (which: 'a' | 'b' = 'a') => notebookToScript(docOf(which)).text,
    async exportFile(which: 'a' | 'b' = 'a') {
      const bytes = format === 'text' ? await textCodec.exportFile(docOf(which), { name, assets }) : await notebookCodec.exportFile(docOf(which), { name, assets })
      return new TextDecoder().decode(bytes)
    },
  },
})

const split = params.get('split') === '1'
const width = (['narrow', 'wide', 'fill'] as const).find((value) => value === params.get('width')) ?? 'narrow'
const editable = params.get('readonly') !== '1'
const onRunWithAgent = params.get('agent') === '1' ? () => { Object.assign(window, { agentRuns: ((window as { agentRuns?: number }).agentRuns ?? 0) + 1 }) } : undefined
const Editor = format === 'text' ? TextDocEditor : NotebookDocEditor

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div className={split ? 'grid h-full grid-cols-2 divide-x bg-background text-foreground' : 'h-full bg-background text-foreground'}>
      <div className="h-full min-h-0 min-w-0" data-replica="a"><Editor session={sessionA} name={name} editable={editable} width={width} assets={assets} onRunWithAgent={onRunWithAgent} /></div>
      {split && <div className="h-full min-h-0 min-w-0" data-replica="b"><Editor session={sessionB} name={name} editable={editable} width={width} assets={assets} /></div>}
    </div>
  </StrictMode>,
)
