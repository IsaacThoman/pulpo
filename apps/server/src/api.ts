import { getConfig } from './config.js'
import { buildApp } from './app.js'
import { createSocketServer } from './realtime/socket.js'

const config = getConfig()
const app = await buildApp()
await createSocketServer(app.server)

await app.listen({ host: config.HOST, port: config.PORT })
