import { parseConfig } from './config.js'
import { createConverterServer } from './server.js'
import { convertWithSoffice, prepareTemplateProfile } from './soffice.js'

const config = parseConfig(process.env)
let templateProfile = ''
const { server, setReady } = createConverterServer(config, (job) => convertWithSoffice(config, templateProfile, job))

server.listen(config.port, config.host, () => {
  console.log(`office-converter: listening on ${config.host}:${config.port}`)
})

try {
  templateProfile = await prepareTemplateProfile(config)
  setReady(true)
  console.log('office-converter: LibreOffice is ready')
} catch (error) {
  console.error('office-converter: LibreOffice failed to start', error)
  process.exit(1)
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    setReady(false)
    // Running jobs finish (each is bounded by its timeout); the container is stopped after that.
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), config.timeoutMs + 5_000).unref()
  })
}
