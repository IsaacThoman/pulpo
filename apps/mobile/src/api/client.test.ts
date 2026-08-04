import { afterEach, describe, expect, it } from 'vitest'
import { apiUrl, configureApi, nativeAuthorizationHeaders } from './client'

describe('attachment URL resolution', () => {
  afterEach(() => configureApi({ instanceUrl: 'https://pulpo.baby', token: null }))

  it('resolves local blob-store paths against the configured instance', () => {
    configureApi({ instanceUrl: 'https://chat.example.test', token: 'session-token' })

    expect(apiUrl('/api/attachments/local-download/file-key'))
      .toBe('https://chat.example.test/api/attachments/local-download/file-key')
    expect(nativeAuthorizationHeaders('/api/attachments/local-download/file-key'))
      .toEqual({ authorization: 'Bearer session-token' })
  })

  it('does not send the session token to an external signed URL', () => {
    configureApi({ instanceUrl: 'https://chat.example.test', token: 'session-token' })

    expect(apiUrl('https://objects.example.test/signed-file')).toBe('https://objects.example.test/signed-file')
    expect(nativeAuthorizationHeaders('https://objects.example.test/signed-file')).toEqual({})
  })
})
