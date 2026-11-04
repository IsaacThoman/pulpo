import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseAnsi, stripAnsi } from './ansi.js'
import { ansiHtml, renderNotebookHtml } from './html.js'
import {
  applyConsoleControls,
  imageDataUrl,
  NotebookError,
  normalizeNotebook,
  outputPlainText,
  parseNotebook,
  pickOutputMime,
  resolveAttachmentUrl,
  svgDataUrl,
  type NotebookCell,
} from './model.js'

const fixture = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8')
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const code = (cell: NotebookCell | undefined) => {
  if (cell?.type !== 'code') throw new Error('expected a code cell')
  return cell
}

describe('parseNotebook (nbformat 4)', () => {
  const notebook = parseNotebook(fixture('nbformat-test4.ipynb'))

  it('reads the reference notebook', () => {
    expect(notebook.nbformat).toBe(4)
    // Its metadata is empty; viewers then highlight code cells as Python, Jupyter's default.
    expect(notebook.language).toBeNull()
    expect(notebook.cells.map((cell) => cell.type)).toEqual(['markdown', 'markdown', 'markdown', 'code', 'markdown', 'code', 'code', 'markdown', 'code'])
  })

  it('joins multi-line sources and keeps execution counts', () => {
    const cell = code(notebook.cells[3])
    expect(cell.source).toContain('\n')
    expect(cell.outputs[0]).toMatchObject({ type: 'stream', name: 'stdout' })
    const result = code(notebook.cells[5])
    expect(result.outputs[0]).toMatchObject({ type: 'execute_result' })
    expect(Object.keys((result.outputs[0] as { data: object }).data)).toEqual(['text/html', 'text/plain'])
  })

  it('picks the richest output each viewer supports', () => {
    const image = code(notebook.cells[8]).outputs[0]!
    if (image.type !== 'execute_result') throw new Error('expected a result')
    expect(pickOutputMime(image.data)).toBe('image/png')
    expect(pickOutputMime(image.data, ['text/plain'])).toBe('text/plain')
    expect(imageDataUrl('image/png', image.data['image/png'])).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/)
  })
})

