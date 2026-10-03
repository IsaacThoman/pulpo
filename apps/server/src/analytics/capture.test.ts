import { describe, expect, it } from 'vitest'
import { attachmentKind, clientAttributionForRequest } from './capture.js'

describe('client attribution', () => {
  it('prefers API keys, then the client header, then the user agent', () => {
    expect(clientAttributionForRequest({ apiKeyId: 'key', headers: { 'x-pulpo-client': 'ios/1.0.0' } })).toEqual({ platform: 'api', version: null })
    expect(clientAttributionForRequest({ apiKeyId: null, headers: { 'x-pulpo-client': 'iOS/1.4.2' } })).toEqual({ platform: 'ios', version: '1.4.2' })
    expect(clientAttributionForRequest({ apiKeyId: null, headers: { 'user-agent': 'Mozilla/5.0 Electron/38.0.0' } })).toEqual({ platform: 'desktop', version: null })
    expect(clientAttributionForRequest({ apiKeyId: null, headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64)' } })).toEqual({ platform: 'web', version: null })
    expect(clientAttributionForRequest({ apiKeyId: null, headers: { 'user-agent': 'okhttp/4.12' } })).toEqual({ platform: 'unknown', version: null })
  })

  it('ignores clients that claim to be the API', () => {
    expect(clientAttributionForRequest({ apiKeyId: null, headers: { 'x-pulpo-client': 'api', 'user-agent': 'curl/8' } })).toEqual({ platform: 'unknown', version: null })
  })
})

describe('attachment kinds', () => {
  it.each([
    ['image/png', 'image'], ['application/pdf', 'pdf'], ['text/markdown', 'text'], ['application/json', 'text'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'document'], ['application/zip', 'archive'],
    ['audio/mpeg', 'audio'], ['application/octet-stream', 'other'],
  ])('classifies %s as %s', (mimeType, kind) => {
    expect(attachmentKind(mimeType)).toBe(kind)
  })
})
