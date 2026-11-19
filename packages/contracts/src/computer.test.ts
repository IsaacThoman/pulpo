import { describe, expect, it } from 'vitest'
import {
  COMPUTER_INLINE_MAX_BYTES, COMPUTER_TRANSFER_TIMEOUT_MS, computerMethods, computerRequestSchema, computerSelectionSchema,
  computerTransferSchema, computerTransferTimeoutMs, isComputerFolderMode,
} from './computer.js'
import { clientFeaturesHeaderValue, CLIENT_FEATURES_HEADER_VALUE, parseClientFeaturesHeader } from './admin-analytics.js'

const sessionId = '6f0c2a7e-1d6b-4c43-9a51-0d3c5b7f2a10'

describe('computer selection', () => {
  it('needs a folder for every access mode but full', () => {
    expect(computerSelectionSchema.safeParse({ sessionId, access: 'full', folder: null }).success).toBe(true)
    expect(computerSelectionSchema.safeParse({ sessionId, access: 'full', folder: '/Users/me/site' }).success).toBe(true)
    for (const access of ['read', 'suggest', 'write']) {
      expect(computerSelectionSchema.safeParse({ sessionId, access, folder: null }).success).toBe(false)
      expect(computerSelectionSchema.safeParse({ sessionId, access, folder: '/Users/me/site' }).success).toBe(true)
    }
    expect(computerSelectionSchema.safeParse({ sessionId: 'nope', access: 'full', folder: null }).success).toBe(false)
    expect(isComputerFolderMode('full')).toBe(false)
    expect(isComputerFolderMode('suggest')).toBe(true)
  })
})

describe('computer requests', () => {
  it('accepts only transfer URLs under the transfer path', () => {
    expect(computerTransferSchema.safeParse({ url: '/api/computer/transfers/abc?token=t' }).success).toBe(true)
    for (const url of ['https://evil.example/api/computer/transfers/abc', '/api/files/abc', '/api/computer/transfers/../../admin']) {
      expect(computerTransferSchema.safeParse({ url }).success).toBe(false)
    }
  })

  it('takes a file\'s bytes inline or through a transfer, never both or neither', () => {
    const put = (extra: Record<string, unknown>) => computerMethods['folder.change'].params.safeParse({
      responseId: sessionId, change: { kind: 'put', path: 'a.txt', sizeBytes: 1, base: null, ...extra },
    }).success
    expect(put({ data: 'YQ==' })).toBe(true)
    expect(put({ transfer: { url: '/api/computer/transfers/abc?token=t' } })).toBe(true)
    expect(put({})).toBe(false)
    expect(put({ data: 'YQ==', transfer: { url: '/api/computer/transfers/abc?token=t' } })).toBe(false)
    expect(put({ data: 'A'.repeat(Math.ceil(COMPUTER_INLINE_MAX_BYTES / 3) * 4 + 100) })).toBe(false)
  })

  it('knows only its own methods', () => {
    const request = { id: sessionId, sessionId, params: {}, timeoutMs: 1_000 }
    expect(computerRequestSchema.safeParse({ ...request, method: 'describe' }).success).toBe(true)
    expect(computerRequestSchema.safeParse({ ...request, method: 'shell.exec' }).success).toBe(false)
  })

  it('gives a big file longer to travel, up to an hour', () => {
    expect(computerTransferTimeoutMs(1_000)).toBe(COMPUTER_TRANSFER_TIMEOUT_MS)
    expect(computerTransferTimeoutMs(500 * 1024 * 1024)).toBe(2_098_000)
    expect(computerTransferTimeoutMs(10_000 * 1024 * 1024)).toBe(3_600_000)
  })
})

describe('client features', () => {
  it('lists computer only for a client that adds it', () => {
    expect(CLIENT_FEATURES_HEADER_VALUE).toBe('files-permission')
    expect(clientFeaturesHeaderValue(['computer'])).toBe('files-permission,computer')
    expect(parseClientFeaturesHeader('files-permission, computer, something-new')).toEqual(['files-permission', 'computer'])
  })
})