describe('parseNotebook (nbformat 3)', () => {
  const notebook = parseNotebook(fixture('nbformat-test3.ipynb'))

  it('flattens worksheets and maps v3 cells and outputs to v4', () => {
    expect(notebook.nbformat).toBe(3)
    expect(notebook.language).toBe('python')
    expect(notebook.cells[0]).toMatchObject({ type: 'markdown' })
    expect(notebook.cells[0]!.source).toMatch(/^# /)
    const pyout = notebook.cells.flatMap((cell) => cell.type === 'code' ? cell.outputs : []).find((output) => output.type === 'execute_result')
    expect(pyout).toMatchObject({ type: 'execute_result' })
    if (pyout?.type !== 'execute_result') throw new Error('expected pyout')
    expect(Object.keys(pyout.data)).toEqual(expect.arrayContaining(['text/html', 'text/plain']))
    expect(pyout.executionCount).not.toBeNull()
  })

  it('reads v3 stream names from the `stream` field', () => {
    const stream = notebook.cells.flatMap((cell) => cell.type === 'code' ? cell.outputs : []).find((output) => output.type === 'stream')
    expect(stream).toMatchObject({ type: 'stream', name: 'stdout' })
  })
})

describe('normalizeNotebook', () => {
  it('merges consecutive writes to one stream and applies carriage returns', () => {
    const notebook = normalizeNotebook({
      nbformat: 4,
      nbformat_minor: 5,
      cells: [{
        cell_type: 'code',
        source: ['for i in range(3):\n', '    print(i)'],
        execution_count: 2,
        outputs: [
          { output_type: 'stream', name: 'stderr', text: '  0%|     | 0/3\r 33%|█    | 1/3\r100%|█████| 3/3\n' },
          { output_type: 'stream', name: 'stdout', text: ['0\n', '1\n'] },
          { output_type: 'stream', name: 'stdout', text: '2\n' },
        ],
      }],
      metadata: { kernelspec: { display_name: 'Python 3 (ipykernel)', language: 'python', name: 'python3' } },
    })
    const cell = code(notebook.cells[0])
    expect(cell.source).toBe('for i in range(3):\n    print(i)')
    expect(cell.outputs).toEqual([
      { type: 'stream', name: 'stderr', text: '100%|█████| 3/3\n' },
      { type: 'stream', name: 'stdout', text: '0\n1\n2\n' },
    ])
    expect(notebook.kernel).toBe('Python 3 (ipykernel)')
  })

  it('tolerates wrong types and unknown cells instead of failing', () => {
    const notebook = normalizeNotebook({
      nbformat: 4,
      cells: [
        null,
        42,
        { cell_type: 'mystery', source: 'x' },
        { cell_type: 'code', source: 7, outputs: 'nope', execution_count: -1 },
        { cell_type: 'code', source: 'x', outputs: [{ output_type: 'error', ename: 3, traceback: ['a', 5, 'b'] }, { output_type: 'weird' }, null] },
        { cell_type: 'markdown', source: ['a', null, 'b'], attachments: 'bad' },
      ],
    })
    expect(notebook.cells).toHaveLength(3)
    expect(code(notebook.cells[0])).toMatchObject({ source: '', executionCount: null, outputs: [] })
    expect(code(notebook.cells[1]).outputs).toEqual([{ type: 'error', ename: 'Error', evalue: '', traceback: ['a', 'b'] }])
    expect(notebook.cells[2]).toMatchObject({ type: 'markdown', source: 'ab', attachments: {} })
  })

  it('drops output data keys that are not MIME types', () => {
    const notebook = normalizeNotebook({ nbformat: 4, cells: [{ cell_type: 'code', source: '', outputs: [{ output_type: 'display_data', data: { 'text/plain': 'ok', '<script>': 'x', 'application/vnd.custom+json': { a: 1 } } }] }] })
    const output = code(notebook.cells[0]).outputs[0]!
    expect(output).toMatchObject({ type: 'display_data', data: { 'text/plain': 'ok', 'application/vnd.custom+json': { a: 1 } } })
    expect(output.type === 'display_data' && '<script>' in output.data).toBe(false)
  })

  it('explains files it cannot read', () => {
    expect(() => parseNotebook('{nope')).toThrow(NotebookError)
    expect(() => parseNotebook('[]')).toThrow(expect.objectContaining({ code: 'not_a_notebook' }))
    expect(() => parseNotebook('{"cells":"x"}')).toThrow(expect.objectContaining({ code: 'not_a_notebook' }))
    expect(() => parseNotebook('{"nbformat":2,"cells":[]}')).toThrow(expect.objectContaining({ code: 'unsupported_version' }))
    expect(() => normalizeNotebook({ nbformat: 4, cells: Array.from({ length: 10_001 }, () => ({})) })).toThrow(expect.objectContaining({ code: 'too_large' }))
  })

  it('reads a notebook saved with a byte order mark', () => {
    expect(parseNotebook('﻿{"nbformat":4,"nbformat_minor":5,"metadata":{},"cells":[]}').cells).toEqual([])
  })
})

describe('applyConsoleControls', () => {
  it('keeps the last drawn state of each line and applies backspaces', () => {
    expect(applyConsoleControls('a\rb\nc\r\n')).toBe('b\nc\n')
    expect(applyConsoleControls('done 100%\r')).toBe('done 100%')
    expect(applyConsoleControls('abc\b\bd')).toBe('ad')
    expect(applyConsoleControls('plain')).toBe('plain')
  })

  it('stays linear on long runs of backspaces', () => {
    const text = 'a'.repeat(320_000) + 'x\b'.repeat(320_000)
    const started = performance.now()
    expect(applyConsoleControls(text)).toBe('a'.repeat(320_000))
    expect(performance.now() - started).toBeLessThan(1_000)
  })
})

describe('data URLs', () => {
  it('accepts only base64 raster images', () => {
    expect(imageDataUrl('image/png', `${PNG.slice(0, 20)}\n${PNG.slice(20)}`)).toBe(`data:image/png;base64,${PNG}`)
    expect(imageDataUrl('image/png', 'not base64!"><script>')).toBeNull()
    expect(imageDataUrl('text/html', PNG)).toBeNull()
    expect(imageDataUrl('image/png', 42)).toBeNull()
    expect(svgDataUrl('<svg/>')).toBe('data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E')
  })

  it('resolves cell attachments', () => {
    const attachments = { 'plot one.png': { 'image/png': PNG } }
    expect(resolveAttachmentUrl('attachment:plot%20one.png', attachments)).toBe(`data:image/png;base64,${PNG}`)
    expect(resolveAttachmentUrl('attachment:missing.png', attachments)).toBeNull()
    expect(resolveAttachmentUrl('https://example.com/x.png', attachments)).toBeNull()
  })

  it('reads the text an output prints', () => {
    expect(outputPlainText({ type: 'error', ename: 'ValueError', evalue: 'bad', traceback: [] })).toBe('ValueError: bad')
    expect(outputPlainText({ type: 'display_data', data: { 'text/plain': 'x' }, metadata: {} })).toBe('x')
  })
})

describe('parseAnsi', () => {
  it('styles text with 16, 256, and true colors and resets', () => {
    const segments = parseAnsi('\u001b[0;31mValueError\u001b[0m: \u001b[1;38;5;208mbad\u001b[39m \u001b[48;2;10;20;30mbg\u001b[0m')
    expect(segments).toEqual([
      { text: 'ValueError', style: { fg: 'red' } },
      { text: ': ', style: {} },
      { text: 'bad', style: { bold: true, fg: '#ff8700' } },
      { text: ' ', style: { bold: true } },
      { text: 'bg', style: { bold: true, bg: '#0a141e' } },
    ])
  })

  it('drops cursor movement, titles, hyperlinks, and stray control characters', () => {
    const text = '\u001b[2K\u001b[1Gline\u001b]0;title\u0007 \u001b]8;;https://x.test\u001b\\link\u001b]8;;\u001b\\\u0000\u0007!'
    expect(stripAnsi(text)).toBe('line link!')
    expect(parseAnsi(text).map((segment) => segment.text).join('')).toBe('line link!')
  })

  it('handles bright colors and default resets', () => {
    expect(parseAnsi('\u001b[92mok\u001b[39;49mx')).toEqual([{ text: 'ok', style: { fg: 'bright-green' } }, { text: 'x', style: {} }])
  })

  it('escapes markup in ANSI HTML', () => {
    expect(ansiHtml('\u001b[31m<img src=x onerror=alert(1)>\u001b[0m')).toBe('<span class="ansi-fg-red">&lt;img src=x onerror=alert(1)&gt;</span>')
    expect(ansiHtml('\u001b[38;2;1;2;3mx')).toBe('<span style="color:#010203">x</span>')
  })
})

describe('renderNotebookHtml', () => {
  it('renders every cell and output type of the reference notebook', () => {
    const html = renderNotebookHtml(parseNotebook(fixture('nbformat-test4.ipynb')), { title: 'Test <4>' })
    expect(html).toContain('<title>Test &lt;4&gt;</title>')
    expect(html).toContain('class="cell markdown"')
    expect(html).toContain('In&nbsp;[')
    expect(html).toContain('data:image/png;base64,')
    expect(html).toContain('class="output html"')
    expect(html).toContain('hljs-')
  })

  it('escapes sources and text output but keeps HTML output as HTML', () => {
    const html = renderNotebookHtml(normalizeNotebook({
      nbformat: 4,
      cells: [
        { cell_type: 'code', source: 'print("</pre><script>alert(1)</script>")', execution_count: 1, outputs: [
          { output_type: 'stream', name: 'stdout', text: '</pre><b>x</b>' },
          { output_type: 'display_data', data: { 'text/html': '<b>bold</b>' } },
          { output_type: 'display_data', data: { 'application/javascript': 'console.log("</script><b>")' } },
        ] },
        { cell_type: 'raw', source: '<i>raw</i>' },
      ],
    }), { title: 'x' })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;/pre&gt;&lt;b&gt;x&lt;/b&gt;')
    expect(html).toContain('<div class="output html"><b>bold</b></div>')
    expect(html).toContain('<script>console.log("<\\/script><b>")</script>')
    expect(html).toContain('&lt;i&gt;raw&lt;/i&gt;')
  })

  it('renders math through the given renderer and resolves attachments', () => {
    const html = renderNotebookHtml(normalizeNotebook({
      nbformat: 4,
      cells: [{ cell_type: 'markdown', source: 'Energy $E=mc^2$ costs $5 and $6.\n\n$$\\int x$$\n\n![plot](attachment:p.png)', attachments: { 'p.png': { 'image/png': PNG } } }],
    }), { title: 'x', renderMath: (tex, display) => `<m d="${display}">${tex}</m>` })
    expect(html).toContain('<m d="false">E=mc^2</m>')
    expect(html).toContain('$5 and $6')
    expect(html).toContain('<m d="true">\\int x</m>')
    expect(html).toContain(`src="data:image/png;base64,${PNG}"`)
  })

  it('renders many block-math lines in linear time', () => {
    const started = performance.now()
    const html = renderNotebookHtml(normalizeNotebook({ nbformat: 4, cells: [{ cell_type: 'markdown', source: '$$a$$b\n'.repeat(8_000) }] }), { title: 'x' })
    expect(html.length).toBeGreaterThan(0)
    expect(performance.now() - started).toBeLessThan(2_000)
  })

  it('keys cells uniquely when a notebook repeats ids', () => {
    const notebook = normalizeNotebook({ nbformat: 4, cells: [{ cell_type: 'raw', id: 'x', source: '' }, { cell_type: 'raw', id: 'x', source: '' }] })
    expect(new Set(notebook.cells.map((cell) => cell.id)).size).toBe(2)
  })

  it('says when a notebook is empty and when widgets are left out', () => {
    expect(renderNotebookHtml(normalizeNotebook({ nbformat: 4, cells: [] }), { title: 'x', labels: { empty: 'Nothing here' } })).toContain('Nothing here')
    const widget = renderNotebookHtml(normalizeNotebook({ nbformat: 4, cells: [{ cell_type: 'code', source: '', outputs: [{ output_type: 'display_data', data: { 'application/vnd.jupyter.widget-view+json': { model_id: 'x' } } }] }] }), { title: 'x' })
    expect(widget).toContain('Interactive widgets')
  })
})
