import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: class {}, dialog: {}, ipcMain: { handle: vi.fn() } }))

import { validComputerUpdate } from './ipc'

describe('validComputerUpdate', () => {
  it('accepts only known fields with valid values', () => {
    expect(validComputerUpdate({ enabled: true, name: ' Studio ', accessMode: 'full', approvalPolicy: 'never', allowRemote: false, rootPath: null }))
      .toEqual({ enabled: true, name: 'Studio', accessMode: 'full', approvalPolicy: 'never', allowRemote: false, rootPath: null })
    expect(validComputerUpdate({ rootPath: '/Users/me/code', unknown: 'ignored' })).toEqual({ rootPath: '/Users/me/code' })
  })

  it('rejects malformed input from the renderer', () => {
    expect(() => validComputerUpdate(null)).toThrow()
    expect(() => validComputerUpdate({ enabled: 'yes' })).toThrow()
    expect(() => validComputerUpdate({ accessMode: 'everything' })).toThrow()
    expect(() => validComputerUpdate({ approvalPolicy: 'ask-sometimes' })).toThrow()
    expect(() => validComputerUpdate({ name: '' })).toThrow()
    expect(() => validComputerUpdate({ rootPath: '' })).toThrow()
  })
})
