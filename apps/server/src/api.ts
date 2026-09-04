import { getConfig } from './config.js'
import { buildApp } from './app.js'
import { createSocketServer } from './realtime/socket.js'
import { createNoteCollaborationServer } from './notes/collaboration.js'

const config = getConfig()
const app = await buildApp()
await createSocketServer(app.server)
const noteCollaboration = createNoteCollaborationServer(app.server)

await app.listen({ host: config.HOST, port: config.PORT })

const shutdown = async () => {
  noteCollaboration.flushPendingStores()
  await noteCollaboration.destroy()
  await app.close()
}
process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())
