import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import '../../src/i18n'
import { CodeViewer } from '../../src/components/viewers/CodeViewer'
import { DelimitedGrid } from '../../src/components/viewers/DelimitedGrid'
import { HtmlViewer } from '../../src/components/viewers/HtmlViewer'
import { NotebookViewer } from '../../src/components/viewers/NotebookViewer'

const params = new URLSearchParams(location.search)
const viewer = params.get('viewer') ?? 'grid'
if (params.get('theme') === 'dark') document.documentElement.classList.add('dark')
// A parent-origin secret the sandboxed previews must never see.
document.cookie = 'pulpo_fixture_secret=parent-only; path=/'
localStorage.setItem('pulpo-fixture-secret', 'parent-only')

function gridText(): string {
  const rows = Number(params.get('rows') ?? 150_000)
  const columns = Number(params.get('columns') ?? 12)
  const header = ['id', 'customer', 'note', ...Array.from({ length: columns - 3 }, (_, index) => `metric_${index + 1}`)]
  const lines = [header.join(',')]
  for (let row = 1; row <= rows; row++) {
    const note = row % 1000 === 0 ? '"Line one\nline two, with ""quotes"""' : `"Note, ${row}"`
    lines.push([row, `Customer ${row}`, note, ...Array.from({ length: columns - 3 }, (_, index) => (row * (index + 1)) % 997)].join(','))
  }
  return lines.join('\r\n')
}

function codeText(): string {
  const lines = Number(params.get('lines') ?? 40)
  const body = Array.from({ length: lines }, (_, index) => `export function value${index}(input: number): number {\n  // Doubles line ${index}\n  return input * ${index} + 0.5\n}\n`)
  return `/* A long generated module\n   that opens with a block comment */\n${body.join('\n')}`
}

const PROBE = `<!doctype html><html><head><title>Probe</title></head><body><pre id="probe">running</pre><script>
const lines = []
const tryIt = (label, fn) => { try { lines.push(label + '=' + fn()) } catch (e) { lines.push(label + '=blocked') } }
tryIt('origin', () => self.origin)
tryIt('cookie', () => JSON.stringify(document.cookie))
tryIt('parent', () => parent.document.title)
tryIt('storage', () => localStorage.getItem('pulpo-fixture-secret'))
tryIt('top', () => top.location.href)
document.getElementById('probe').textContent = lines.join('\\n')
</script></body></html>`

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const ESC = '\u001b'
const notebook = {
  nbformat: 4,
  nbformat_minor: 5,
  metadata: { kernelspec: { display_name: 'Python 3 (ipykernel)', language: 'python', name: 'python3' } },
  cells: [
    { cell_type: 'markdown', id: 'title', metadata: {}, source: ['# Quarterly report\n', '\n', 'Growth follows $y = mx + b$.\n', '\n', '![chart](attachment:chart.png)'], attachments: { 'chart.png': { 'image/png': PNG } } },
    { cell_type: 'code', id: 'a', execution_count: 7, metadata: {}, source: ['import math\n', 'print(math.pi)'], outputs: [{ output_type: 'stream', name: 'stdout', text: ['3.141592653589793\n'] }] },
    { cell_type: 'code', id: 'b', execution_count: 8, metadata: {}, source: ['plot()'], outputs: [{ output_type: 'display_data', metadata: {}, data: { 'image/png': PNG, 'text/plain': ['<Figure>'] } }] },
    { cell_type: 'code', id: 'c', execution_count: 9, metadata: {}, source: ['df'], outputs: [{ output_type: 'execute_result', execution_count: 9, metadata: {}, data: { 'text/html': ['<table class="dataframe"><tr><th>a</th></tr><tr><td>1</td></tr></table>', PROBE.replace(/<!doctype html><html><head><title>Probe<\/title><\/head><body>|<\/body><\/html>/g, '')], 'text/plain': ['   a\n0  1'] } }] },
    { cell_type: 'code', id: 'd', execution_count: 10, metadata: {}, source: ['1/0'], outputs: [{ output_type: 'error', ename: 'ZeroDivisionError', evalue: 'division by zero', traceback: [`${ESC}[0;31mZeroDivisionError${ESC}[0m: division by zero <img src=x onerror=alert(1)>`] }] },
  ],
}

const text = viewer === 'grid' ? gridText() : viewer === 'code' ? codeText() : viewer === 'notebook' ? JSON.stringify(notebook) : PROBE
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {viewer === 'grid' && <DelimitedGrid text={text} name="orders.csv" mimeType="text/csv" />}
    {viewer === 'code' && <CodeViewer text={text} name="module.ts" mimeType="text/typescript" />}
    {viewer === 'html' && <HtmlViewer text={text} name="probe.html" kind="html" />}
    {viewer === 'notebook' && <NotebookViewer text={text} name="report.ipynb" />}
  </StrictMode>,
)
