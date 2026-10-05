import type { FastifyRequest } from 'fastify'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../database/client.js', () => ({
  db: {
    select: vi.fn(() => {
      const builder = {
        from: vi.fn(() => builder),
        where: vi.fn(() => builder),
        limit: vi.fn(async () => [{ value: { filesEnabled: true } }]),
      }
      return builder
    }),
  },
}))
vi.mock('../auth/service.js', () => ({
  requireUser: (request: FastifyRequest) => request.user,
}))

import { requireFilesUser } from './request.js'

const owner = { id: 'owner-1', role: 'user' }

describe('requireFilesUser', () => {
  it('allows the account owner', async () => {
    const request = { user: owner, adminChatAccess: null } as unknown as FastifyRequest
    await expect(requireFilesUser(request)).resolves.toBe(owner)
  })

  it('rejects admin chat access, which never extends to the owner\'s Files', async () => {
    const request = {
      user: owner,
      adminChatAccess: { chatId: 'chat-1', actorUser: { id: 'admin-1' } },
    } as unknown as FastifyRequest
    await expect(requireFilesUser(request)).rejects.toMatchObject({ statusCode: 403, code: 'forbidden' })
  })
})
