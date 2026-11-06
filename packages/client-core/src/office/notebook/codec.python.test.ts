import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { MemoryLiveAssetStore } from '../assets.js'
import { notebookCodec } from './codec.js'
import { clearOutputs, deleteCells, insertCells, mergeCells, moveCells, setCellType, setOutputsCollapsed, splitCell } from './edit.js'
import { orderedCells } from './layout.js'

/**
 * Checks against Jupyter's own libraries: edited exports pass `nbformat.validate`, and notebooks
 * an agent edits with nbformat (or runs with nbclient) apply as minimal diffs that export exactly
 * what Python wrote. Opt in with a Python that has nbformat, nbclient, and ipykernel:
 *
 *   PULPO_NOTEBOOK_PYTHON=~/.venv/bin/python npm run test -w @pulpo/client-core -- notebook
 */
const PYTHON = process.env.PULPO_NOTEBOOK_PYTHON
const FIXTURES = join(import.meta.dirname, 'fixtures')
const work = PYTHON ? mkdtempSync(join(tmpdir(), 'pulpo-notebook-')) : ''

afterAll(() => {
  if (work) rmSync(work, { recursive: true, force: true })
})

function python(script: string, ...args: string[]): string {
  return execFileSync(PYTHON!, ['-I', '-c', script, ...args], { cwd: work, encoding: 'utf8', timeout: 180_000 })
}

const VALIDATE = `
import sys, nbformat
nb = nbformat.read(sys.argv[1], as_version=4)
nbformat.validate(nb)
print(len(nb.cells))
`

describe.skipIf(!PYTHON)('notebooks checked with nbformat', () => {
  const fixtures = readdirSync(FIXTURES).filter((name) => name.endsWith('.ipynb'))

  it.each(fixtures)('exports %s as a valid notebook after every kind of edit', async (name) => {
    const assets = new MemoryLiveAssetStore()
    const doc = new Y.Doc()
    await notebookCodec.importFile(doc, new Uint8Array(readFileSync(join(FIXTURES, name))), { name, assets })
    const keys = () => orderedCells(doc).map((entry) => entry.key)
    const [first] = keys()
    const added = insertCells(doc, { after: first ?? null }, [
      { type: 'code', source: 'print("añadido")\nx = 1' },
      { type: 'markdown', source: '## New section\n\nWith *emphasis* and $x^2$.' },
      { type: 'raw', source: 'raw\ntext' },
    ])
    splitCell(doc, added[0]!, [17])
    mergeCells(doc, [added[1]!, added[2]!])
    moveCells(doc, [keys()[keys().length - 1]!], { after: null })
    setCellType(doc, [keys()[1]!], 'markdown')
    setCellType(doc, [keys()[2]!], 'code')
    setOutputsCollapsed(doc, keys().slice(0, 3), true)
    clearOutputs(doc, [keys()[3] ?? keys()[0]!])
    deleteCells(doc, [keys()[keys().length - 1]!])
    const source = orderedCells(doc)[0]!.cell.get('source') as Y.Text
    source.insert(0, '# edited 😀\n')
    const path = join(work, `edited-${name}`)
    writeFileSync(path, await notebookCodec.exportFile(doc, { name, assets }))
    expect(Number(python(VALIDATE, path))).toBe(orderedCells(doc).length)
  })

  it('applies a notebook an agent edited with nbformat, exporting exactly what Python wrote', async () => {
    const name = 'generated-analysis.ipynb'
    const assets = new MemoryLiveAssetStore()
    const doc = new Y.Doc()
    await notebookCodec.importFile(doc, new Uint8Array(readFileSync(join(FIXTURES, name))), { name, assets })
    const user = new Y.Doc()
    Y.applyUpdate(user, Y.encodeStateAsUpdate(doc))
    // The user edits the first Markdown cell while the agent works.
    ;(orderedCells(user)[0]!.cell.get('source') as Y.Text).insert(0, 'Draft: ')
    const path = join(work, 'agent.ipynb')
    python(`
import sys, nbformat
from nbformat.v4 import new_code_cell
nb = nbformat.read(sys.argv[1], as_version=4)
nb.cells[2].source = nb.cells[2].source.replace("'Apr'", "'April'")
nb.cells.insert(4, new_code_cell("df.describe()"))
del nb.cells[8]
nb.cells[1], nb.cells[2] = nb.cells[2], nb.cells[1]
nbformat.write(nb, sys.argv[2])
`, join(FIXTURES, name), path)
    const pushed = new Uint8Array(readFileSync(path))
    await notebookCodec.applyFile(doc, pushed, { name, assets }, 'agent')
    expect(new TextDecoder().decode(await notebookCodec.exportFile(doc, { name, assets }))).toBe(new TextDecoder().decode(pushed))
    Y.applyUpdate(user, Y.encodeStateAsUpdate(doc))
    const mergedPath = join(work, 'merged.ipynb')
    writeFileSync(mergedPath, await notebookCodec.exportFile(user, { name, assets }))
    const merged = JSON.parse(python(`
import sys, json, nbformat
nb = nbformat.read(sys.argv[1], as_version=4)
nbformat.validate(nb)
print(json.dumps([c.source for c in nb.cells]))
`, mergedPath)) as string[]
    expect(merged[0]).toMatch(/^Draft: # Sales analysis/)
    expect(merged[1]).toContain("'April'")
    expect(merged).toContain('df.describe()')
    expect(merged.some((cell) => cell === '1 / 0')).toBe(false)
  })

  it('applies a notebook run with nbclient, as an agent runs one in its sandbox', async () => {
    const name = 'generated-analysis.ipynb'
    const assets = new MemoryLiveAssetStore()
    const doc = new Y.Doc()
    await notebookCodec.importFile(doc, new Uint8Array(readFileSync(join(FIXTURES, name))), { name, assets })
    clearOutputs(doc, null)
    const cleared = join(work, 'cleared.ipynb')
    writeFileSync(cleared, await notebookCodec.exportFile(doc, { name, assets }))
    const executed = join(work, 'executed.ipynb')
    python(`
import sys, nbformat
from nbclient import NotebookClient
nb = nbformat.read(sys.argv[1], as_version=4)
NotebookClient(nb, timeout=120, kernel_name="python3", allow_errors=True).execute()
nbformat.write(nb, sys.argv[2])
`, cleared, executed)
    const pushed = new Uint8Array(readFileSync(executed))
    const before = orderedCells(doc).map((entry) => entry.key)
    expect((await notebookCodec.applyFile(doc, pushed, { name, assets }, 'agent')).changed).toBe(true)
    // Every cell kept its identity; only outputs and counts changed.
    expect(orderedCells(doc).map((entry) => entry.key)).toEqual(before)
    expect(new TextDecoder().decode(await notebookCodec.exportFile(doc, { name, assets }))).toBe(new TextDecoder().decode(pushed))
  })
})
