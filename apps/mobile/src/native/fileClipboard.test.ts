import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ copyFile: vi.fn(async () => undefined) }))

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }))
vi.mock('expo', () => ({
  NativeModule: class {},
  requireOptionalNativeModule: vi.fn(() => ({ copyFile: mocks.copyFile })),
}))

import { copyFile, supportsFileClipboard } from './fileClipboard'

describe('file clipboard wrapper', () => {
  beforeEach(() => mocks.copyFile.mockClear())

  it('publishes a local file through the optional Apple module', async () => {
    expect(supportsFileClipboard).toBe(true)
    await copyFile('file:///tmp/report.pdf')
    expect(mocks.copyFile).toHaveBeenCalledWith('file:///tmp/report.pdf')
  })
})
