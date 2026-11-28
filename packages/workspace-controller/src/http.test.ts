import { describe, expect, it } from 'vitest'
import { bearerTokenMatches, ClientRequestError, daemonRequestHeaders, decodePathSegment, kubernetesStatusCode, parseJsonBody } from './http.js'

describe('daemonRequestHeaders', () => {
  it('forwards upload preconditions with the daemon token instead of the caller token', () => {
    expect(daemonRequestHeaders({
      authorization: 'Bearer controller-token',
      'content-type': 'application/octet-stream',
      'content-length': '12',
      'x-pulpo-file-checksum': 'abc',
      'if-none-match': '*',
      cookie: 'not-forwarded',
    }, 'daemon-token')).toEqual({
      authorization: 'Bearer daemon-token',
      'content-type': 'application/octet-stream',
      'content-length': '12',
      'x-pulpo-file-checksum': 'abc',
      'if-none-match': '*',
    })
  })

  it('defaults to JSON and omits absent optional headers', () => {
    expect(daemonRequestHeaders({}, 'daemon-token')).toEqual({ authorization: 'Bearer daemon-token', 'content-type': 'application/json' })
  })
})

describe('bearerTokenMatches', () => {
  const token = 't'.repeat(40)
  it('accepts only the exact bearer token', () => {
    expect(bearerTokenMatches(`Bearer ${token}`, token)).toBe(true)
    expect(bearerTokenMatches(`Bearer ${token.slice(1)}x`, token)).toBe(false)
    expect(bearerTokenMatches(`Bearer ${token}x`, token)).toBe(false)
    expect(bearerTokenMatches('Bearer short', token)).toBe(false)
    expect(bearerTokenMatches(token, token)).toBe(false)
    expect(bearerTokenMatches(undefined, token)).toBe(false)
  })
})

describe('request parsing', () => {
  it('treats an empty body as an empty object', () => {
    expect(parseJsonBody(Buffer.alloc(0))).toEqual({})
    expect(parseJsonBody(Buffer.from('{"maxActiveWorkspaces":2}'))).toEqual({ maxActiveWorkspaces: 2 })
  })

  it('reports malformed JSON and path encoding as client errors', () => {
    expect(() => parseJsonBody(Buffer.from('{"chatId":'))).toThrow(ClientRequestError)
    expect(() => parseJsonBody(Buffer.from('null'))).toThrow(ClientRequestError)
    expect(() => parseJsonBody(Buffer.from('[1]'))).toThrow(ClientRequestError)
    expect(() => decodePathSegment('%E0%A4%A')).toThrow(ClientRequestError)
    expect(decodePathSegment('pulpo-workspace-%61b')).toBe('pulpo-workspace-ab')
  })
})

describe('kubernetesStatusCode', () => {
  it('reads the status from client-node errors', () => {
    expect(kubernetesStatusCode(Object.assign(new Error('gone'), { code: 404 }))).toBe(404)
    expect(kubernetesStatusCode({ statusCode: 409 })).toBe(409)
    expect(kubernetesStatusCode(new Error('network'))).toBeUndefined()
    expect(kubernetesStatusCode(undefined)).toBeUndefined()
  })
})
