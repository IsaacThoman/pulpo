import { afterEach, describe, expect, it, vi } from 'vitest'
import { readClipboard, writeClipboard } from './clipboard-io.js'

afterEach(() => vi.unstubAllGlobals())

describe('presentation system clipboard', () => {
  it('writes plain text asynchronously when custom formats are rejected', async () => {
    const write = vi.fn().mockRejectedValue(new Error('Custom formats unsupported'))
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { write, writeText } })
    vi.stubGlobal('ClipboardItem', class {})
    const copied = { json: 'picture payload', text: '' }
    await writeClipboard(copied)
    expect(write).toHaveBeenCalledOnce()
    expect(writeText).toHaveBeenCalledWith('')
    expect(await readClipboard('')).toBe(copied.json)
  })

  it('uses writeText when custom clipboard writing is unavailable', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await writeClipboard({ json: 'shape payload', text: 'shape text' })
    expect(writeText).toHaveBeenCalledWith('shape text')
    expect(await readClipboard('shape text')).toBe('shape payload')
  })

  it('propagates denied writes and preserves the last successful in-app copy', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await writeClipboard({ json: 'previous payload', text: 'same text' })
    writeText.mockRejectedValue(new Error('Permission denied'))
    await expect(writeClipboard({ json: 'uncopied payload', text: 'same text' })).rejects.toThrow('Permission denied')
    expect(await readClipboard('same text')).toBe('previous payload')
  })

  it('fails when neither clipboard write API is available', async () => {
    vi.stubGlobal('navigator', { clipboard: {} })
    await expect(writeClipboard({ json: 'uncopied payload', text: '' })).rejects.toThrow()
  })
})
