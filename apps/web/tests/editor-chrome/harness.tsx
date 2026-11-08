// Dev-only harness for the text and notebook editors' shared chrome (menu bar, shortcuts dialog,
// print and save keys), on a local document without a server. `?kind=text` (a Python file) or
// `?kind=notebook`; `?dark=1` the dark theme. Cmd/Ctrl+S presses are counted in `window.saved`.
import { createRoot } from 'react-dom/client'
import * as Y from 'yjs'
import { SocketIOYProvider } from '@pulpo/client-core/doc-sync'
import { MemoryLiveAssetStore } from '@pulpo/client-core/office'
import { notebookCodec } from '@pulpo/client-core/office/notebook'
import { textCodec } from '@pulpo/client-core/office/text'
import '../../src/index.css'
import '../../src/i18n'
import TextDocEditor from '../../src/features/files/live/text/TextDocEditor'
import NotebookDocEditor from '../../src/features/files/live/notebook/NotebookDocEditor'

declare global {
  interface Window { saved: number }
}

const params = new URLSearchParams(location.search)
if (params.get('dark') === '1') document.documentElement.classList.add('dark')
const kind = params.get('kind') === 'notebook' ? 'notebook' : 'text'
const assets = new MemoryLiveAssetStore()
const doc = new Y.Doc()
// Never connected: it only carries the session's awareness, as the editors expect.
const provider = new SocketIOYProvider(kind, doc)
const encoder = new TextEncoder()
if (kind === 'text') {
  await textCodec.importFile(doc, encoder.encode('def hello():\n    return 1\n'), { name: 'app.py', assets })
} else {
  await notebookCodec.importFile(doc, encoder.encode(JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [
    { id: 'a', cell_type: 'code', source: 'print(1)', execution_count: null, metadata: {}, outputs: [] },
    { id: 'b', cell_type: 'markdown', source: '# Title', metadata: {} },
  ] })), { name: 'a.ipynb', assets })
}
const session = { doc, provider } as never
window.saved = 0
const onSaveShortcut = () => { window.saved++ }

createRoot(document.getElementById('root')!).render(
  kind === 'text'
    ? <TextDocEditor session={session} name="app.py" editable width="wide" assets={assets} onSaveShortcut={onSaveShortcut} />
    : <NotebookDocEditor session={session} name="a.ipynb" editable width="wide" assets={assets} onSaveShortcut={onSaveShortcut} />,
)
