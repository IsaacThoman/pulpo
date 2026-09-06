import { getConfig } from './config.js'
import { buildApp } from './app.js'
import { createSocketServer } from './realtime/socket.js'
import { queryClient } from './database/client.js'
import { redis } from './redis.js'
import { checkReadiness } from './runtime-health.js'

const config = getConfig()
const app = await buildApp()
const io = await createSocketServer(app.server)
let stopping = false

app.get('/ready', async (_request, reply) => {
  if (stopping) return reply.code(503).send({ status: 'stopping' })
  try {
    await checkReadiness([() => queryClient`select 1`, () => redis.ping()])
    return { status: 'ok', service: 'pulpo-api' }
  } catch {
    return reply.code(503).send({ status: 'unavailable' })
  }
})

const shutdown = async (signal: string) => {
  if (stopping) return
  stopping = true
  app.log.info({ signal }, 'API stopping')
  // Bound long HTTP streams; clients reconnect and replay persisted events.
  const deadline = setTimeout(() => process.exit(1), 25_000)
  deadline.unref()
  try {
    // Allow proxy health events to propagate before closing existing sockets.
    await new Promise((resolve) => setTimeout(resolve, 3_000))
    await Promise.all([
      app.close(),
      new Promise<void>((resolve) => io.close(() => resolve())),
    ])
    await Promise.all([queryClient.end(), redis.quit()])
    process.exit(0)
  } catch (error) {
    app.log.error({ error }, 'API shutdown failed')
    process.exit(1)
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

await app.listen({ host: config.HOST, port: config.PORT })
