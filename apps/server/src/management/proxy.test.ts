import Fastify, { type FastifyRequest } from 'fastify'
import { request as httpRequest } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ManagementScope } from '@pulpo/contracts'
import { proxyTargetUrl, registerManagementRoutes } from './routes.js'

describe('proxyTargetUrl', () => {
  const source = '/api/management/v1/usage'
  const target = '/api/admin/usage'

  it('maps the prefix and keeps the rest of the path and query', () => {
    expect(proxyTargetUrl(source, source, target)).toBe(target)
    expect(proxyTargetUrl(`${source}/requests/a%2Fb?limit=5`, source, target)).toBe(`${target}/requests/a%2Fb?limit=5`)
  })

  it('rejects paths that resolve outside the target prefix', () => {
    for (const url of [`${source}/../settings`, `${source}/%2e%2e/settings`, `${source}/%2E%2E/%2e%2e/admin/settings`, `${source}/x/../../restore`]) {
      expect(proxyTargetUrl(url, source, target), url).toBeNull()
    }
  })

  it('rejects lookalike prefixes', () => {
    expect(proxyTargetUrl('/api/management/v1/usage-extra', source, target)).toBeNull()
  })
})

describe('management proxy', () => {
  let scopes: ManagementScope[]
  let server: ReturnType<typeof Fastify>
  const admin = vi.fn((request: FastifyRequest) => ({ url: request.url, method: request.method }))

  beforeEach(async () => {
    admin.mockClear()
    scopes = ['usage:read']
    server = Fastify()
    server.addHook('preHandler', async (request: FastifyRequest) => {
      request.user = { id: 'admin', role: 'admin', blocked: false } as FastifyRequest['user']
      request.managementTokenId = 'token'
      request.managementScopes = scopes
    })
    server.all('/api/admin/*', admin)
    await registerManagementRoutes(server)
  })
  afterEach(async () => { await server.close() })

  it('forwards reads inside the scoped resource', async () => {
    const response = await server.inject('/api/management/v1/usage/summary')
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ url: '/api/admin/usage/summary', method: 'GET' })
  })

  it('does not let a scoped token traverse into other admin routes', async () => {
    // Over real HTTP the dot segments reach the router unresolved; app.inject would normalize them.
    await server.listen({ port: 0, host: '127.0.0.1' })
    const { port } = server.server.address() as AddressInfo
    const send = (method: string, path: string) => new Promise<number>((resolve, reject) => {
      const outgoing = httpRequest({ host: '127.0.0.1', port, method, path }, (response) => { response.resume(); resolve(response.statusCode ?? 0) })
      outgoing.on('error', reject)
      outgoing.end()
    })
    for (const path of ['/api/management/v1/usage/../settings', '/api/management/v1/usage/%2e%2e/settings']) {
      for (const method of ['GET', 'PATCH']) expect(await send(method, path), `${method} ${path}`).toBeGreaterThanOrEqual(400)
    }
    expect(admin).not.toHaveBeenCalled()
  })

  it('treats usage and audit as read-only', async () => {
    scopes = ['usage:read', 'audit:read', 'operations:write']
    for (const url of ['/api/management/v1/usage/workspaces/lease', '/api/management/v1/audit-events/x']) {
      expect((await server.inject({ method: 'DELETE', url })).statusCode).toBe(405)
    }
    expect(admin).not.toHaveBeenCalled()
  })
})
