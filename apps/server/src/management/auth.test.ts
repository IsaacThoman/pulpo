import { describe, expect, it } from 'vitest'
import type { FastifyRequest } from 'fastify'
import { requireInteractiveAdmin, requireInteractiveSession, requireManagementScope } from './auth.js'

function request(input: { scopes?: string[] | null; role?: 'pending' | 'user' | 'admin'; token?: boolean } = {}) {
  return {
    user: {
      id: crypto.randomUUID(), email: 'admin@example.com', name: 'Admin', role: input.role ?? 'admin',
      balanceMicros: 0, storageLimitBytes: 0, blocked: false, stateRevision: 0,
      createdAt: new Date().toISOString(),
    },
    managementTokenId: input.token ? crypto.randomUUID() : null,
    managementScopes: input.scopes ?? null,
  } as unknown as FastifyRequest
}

describe('management authorization', () => {
  it('grants interactive sessions their normal role permissions', () => {
    expect(requireManagementScope(request(), 'instance:write', { admin: true }).role).toBe('admin')
  })

  it('requires the exact scope and the owner current role for tokens', () => {
    expect(requireManagementScope(request({ token: true, scopes: ['instance:read'] }), 'instance:read', { admin: true }).role).toBe('admin')
    expect(() => requireManagementScope(request({ token: true, scopes: [] }), 'instance:read', { admin: true })).toThrow('lacks')
    expect(() => requireManagementScope(request({ token: true, scopes: ['instance:read'], role: 'user' }), 'instance:read', { admin: true })).toThrow('Administrator')
  })

  it('does not let automation tokens mint more tokens', () => {
    expect(() => requireInteractiveSession(request({ token: true, scopes: ['account:read'] }))).toThrow('cannot create')
  })

  it('requires an interactive admin for sensitive admin routes', () => {
    expect(() => requireInteractiveAdmin(request({ token: true, scopes: ['usage:read'] }))).toThrow('interactive administrator session')
    expect(requireInteractiveAdmin(request()).role).toBe('admin')
    expect(() => requireInteractiveAdmin(request({ role: 'user' }))).toThrow('Administrator access required')
  })
})
