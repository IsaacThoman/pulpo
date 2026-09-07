// Real mobile API/auth/multipart/draft routes with a deterministic Groq response.
// Run only against the disposable database and Redis described in dictation-validation.md.
import http from 'node:http'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
if (process.env.POSTGRES_DATABASE !== 'pulpo_mobile_dictation_e2e' || process.env.REDIS_URL !== 'redis://localhost:6396'
  || process.env.PUBLIC_URL !== 'http://localhost:8096' || process.env.PORT !== '8096' || process.env.HOST !== '127.0.0.1') {
  throw new Error('Use the isolated dictation fixture environment from dictation-validation.md')
}
process.env.STORAGE_DRIVER = 'local'
process.env.STORAGE_LOCAL_PATH = join(tmpdir(), 'pulpo-mobile-dictation-e2e-objects')
const state = { mode: 'success', text: 'Hello from mobile dictation.', requests: [] }
const realFetch = globalThis.fetch
globalThis.fetch = async (url, options) => {
  if (String(url) !== 'https://api.groq.com/openai/v1/audio/transcriptions') return realFetch(url, options)
  const { mode, text } = state
  const file = options.body.get('file')
  const audio = Buffer.from(await file.arrayBuffer())
  const request = { bytes: audio.length, mimeType: file.type, filename: file.name, m4a: audio.subarray(4, 8).toString() === 'ftyp', mode }
  state.requests.push(request)
  assert.equal(file.type, 'audio/mp4')
  assert.equal(request.m4a, true)
  assert(audio.length > 0)
  if (mode === 'slow') await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, 20_000)
    options.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')) }, { once: true })
  })
  if (mode === 'failure') return Response.json({ error: { message: 'Injected provider failure' } }, { status: 500 })
  if (mode === 'rate-limit') return Response.json({ error: { message: 'Busy' } }, { status: 429 })
  return Response.json({ text: mode === 'no-speech' ? '' : text, duration: 3.1 })
}
const { db, queryClient } = await import('../../server/dist/database/client.js')
const { applicationSettings, providerConnections, models, modelPricingVersions } = await import('../../server/dist/database/schema.js')
const { encryptSecret } = await import('../../server/dist/lib/crypto.js')
const { getConfig } = await import('../../server/dist/config.js')
const { buildApp } = await import('../../server/dist/app.js')
const { createSocketServer } = await import('../../server/dist/realtime/socket.js')
const { redis } = await import('../../server/dist/redis.js')
const settings = { enabled: true, encryptedGroqApiKey: encryptSecret('dictation-test-only', getConfig().ENCRYPTION_KEY), billUsers: false, pricePerMinuteMicros: 0 }
await db.insert(applicationSettings).values({ key: 'dictation', value: settings }).onConflictDoUpdate({ target: applicationSettings.key, set: { value: settings } })
const providerId = 'e1744b14-b9fa-4cbf-97ab-2f8334684ce5'
await db.insert(providerConnections).values({ id: providerId, name: 'Dictation fixture', baseUrl: 'http://127.0.0.1:8098/v1',
  encryptedApiKey: encryptSecret('test-only', getConfig().ENCRYPTION_KEY) }).onConflictDoNothing()
await db.insert(models).values({ id: 'dictation-test', providerConnectionId: providerId, upstreamModelId: 'dictation-test',
  name: 'Dictation Test', contextWindow: 32000, maxOutputTokens: 1000, compactionEnabled: false }).onConflictDoNothing()
await db.insert(modelPricingVersions).values({ id: '6167ba0a-8251-4f50-b5f5-a88536679744', modelId: 'dictation-test',
  inputPriceMicros: 0, cachedInputPriceMicros: 0, cacheWritePriceMicros: 0, outputPriceMicros: 0 }).onConflictDoNothing()
const app = await buildApp()
const io = await createSocketServer(app.server)
await app.listen({ host: '127.0.0.1', port: 8096 })
const config = await realFetch('http://localhost:8096/api/mobile/config').then((response) => response.json())
if (config.setupRequired) {
  const result = await realFetch('http://localhost:8096/api/mobile/auth/setup', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Dictation Tester', username: 'dictation_tester', email: 'dictation@example.test', password: 'Dictation-test-only-2026', deviceLabel: 'Dictation fixture' }) })
  assert.equal(result.status, 201, await result.text())
}
const control = http.createServer(async (request, response) => {
  if (request.method === 'POST') {
    let body = ''; for await (const chunk of request) body += chunk
    const input = JSON.parse(body || '{}')
    if (['success', 'slow', 'failure', 'no-speech', 'rate-limit'].includes(input.mode)) state.mode = input.mode
    if (typeof input.text === 'string') state.text = input.text
    if (input.reset) state.requests = []
  }
  response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(state))
}).listen(8097, '127.0.0.1')
console.log('Dictation fixture ready: API 8096, control 8097. No real Groq requests or retained recordings.')
async function shutdown() {
  control.close(); io.disconnectSockets(true); io.close(); await app.close(); await queryClient.end(); await redis.quit(); process.exit(0)
}
process.on('SIGTERM', () => { void shutdown() })
process.on('SIGINT', () => { void shutdown() })
