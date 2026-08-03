import { describe, expect, it } from 'vitest'
import type { FastifyRequest } from 'fastify'
import { bearerSessionToken, requestSessionToken } from './service.js'

function request(cookie?: string, authorization?: string) {
  return {
    cookies: cookie ? { pulpo_session: cookie } : {},
    headers: { authorization },
  } as Pick<FastifyRequest, 'cookies' | 'headers'>
}

describe('session transports', () => {
  const bearer = 'b'.repeat(43)
  const cookie = 'c'.repeat(43)

  it('accepts a strict native bearer token', () => {
    expect(bearerSessionToken(`Bearer ${bearer}`)).toBe(bearer)
    expect(bearerSessionToken(`Basic ${bearer}`)).toBeUndefined()
    expect(bearerSessionToken(`bearer ${bearer}`)).toBeUndefined()
    expect(bearerSessionToken('Bearer short')).toBeUndefined()
  })

  it('uses browser cookies before authorization headers', () => {
    expect(requestSessionToken(request(cookie, `Bearer ${bearer}`))).toBe(cookie)
    expect(requestSessionToken(request(undefined, `Bearer ${bearer}`))).toBe(bearer)
  })
})
