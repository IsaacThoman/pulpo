import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { MemoryLiveAssetStore } from '../assets.js'
import { notebookCodec } from './codec.js'
import { orderedCells } from './layout.js'
import { markdownHeadings, notebookOutline, type NotebookOutlineCache } from './outline.js'

async function notebook(cells: { cell_type: 'code' | 'markdown' | 'raw'; source: string }[]) {
  const doc = new Y.Doc()
  const file = { nbformat: 4, nbformat_minor: 5, metadata: {}, cells: cells.map((cell, index) => ({ id: `c${index}`, metadata: {}, ...cell, ...cell.cell_type === 'code' ? { execution_count: null, outputs: [] } : {} })) }
  await notebookCodec.importFile(doc, new TextEncoder().encode(JSON.stringify(file)), { name: 'a.ipynb', assets: new MemoryLiveAssetStore() })
  return doc
}

describe('notebook outline', () => {
  it('reads headings by Markdown rules', () => {
    expect(markdownHeadings([
      '# Intro',
      '```python',
      '# not a heading',
      '```',
      'Setext title',
      '============',
      '',
      'Second',
      '------',
      '### **Bold** and `code` with [a link](https://example.com) &amp; more ###',
      '#hashtag is text',
      '<h4 class="x">From <em>HTML</em></h4>',
      '> # quoted headings are not the outline',
      '####### seven is text',
    ].join('\n'))).toEqual([
      { level: 1, text: 'Intro' },
      { level: 1, text: 'Setext title' },
      { level: 2, text: 'Second' },
      { level: 3, text: 'Bold and code with a link & more' },
      { level: 4, text: 'From HTML' },
    ])
    expect(markdownHeadings('## Kept\n# Top', 1)).toEqual([{ level: 1, text: 'Top' }])
    expect(markdownHeadings('plain prose')).toEqual([])
  })

  it('scans very long cells line by line, still skipping fences', () => {
    const long = `# Start\n\`\`\`\n# fenced\n\`\`\`\n${'word '.repeat(30_000)}\n## End ##`
    expect(markdownHeadings(long)).toEqual([{ level: 1, text: 'Start' }, { level: 2, text: 'End' }])
  })

  it('lists Markdown cells\' headings in notebook order, with their cells', async () => {
    const doc = await notebook([
      { cell_type: 'markdown', source: '# Analysis' },
      { cell_type: 'code', source: '# a comment, not a heading' },
      { cell_type: 'markdown', source: '## Data\ntext\n## Model' },
      { cell_type: 'raw', source: '# raw' },
    ])
    const keys = orderedCells(doc).map((entry) => entry.key)
    const cache: NotebookOutlineCache = new Map()
    expect(notebookOutline(doc, { cache })).toEqual([
      { key: keys[0], index: 0, level: 1, text: 'Analysis' },
      { key: keys[2], index: 2, level: 2, text: 'Data' },
      { key: keys[2], index: 2, level: 2, text: 'Model' },
    ])
    expect(notebookOutline(doc, { maxLevel: 1 })).toHaveLength(1)
    // Unchanged cells are not parsed again; deleted ones leave the cache.
    const first = cache.get(keys[0]!)
    ;(orderedCells(doc)[2]!.cell.get('source') as Y.Text).insert(0, '# New\n')
    notebookOutline(doc, { cache })
    expect(cache.get(keys[0]!)).toBe(first)
    expect(cache.get(keys[2]!)!.headings.map((heading) => heading.text)).toEqual(['New', 'Data', 'Model'])
    doc.getMap('cells').delete(keys[0]!)
    notebookOutline(doc, { cache })
    expect(cache.has(keys[0]!)).toBe(false)
  })
})
