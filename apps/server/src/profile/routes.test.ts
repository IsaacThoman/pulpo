import Fastify, { type FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import sharp from 'sharp'
import { DEFAULT_AVATAR_CROP } from '@pulpo/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '../lib/errors.js'

const mocks = vi.hoisted(() => ({
  put: vi.fn(), get: vi.fn(), delete: vi.fn(), transaction: vi.fn(), select: vi.fn(),
  requireUser: vi.fn(), publish: vi.fn(), updates: {} as Record<string, unknown>,
}))
vi.mock('../auth/service.js', () => ({ requireUser: mocks.requireUser, serializeUser: (user: unknown) => user }))
vi.mock('../database/client.js', () => ({ db: { select: mocks.select, transaction: mocks.transaction } }))
vi.mock('../storage/index.js', () => ({ getBlobStore: () => ({ put: mocks.put, get: mocks.get, delete: mocks.delete }) }))
vi.mock('../responses/events.js', () => ({ publishStateChange: mocks.publish }))
vi.mock('../friends/sync.js', () => ({ friendPeerIds: async () => [], bumpAccountRevisions: async () => [], publishScopedStateChanges: vi.fn() }))
import { registerProfileRoutes } from './routes.js'
import { PROFILE_AVATAR_MAX_BYTES } from './avatar.js'

const id = '11111111-1111-4111-8111-111111111111'
let app: FastifyInstance
beforeEach(async () => {
  vi.clearAllMocks()
  mocks.requireUser.mockReturnValue({ id })
  mocks.put.mockResolvedValue(undefined)
  mocks.delete.mockResolvedValue(undefined)
  mocks.select.mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [{ key: 'avatar.webp', version: 3 }] }) }) })
  mocks.transaction.mockImplementation(async (callback) => callback({
    execute: vi.fn(),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id, avatarVersion: 2, avatarObjectKey: 'previous.webp' }] }) }) }),
    update: () => ({ set: (updates: Record<string, unknown>) => {
      mocks.updates = updates
      return { where: () => ({ returning: async () => [{ id, ...updates, stateRevision: 7 }] }) }
    } }),
  }))
  app = Fastify()
  await app.register(multipart)
  app.setErrorHandler((error, _request, reply) => reply.code(error instanceof AppError ? error.statusCode : 400).send({ code: error instanceof AppError ? error.code : 'invalid_request' }))
  await registerProfileRoutes(app)
})
afterEach(async () => app.close())

function upload(bytes: Buffer, crop?: string, mime = 'image/gif') {
  const boundary = 'avatar-test-boundary'
  const fields = crop === undefined ? '' : `--${boundary}\r\nContent-Disposition: form-data; name="crop"\r\n\r\n${crop}\r\n`
  return app.inject({ method: 'PUT', url: '/api/me/avatar', headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: Buffer.concat([
    Buffer.from(`${fields}--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="avatar.gif"\r\nContent-Type: ${mime}\r\n\r\n`),
    bytes, Buffer.from(`\r\n--${boundary}--\r\n`),
  ]) })
}

async function gif() {
  const frames = await Promise.all(['red', 'blue'].map((background) => sharp({ create: { width: 20, height: 10, channels: 4, background } }).raw().toBuffer()))
  return sharp(Buffer.concat(frames), { raw: { width: 20, height: 20, channels: 4, pageHeight: 10 } }).gif({ delay: [100, 200], loop: 3 }).toBuffer()
}

describe('profile avatar HTTP routes', () => {
  it('stores and serves cropped animated WebP with versioned caching', async () => {
    const response = await upload(await gif(), JSON.stringify({ ...DEFAULT_AVATAR_CROP, cropToCircle: false }))
    expect(response.statusCode).toBe(200)
    expect(mocks.updates.avatarVersion).toBe(3)
    const [key, bytes, options] = mocks.put.mock.calls[0]!
    expect(key).toMatch(new RegExp(`^users/${id}/avatar/.+\\.webp$`))
    expect(options).toEqual({ contentType: 'image/webp', contentLength: bytes.length })
    expect(await sharp(bytes, { animated: true }).metadata()).toMatchObject({ pages: 2, pageHeight: 512, delay: [100, 200], loop: 3 })
    expect(mocks.delete).toHaveBeenCalledWith('previous.webp')
    expect(mocks.publish).toHaveBeenCalledWith({ userId: id, revision: 7 })
    mocks.get.mockResolvedValue(bytes)
    const fetched = await app.inject({ url: `/api/users/${id}/avatar?v=3` })
    expect(fetched.headers['content-type']).toBe('image/webp')
    expect(fetched.rawPayload).toEqual(bytes)
    const cached = await app.inject({ url: `/api/users/${id}/avatar?v=3`, headers: { 'if-none-match': fetched.headers.etag! } })
    expect(cached.statusCode).toBe(304)
    expect(mocks.get).toHaveBeenCalledTimes(1)
  })

  it('accepts legacy still-image uploads without crop metadata', async () => {
    const bytes = await sharp({ create: { width: 10, height: 20, channels: 4, background: 'red' } }).png().toBuffer()
    expect((await upload(bytes, undefined, 'image/png')).statusCode).toBe(200)
    expect(await sharp(mocks.put.mock.calls[0]![1]).metadata()).toMatchObject({ width: 512, height: 512 })
  })

  it('rejects invalid crop JSON before writing storage', async () => {
    expect((await upload(await gif(), '{bad')).json()).toEqual({ code: 'invalid_avatar_crop' })
    expect(mocks.put).not.toHaveBeenCalled()
  })

  it('reports oversized multipart uploads consistently', async () => {
    const response = await upload(Buffer.alloc(PROFILE_AVATAR_MAX_BYTES + 1))
    expect(response.statusCode).toBe(413)
    expect(response.json()).toEqual({ code: 'avatar_too_large' })
    expect(mocks.put).not.toHaveBeenCalled()
  })

  it('requires authentication before accepting an upload', async () => {
    mocks.requireUser.mockImplementationOnce(() => { throw new AppError(401, 'unauthorized', 'Authentication required') })
    expect((await upload(await gif())).statusCode).toBe(401)
    expect(mocks.put).not.toHaveBeenCalled()
  })
})
