import compress from '@fastify/compress'
import type { FastifyInstance } from 'fastify'

export async function registerResponseCompression(app: FastifyInstance): Promise<void> {
  await app.register(compress, {
    global: true,
    threshold: 1_024,
  })
}
