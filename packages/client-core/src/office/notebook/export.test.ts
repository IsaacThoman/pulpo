// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { MemoryLiveAssetStore } from '../assets.js'
import { notebookCodec } from './codec.js'
import { notebookToHtml, notebookToScript } from './export.js'
import { inertHtml } from './html.js'

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

async function notebook(cells: unknown[], metadata: Record<string, unknown> = {}) {
  const doc = new Y.Doc()
  const assets = new MemoryLiveAssetStore()
  const file = { nbformat: 4, nbformat_minor: 5, metadata, cells: cells.map((cell, index) => ({ id: `c${index}`, metadata: {}, ...cell as object })) }
  await notebookCodec.importFile(doc, new TextEncoder().encode(JSON.stringify(file)), { name: 'a.ipynb', assets })
  return { doc, assets }
}

const code = (source: string, outputs: unknown[] = []) => ({ cell_type: 'code', source, execution_count: null, outputs })
const markdown = (source: string) => ({ cell_type: 'markdown', source })

describe('notebook as a script', () => {
  it('writes Jupytext percent cells, with Markdown and raw cells as comments', async () => {
    const { doc } = await notebook([
      markdown('# Title\n\nSome *prose*.'),
      code('import math\nprint(math.pi)\n'),
      code(''),
      { cell_type: 'raw', source: 'raw text' },
    ], { language_info: { name: 'python', file_extension: '.py' } })
    expect(notebookToScript(doc)).toEqual({
      extension: '.py',
      mimeType: 'text/x-python',
      text: '# %% [markdown]\n# # Title\n#\n# Some *prose*.\n\n# %%\nimport math\nprint(math.pi)\n\n# %%\n\n# %% [raw]\n# raw text\n',
    })
  })

  it('comments out IPython magics and shell escapes so the Python runs', async () => {
    const { doc } = await notebook([code('%matplotlib inline\n!pip install x\nx = 1 % 2'), code('%%bash\necho hi')])
    expect(notebookToScript(doc).text).toBe('# %%\n# %matplotlib inline\n# !pip install x\nx = 1 % 2\n\n# %%\n# %%bash\n# echo hi\n')
  })

  it('comments out only the magics IPython would run, where a statement starts', async () => {
    const magics = [
      '! ls -la',
      '!{sys.executable} -m pip install x',
      '!!ls',
      'files = !ls',
      'for name in files:',
      '    !echo {name}',
      '!echo one \\',
      '  two',
      "x = '\"\"\"'",
      "# it's ''' in a comment",
      '%time f()',
    ].join('\n')
    const python = [
      'kept = [row for row in rows',
      '        if row["status"]',
      '        != "deleted"]',
      'ok = (1',
      '      !=2)',
      'sql = """',
      '%s rows',
      '!important',
      '"""',
      'doc = """a \\""" b',
      '%d"""',
      "s = 'it''s'",
      'y = a \\',
      '    %b',
    ].join('\n')
    const { doc } = await notebook([code(magics), code(python)])
    expect(notebookToScript(doc).text).toBe(`# %%\n${[
      '# ! ls -la',
      '# !{sys.executable} -m pip install x',
      '# !!ls',
      '# files = !ls',
      'for name in files:',
      '    # !echo {name}',
      '# !echo one \\',
      '#   two',
      "x = '\"\"\"'",
      "# it's ''' in a comment",
      '# %time f()',
    ].join('\n')}\n\n# %%\n${python}\n`)
  })

  it('takes the extension and comment style from the kernel language', async () => {
    const r = await notebook([code('x <- 1'), markdown('Notes')], { kernelspec: { language: 'R', name: 'ir', display_name: 'R' } })
    expect(notebookToScript(r.doc)).toMatchObject({ extension: '.r', text: '# %%\nx <- 1\n\n# %% [markdown]\n# Notes\n' })
    const js = await notebook([code('%not a magic in JS')], { language_info: { name: 'javascript' } })
    expect(notebookToScript(js.doc)).toMatchObject({ extension: '.js', mimeType: 'text/javascript', text: '// %%\n%not a magic in JS\n' })
    const odd = await notebook([code('?')], { language_info: { name: 'brainfork', file_extension: 'not an extension' } })
    expect(notebookToScript(odd.doc).extension).toBe('.txt')
  })
})

describe('notebook as a static page', () => {
  const cells = [
    markdown('# Report\n\n<script>alert(1)</script>\n\n<img src="x" onerror="alert(2)">\n\n[link](javascript:alert(3)) ![ok](https://example.com/a.png)'),
    code('df', [{
      output_type: 'execute_result', execution_count: 1, metadata: {},
      data: { 'text/html': '<table class="dataframe"><tr><td onclick="steal()">1</td></tr></table><style>body{display:none}</style><iframe src="https://evil"></iframe>', 'text/plain': 'plain df' },
    }]),
    code('js', [{ output_type: 'display_data', metadata: {}, data: { 'application/javascript': 'alert(4)', 'text/plain': '<IPython.Javascript>' } }]),
    code('img', [{ output_type: 'display_data', metadata: {}, data: { 'image/png': PNG } }]),
  ]

  it('keeps the content and drops everything active', async () => {
    const { doc, assets } = await notebook(cells)
    const html = await notebookToHtml(doc, { assets }, { title: 'Report <1>' })
    expect(html).toContain('<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data: https: http:; style-src \'unsafe-inline\'">')
    expect(html).toContain('<title>Report &lt;1&gt;</title>')
    expect(html).toContain('<h1>Report</h1>')
    expect(html).toContain('<table class="dataframe">')
    expect(html).toContain('<td>1</td>')
    expect(html).toContain('&lt;IPython.Javascript&gt;')
    expect(html).toContain(`src="data:image/png;base64,${PNG}"`)
    expect(html).toContain('src="https://example.com/a.png"')
    expect(html).toContain('<a>link</a>')
    for (const active of ['<script', 'onerror', 'onclick', 'javascript:', '<iframe', 'body{display:none}', 'alert(4)']) expect(html).not.toContain(active)
  })

  it('shows HTML outputs as their text where markup cannot be made inert', async () => {
    const { doc, assets } = await notebook(cells)
    const parser = globalThis.DOMParser
    // @ts-expect-error -- as in an environment without a DOM
    delete globalThis.DOMParser
    try {
      expect(inertHtml('<b>x</b>')).toBeNull()
      const html = await notebookToHtml(doc, { assets }, { title: 'Report' })
      expect(html).not.toContain('<table')
      expect(html).toContain('plain df')
      expect(html).not.toContain('alert(4)')
      // Markdown's own HTML stays, and the page's policy keeps it from running.
      expect(html).toContain('Content-Security-Policy')
    } finally {
      globalThis.DOMParser = parser
    }
  })

  it('keeps the mobile viewer\'s rendering as it was', async () => {
    const { renderNotebookHtml } = await import('./html.js')
    const { parseNotebook } = await import('./model.js')
    const html = renderNotebookHtml(parseNotebook(JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells: cells.map((cell, index) => ({ id: `c${index}`, metadata: {}, ...cell })) })), { title: 'x' })
    expect(html).not.toContain('Content-Security-Policy')
    expect(html).toContain('<script>alert(4)</script>')
  })
})
