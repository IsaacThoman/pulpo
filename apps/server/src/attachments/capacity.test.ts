import Fastify from 'fastify'
import rateLimit from '@fastify/rate-limit'
import { expect, it } from 'vitest'
import { attachmentRateLimit, withAttachmentCapacity } from './capacity.js'

it('refuses excess work and releases capacity after a failure', async () => {
  const app = Fastify()
  let release!: () => void
  let started!: () => void
  const ready = new Promise<void>((resolve) => { started = resolve })
  app.get('/', withAttachmentCapacity(1, async () => {
    started()
    await new Promise<void>((resolve) => { release = resolve })
    throw new Error('Storage unavailable')
  }))
  try {
    const first = app.inject('/').then((result) => result)
    await ready
    const busy = await app.inject('/')
    expect(busy.statusCode).toBe(503)
    expect(busy.headers['retry-after']).toBe('2')
    release()
    expect((await first).statusCode).toBe(500)
    const next = app.inject('/').then((result) => result)
    await new Promise((resolve) => setTimeout(resolve, 10))
    release()
    expect((await next).statusCode).toBe(500)
  } finally {
    await app.close()
  }
})

it('allows a 500-file batch without exhausting the ordinary API rate limit', async () => {
  const app = Fastify()
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' })
  app.get('/attachment', { config: attachmentRateLimit }, async () => ({ ok: true }))
  app.get('/chat', async () => ({ ok: true }))
  try {
    for (let index = 0; index < 500; index += 1) {
      expect((await app.inject('/attachment')).statusCode).toBe(200)
    }
    expect((await app.inject('/chat')).statusCode).toBe(200)
  } finally {
    await app.close()
  }
})
