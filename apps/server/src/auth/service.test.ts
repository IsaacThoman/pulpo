import { describe, expect, it } from 'vitest'
import type { FastifyRequest } from 'fastify'
import { bearerSessionToken, billingUserForRequest, requestSessionToken, requireUser } from './service.js'

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

describe('administrator chat identity', () => {
  it('uses the owner for content authorization and the administrator for billing', () => {
    const owner = { id: 'owner', role: 'user', blocked: true }
    const actor = { id: 'admin', role: 'admin', blocked: false }
    const scoped = {
      user: owner,
      adminChatAccess: {
        accessId: 'access', actorUser: actor, ownerUser: owner, chatId: 'chat', expiresAt: new Date().toISOString(),
      },
    } as unknown as FastifyRequest

    expect(requireUser(scoped).id).toBe(owner.id)
    expect(billingUserForRequest(scoped).id).toBe(actor.id)
  })
})
