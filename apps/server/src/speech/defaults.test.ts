import Fastify from 'fastify'
import { beforeEach, expect, it, vi } from 'vitest'
import { OPENAI_SPEECH_PRESET } from '@pulpo/contracts'

const mocks = vi.hoisted(() => ({ admin: true, value: undefined as unknown, rows: [] as unknown[], audit: vi.fn() }))
vi.mock('../auth/service.js', () => ({ requireAdmin: () => { if (!mocks.admin) throw Object.assign(new Error('Forbidden'), { statusCode: 403 }); return { id: 'admin' } } }))
vi.mock('../database/client.js', async () => {
  const { applicationSettings, auditEvents } = await import('../database/schema.js')
  const db = {
    select: () => {
      let table: unknown
      const chain = { from: (value: unknown) => { table = value; return chain }, innerJoin: () => chain, where: () => chain,
        limit: async () => table === applicationSettings ? (mocks.value === undefined ? [] : [{ value: mocks.value }]) : mocks.rows }
      return chain
    },
    insert: (table: unknown) => ({ values: (input: { value?: unknown }) => {
      if (table === auditEvents) { mocks.audit(input); return Promise.resolve() }
      return { onConflictDoUpdate: async () => { mocks.value = input.value } }
    } }),
    transaction: async (fn: (tx: unknown) => Promise<void>) => fn(db),
  }
  return { db }
})
import { registerSpeechDefaultsRoutes } from './defaults.js'
const app = async () => { const server = Fastify(); registerSpeechDefaultsRoutes(server); return server }
beforeEach(() => { mocks.admin = true; mocks.value = undefined; mocks.rows = [{ config: { ...OPENAI_SPEECH_PRESET, enabled: true }, enabled: true }]; mocks.audit.mockClear() })

it('starts without a default and persists, replaces, and clears an audited admin choice', async () => {
  const server = await app()
  expect((await server.inject('/api/admin/settings/speech')).json()).toEqual({ modelId: null })
  for (const modelId of ['first', 'second', null]) {
    const response = await server.inject({ method: 'PATCH', url: '/api/admin/settings/speech', payload: { modelId } })
    expect(response.statusCode, response.body).toBe(200)
    expect((await server.inject('/api/admin/settings/speech')).json()).toEqual({ modelId })
    expect(mocks.audit).toHaveBeenLastCalledWith(expect.objectContaining({ actorUserId: 'admin', action: 'settings.speech.update', metadata: { modelId } }))
  }
  await server.close()
})
it.each([{ rows: [] }, { rows: [{ config: { enabled: false }, enabled: true }] }, { rows: [{ config: { enabled: true }, enabled: false }] }])('rejects missing or disabled models/providers ($rows)', async ({ rows }) => {
  mocks.rows = rows
  const server = await app()
  const response = await server.inject({ method: 'PATCH', url: '/api/admin/settings/speech', payload: { modelId: 'speech' } })
  expect(response.statusCode).toBe(400)
  expect(mocks.value).toBeUndefined(); expect(mocks.audit).not.toHaveBeenCalled()
  await server.close()
})
it('requires admin access to read or change defaults', async () => {
  mocks.admin = false
  const server = await app()
  expect((await server.inject('/api/admin/settings/speech')).statusCode).toBe(403)
  expect((await server.inject({ method: 'PATCH', url: '/api/admin/settings/speech', payload: { modelId: 'speech' } })).statusCode).toBe(403)
  expect(mocks.value).toBeUndefined(); expect(mocks.audit).not.toHaveBeenCalled()
  await server.close()
})
it('rejects invalid IDs and unrelated settings', async () => {
  const server = await app()
  for (const payload of [{ modelId: '' }, { modelId: '../model' }, { modelId: 'speech', voice: 'injected' }]) {
    expect((await server.inject({ method: 'PATCH', url: '/api/admin/settings/speech', payload })).statusCode).toBeGreaterThanOrEqual(400)
  }
  expect(mocks.value).toBeUndefined(); expect(mocks.audit).not.toHaveBeenCalled()
  await server.close()
})
