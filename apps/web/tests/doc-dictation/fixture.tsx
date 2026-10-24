import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { applyNodeToYDoc, docSchema } from '@pulpo/client-core/doc-schema'
import { Node as ProseMirrorNode } from '@tiptap/pm/model'
import * as Y from 'yjs'
import '../../src/index.css'
import '../../src/i18n'
import { TooltipProvider } from '../../src/components/ui/tooltip'
import { DocEditor } from '../../src/features/files/editor/DocEditor'
import { FakeServer, FakeSocket } from '@pulpo/client-core/doc-sync/testing'
import { SocketIOYProvider } from '@pulpo/client-core/doc-sync'
import type { PulpoSocket } from '../../src/lib/realtime-socket'

const params = new URLSearchParams(location.search)
if (params.get('theme') === 'dark') document.documentElement.classList.add('dark')
const long = params.has('long')

// A tone stands in for the microphone, so the recorder and waveform run for real.
// WebKit keeps its own getUserMedia over one assigned or defined on mediaDevices.
Object.defineProperty(navigator, 'mediaDevices', {
  configurable: true,
  value: { getUserMedia: async () => {
    const context = new AudioContext()
    const tone = context.createOscillator()
    const gain = context.createGain()
    gain.gain.value = 0.4
    setInterval(() => { gain.gain.value = 0.05 + Math.random() * 0.6 }, 90)
    const destination = context.createMediaStreamDestination()
    tone.connect(gain).connect(destination)
    tone.start()
    return destination.stream
  } },
})
const realFetch = window.fetch.bind(window)
window.fetch = async (input, init) => {
  if (!String(input).endsWith('/api/dictation/transcriptions')) return realFetch(input, init)
  await new Promise((resolve) => setTimeout(resolve, Number(params.get('delay') ?? 300)))
  return new Response(JSON.stringify({ text: params.get('transcript') ?? 'and dictation lands right at the cursor.' }), { headers: { 'content-type': 'application/json' } })
}

const text = (value: string, marks?: unknown[]) => ({ type: 'text', text: value, ...(marks && { marks }) })
const paragraph = (...content: unknown[]) => ({ type: 'paragraph', content })
const server = new FakeServer()
applyNodeToYDoc(server.doc, ProseMirrorNode.fromJSON(docSchema(), { type: 'doc', content: [
  { type: 'heading', attrs: { level: 1 }, content: [text('Meeting notes')] },
  paragraph(text('Agreed to ship the editor this week,')),
  ...(long ? Array.from({ length: 40 }, (_, index) => paragraph(text(`Filler line ${index + 1}.`))) : []),
] }))

const doc = new Y.Doc()
const provider = new SocketIOYProvider('doc-1', doc)
provider.attach(new FakeSocket(server) as unknown as PulpoSocket)

// Lays out like the file page: a header, then the document scrolling under it.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider>
      <div className="flex h-screen flex-col">
        <header className="border-b px-4 py-3 text-lg font-semibold">Meeting notes</header>
        <div data-scroller className="min-h-0 flex-1 overflow-y-auto">
          <DocEditor session={{ doc, provider }} editable dictation />
        </div>
      </div>
    </TooltipProvider>
  </StrictMode>,
)
