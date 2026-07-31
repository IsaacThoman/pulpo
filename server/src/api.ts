import Fastify from 'fastify'
import helmet from '@fastify/helmet'
import { getConfig } from './config.js'

const config = getConfig()
const app = Fastify({ logger: { level: config.LOG_LEVEL } })

await app.register(helmet)
app.get('/health', async () => ({ status: 'ok', service: 'pulpo-api' }))

await app.listen({ host: config.HOST, port: config.PORT })
