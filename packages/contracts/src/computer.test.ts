import { describe, expect, it } from 'vitest'
import {
  COMPUTER_INLINE_MAX_BYTES, COMPUTER_TRANSFER_TIMEOUT_MS, computerAppStateSchema, computerDescriptionSchema, computerMethods, computerRequestSchema,
  computerSelectionSchema, computerTransferSchema, computerTransferTimeoutMs, isComputerFolderMode,
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

describe('app control', () => {
  const act = (action: Record<string, unknown>) => computerMethods['app.act'].params.safeParse({ app: 'TextEdit', action })

  it('clicks an element or a point, with a left single click unless told otherwise', () => {
    expect(act({ type: 'click', element: 3 }).data?.action).toEqual({ type: 'click', element: 3, button: 'left', count: 1 })
    expect(act({ type: 'click', x: 10, y: 20, button: 'right', count: 2 }).success).toBe(true)
    expect(act({ type: 'click' }).success).toBe(false)
    expect(act({ type: 'click', x: 10 }).success).toBe(false)
    expect(act({ type: 'click', element: 0 }).success).toBe(false)
    expect(act({ type: 'click', x: -1, y: 5 }).success).toBe(false)
  })

  it('refuses actions it does not know and ones that do nothing', () => {
    expect(act({ type: 'view' }).success).toBe(true)
    expect(act({ type: 'type', text: 'hello' }).success).toBe(true)
    expect(act({ type: 'type', text: '' }).success).toBe(false)
    expect(act({ type: 'type', text: 'x'.repeat(2_001) }).success).toBe(false)
    expect(act({ type: 'key', keys: 'cmd+s' }).success).toBe(true)
    expect(act({ type: 'scroll', dy: 3 }).data?.action).toEqual({ type: 'scroll', dx: 0, dy: 3 })
    expect(act({ type: 'scroll' }).success).toBe(false)
    expect(act({ type: 'drag', fromX: 1, fromY: 2, toX: 3, toY: 4 }).success).toBe(true)
    expect(act({ type: 'set_value', element: 2, value: '' }).success).toBe(true)
    expect(act({ type: 'run', command: 'rm -rf /' }).success).toBe(false)
  })

  it('carries a window\'s picture inline or by its path, never both or neither', () => {
    const state = (image: Record<string, unknown>) => computerAppStateSchema.safeParse({
      app: 'TextEdit', window: 'Untitled', elements: [], truncated: false,
      image: { mimeType: 'image/jpeg', width: 800, height: 600, sizeBytes: 3, ...image },
    }).success
    expect(state({ data: 'YWJj' })).toBe(true)
    expect(state({ path: '/Users/me/Library/pulpo/shot.jpg' })).toBe(true)
    expect(state({})).toBe(false)
    expect(state({ data: 'YWJj', path: '/tmp/shot.jpg' })).toBe(false)
  })

  it('is described only by apps that can do it', () => {
    const description = { os: 'macos', osVersion: 'macOS 15.2', arch: 'arm64', shell: 'zsh', home: '/Users/me', cwd: '/Users/me/Pulpo', attachmentsDir: '/Users/me/a' }
    expect(computerDescriptionSchema.parse(description).apps).toBeUndefined()
    expect(computerDescriptionSchema.parse({ ...description, apps: { version: 1, background: true } }).apps).toEqual({ version: 1, background: true })
  })
})

describe('client features', () => {
  it('lists computer only for a client that adds it', () => {
    expect(CLIENT_FEATURES_HEADER_VALUE).toBe('files-permission')
    expect(clientFeaturesHeaderValue(['computer'])).toBe('files-permission,computer')
    expect(parseClientFeaturesHeader('files-permission, computer, something-new')).toEqual(['files-permission', 'computer'])
  })
})
