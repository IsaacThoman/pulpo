import { getConfig } from './config.js'

const config = getConfig()
console.info(JSON.stringify({ level: 'info', service: 'pulpo-worker', event: 'worker.started', environment: config.NODE_ENV }))

const shutdown = (signal: string) => {
  console.info(JSON.stringify({ level: 'info', service: 'pulpo-worker', event: 'worker.stopping', signal }))
  process.exit(0)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
