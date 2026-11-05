import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { MemoryLiveAssetStore } from '../../assets.js'
import { notebookCodec } from '../codec.js'
import { cellSourceText, cellsMap, orderedCells } from '../layout.js'
import { clearNotebookClipboard, NotebookController } from './controller.js'
import { readOutputs } from './outputs.js'

const FIXTURE = join(import.meta.dirname, '../fixtures/generated-analysis.ipynb')

async function open(bytes?: Uint8Array) {
  const doc = new Y.Doc()
  const assets = new MemoryLiveAssetStore()
  if (bytes) await notebookCodec.importFile(doc, bytes, { name: 'a.ipynb', assets })
  else await notebookCodec.createEmpty(doc, { name: 'a.ipynb', assets })
  const awareness = new Awareness(doc)
  const controller = new NotebookController({ doc, awareness, assets, readOnly: false, user: { name: 'Ana', color: '#3366ff' } })
  return { doc, assets, awareness, controller }
}

const press = (controller: NotebookController, key: string, extra: Partial<{ shiftKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => controller.handleCommandKey({ key, ...extra })
const types = (controller: NotebookController) => controller.getState().cells.map((cell) => cell.type)
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => clearNotebookClipboard())

describe('notebook controller', () => {
  it('handles Jupyter command-mode keys', async () => {
    const { controller } = await open()
    expect(types(controller)).toEqual(['code'])
    press(controller, 'b')
    press(controller, 'm')
    press(controller, 'a')
    press(controller, 'r')
    expect(types(controller)).toEqual(['code', 'raw', 'markdown'])
    expect(controller.getState().active).toBe(controller.getState().cells[1]!.key)
    // D twice deletes; once does nothing.
    press(controller, 'd')
    expect(types(controller)).toHaveLength(3)
    press(controller, 'd')
    expect(types(controller)).toEqual(['code', 'markdown'])
    press(controller, 'z')
    await flush()
    expect(types(controller)).toEqual(['code', 'raw', 'markdown'])
    press(controller, 'y')
    expect(controller.getState().mode).toBe('command')
    press(controller, 'Enter')
    expect(controller.getState().mode).toBe('edit')
    // Command keys do nothing while editing.
    expect(press(controller, 'b')).toBe(false)
  })

  it('extends the selection with Shift and acts on every selected cell', async () => {
    const { controller } = await open()
    press(controller, 'b')
    press(controller, 'b')
    press(controller, 'ArrowUp')
    press(controller, 'ArrowUp')
    press(controller, 'ArrowDown', { shiftKey: true })
    expect(controller.getState().selected).toHaveLength(2)
    press(controller, 'm')
    expect(types(controller)).toEqual(['markdown', 'markdown', 'code'])
    press(controller, 'm', { shiftKey: true })
    expect(types(controller)).toEqual(['markdown', 'code'])
    press(controller, 'a', { metaKey: true })
    expect(controller.getState().selected).toHaveLength(2)
  })

  it('advances with Shift+Enter and adds a cell after the last', async () => {
    const { controller } = await open()
    press(controller, 'Enter')
    controller.advance()
    expect(controller.getState().cells).toHaveLength(2)
    expect(controller.getState().mode).toBe('edit')
    expect(controller.getState().active).toBe(controller.getState().cells[1]!.key)
  })

  it('undoes only its own edits', async () => {
    const { doc, controller } = await open()
    const other = new Y.Doc()
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc))
    controller.insert('below', 'markdown')
    // Someone else adds text to the first cell.
    ;(orderedCells(other)[0]!.cell.get('source') as Y.Text).insert(0, 'theirs')
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(other, Y.encodeStateVector(doc)))
    controller.undo()
    await flush()
    expect(controller.getState().cells).toHaveLength(1)
    expect(cellSourceText(orderedCells(doc)[0]!.cell)).toBe('theirs')
    controller.redo()
    await flush()
    expect(controller.getState().cells).toHaveLength(2)
  })

  it('copies cells into another notebook with their images', async () => {
    const from = await open(new Uint8Array(readFileSync(FIXTURE)))
    const plot = from.controller.getState().cells[3]!
    from.controller.select(plot.key)
    expect(from.controller.copy()).toContain('plt.subplots')
    const to = await open()
    expect(to.controller.getState().canPaste).toBe(true)
    to.awareness.setLocalStateField('user', { name: 'Ana', color: '#3366ff' })
    await to.controller.paste('below')
    const pasted = to.controller.getState().cells[1]!
    expect(pasted.outputs!.assets.length).toBeGreaterThan(0)
    const outputs = await readOutputs(pasted.outputs!, to.assets)
    expect(outputs.some((output) => output.type === 'display_data' && typeof output.data['image/png'] === 'string')).toBe(true)
  })

  it('keeps the active cell close when it is deleted elsewhere, and shows where others are', async () => {
    const { doc, awareness, controller } = await open()
    press(controller, 'b')
    press(controller, 'b')
    const [first, second, third] = controller.getState().cells.map((cell) => cell.key)
    controller.select(second!)
    cellsMap(doc).delete(second!)
    await flush()
    expect(controller.getState().active).toBe(third)
    const peer = new Awareness(new Y.Doc())
    peer.setLocalState({ user: { name: 'Bo', color: '#ff0000' }, notebook: { cell: first, mode: 'edit' } })
    awareness.setLocalStateField('notebook', null)
    const { encodeAwarenessUpdate, applyAwarenessUpdate } = await import('y-protocols/awareness')
    applyAwarenessUpdate(awareness, encodeAwarenessUpdate(peer, [peer.clientID]), 'remote')
    expect(controller.getState().peers[first!]).toEqual([{ clientId: peer.clientID, name: 'Bo', color: '#ff0000', mode: 'edit' }])
  })

  it('changes nothing when read only', async () => {
    const { doc, controller } = await open()
    controller.setReadOnly(true)
    const state = Y.encodeStateAsUpdate(doc)
    for (const key of ['a', 'b', 'm', 'y', 'x', 'v', 'z', 'o']) press(controller, key)
    press(controller, 'd')
    press(controller, 'd')
    controller.setMode('edit')
    expect(controller.getState().mode).toBe('command')
    expect(Y.encodeStateAsUpdate(doc)).toEqual(state)
  })
})
