import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  source: new Uint8Array(0),
  written: [] as Uint8Array[],
  created: [] as Array<{ name: string; mimeType: string | null }>,
  deleted: 0,
  closed: 0,
  pick: vi.fn(),
  failWrite: false,
  failOpen: false,
}))

vi.mock('expo-file-system', () => {
  class File {
    constructor(readonly uri: string) {}
    open() {
      if (state.failOpen) throw new Error('The file does not exist')
      let offset = 0
      return {
        readBytes: (length: number) => {
          const chunk = state.source.slice(offset, offset + length)
          offset += chunk.length
          return chunk
        },
        writeBytes: () => undefined,
        close: () => { state.closed += 1 },
      }
    }
  }
  class Destination {
    open() {
      return {
        readBytes: () => new Uint8Array(0),
        writeBytes: (bytes: Uint8Array) => {
          if (state.failWrite) throw new Error('Disk full')
          state.written.push(bytes)
        },
        close: () => { state.closed += 1 },
      }
    }
    delete() { state.deleted += 1 }
  }
  return {
    File,
    FileMode: { ReadOnly: 'r', WriteOnly: 'w' },
    Directory: {
      pickDirectoryAsync: state.pick,
    },
    __Destination: Destination,
  }
})

import * as FileSystem from 'expo-file-system'
import { saveFileToDevice } from './fileSaving.android'

const Destination = (FileSystem as unknown as { __Destination: new () => object }).__Destination

describe('Android save to device', () => {
  beforeEach(() => {
    state.source = new Uint8Array(3 * 1024 * 1024 + 5).map((_, index) => index % 251)
    state.written = []
    state.created = []
    state.deleted = 0
    state.closed = 0
    state.failWrite = false
    state.failOpen = false
    state.pick.mockReset()
    state.pick.mockResolvedValue({
      createFile: (name: string, mimeType: string | null) => {
        state.created.push({ name, mimeType })
        return new Destination()
      },
    })
  })

  it('copies the whole file into the picked folder under its name', async () => {
    await expect(saveFileToDevice('file:///cache/a/report.pdf', 'Q3 report.pdf', 'application/pdf')).resolves.toBe(true)
    expect(state.created).toEqual([{ name: 'Q3 report.pdf', mimeType: 'application/pdf' }])
    const written = new Uint8Array(state.written.reduce((sum, chunk) => sum + chunk.length, 0))
    state.written.reduce((offset, chunk) => { written.set(chunk, offset); return offset + chunk.length }, 0)
    expect(state.written.length).toBeGreaterThan(1)
    expect(written).toEqual(state.source)
    expect(state.closed).toBe(2)
  })

  it('resolves false when the folder picker is cancelled', async () => {
    state.pick.mockRejectedValue(Object.assign(new Error('The file picker was cancelled by the user'), { code: 'ERR_PICKER_CANCELLED' }))
    await expect(saveFileToDevice('file:///cache/a/report.pdf', 'report.pdf')).resolves.toBe(false)
    expect(state.created).toEqual([])
  })

  it('removes a partial copy when writing fails', async () => {
    state.failWrite = true
    await expect(saveFileToDevice('file:///cache/a/report.pdf', 'report.pdf')).rejects.toThrow('Disk full')
    expect(state.deleted).toBe(1)
    expect(state.closed).toBe(2)
  })

  it('leaves nothing in the folder when the source is gone', async () => {
    state.failOpen = true
    await expect(saveFileToDevice('file:///cache/a/report.pdf', 'report.pdf')).rejects.toThrow('The file does not exist')
    expect(state.created).toEqual([])
  })
})
