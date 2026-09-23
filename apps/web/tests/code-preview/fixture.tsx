import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import '../../src/i18n'
import mains from '../../src/sandbox/fixtures/mains.jsx?raw'
import { Markdown } from '../../src/components/chat/Markdown'
import { CodePreviewPanel } from '../../src/components/chat/CodePreviewPanel'

const fence = (language: string, code: string) => `\`\`\`${language}\n${code}\n\`\`\``

const samples = [
  fence('jsx', mains),
  fence('jsx', `import { LineChart, Line, XAxis } from 'recharts'
export default function Chart() {
  const data = [{ x: 'a', y: 1 }, { x: 'b', y: 3 }, { x: 'c', y: 2 }]
  return <LineChart width={320} height={200} data={data}><XAxis dataKey="x" /><Line dataKey="y" /></LineChart>
}`),
  fence('tsx', `import { Zap } from 'lucide-react'
export default function Badge(): JSX.Element {
  return <div data-testid="badge" className="flex items-center gap-2 p-4 text-lg"><Zap /> Charged</div>
}`),
  fence('html', `<!doctype html><html><head><title>Probe</title></head><body><p id="out">waiting</p><script>
const probe = (read) => { try { read(); return 'readable' } catch { return 'blocked' } }
document.getElementById('out').textContent = JSON.stringify({
  origin: self.origin,
  localStorage: probe(() => localStorage.length),
  cookie: probe(() => document.cookie),
  parent: probe(() => parent.document.title),
})
</script></body></html>`),
  fence('svg', '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle id="dot" cx="5" cy="5" r="4"/></svg>'),
  fence('jsx', 'export default function Broken() { throw new Error("Kaboom from preview") }'),
  fence('jsx', 'import axios from "axios"\nexport default function Fetcher() { axios.get("/api/me"); return null }'),
  fence('jsx', 'import "./styles.css"\nexport default function Deck() { return <h2 className="deck">Flashcards</h2> }'),
].join('\n\n')

createRoot(document.getElementById('root')!).render(
  <div style={{ display: 'flex', height: '100vh' }}>
    <main style={{ flex: 1, overflow: 'auto', padding: 16 }}><Markdown content={samples} /></main>
    <CodePreviewPanel />
  </div>,
)
