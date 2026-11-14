// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { codeFileExtension, downloadBlob } from './code-download'

describe('codeFileExtension', () => {
  it.each([
    ['python', 'py'],
    ['TypeScript', 'ts'],
    ['tsx', 'tsx'],
    ['c++', 'cpp'],
    ['C#', 'cs'],
    ['bash', 'sh'],
    ['html', 'html'],
    ['yaml', 'yaml'],
    ['latex', 'tex'],
    ['', 'txt'],
    [undefined, 'txt'],
    ['brainfuck', 'txt'],
  ])('%s -> %s', (language, expected) => {
    expect(codeFileExtension(language)).toBe(expected)
  })
})

describe('downloadBlob', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it('keeps the object URL alive until the browser has started the download', () => {
    vi.useFakeTimers()
    const createObjectURL = vi.fn(() => 'blob:download')
    const revokeObjectURL = vi.fn()
    Object.assign(URL, { createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.href).toBe('blob:download')
      expect(this.download).toBe('notes.txt')
    })
    downloadBlob(new Blob(['hi']), 'notes.txt')
    expect(click).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(500)
    expect(revokeObjectURL).not.toHaveBeenCalled()
    vi.advanceTimersByTime(500)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:download')
  })
})
