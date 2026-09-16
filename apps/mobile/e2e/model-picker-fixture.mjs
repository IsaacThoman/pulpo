// Isolated native UI fixture: no production accounts, database, or model calls.
// EXPO_PUBLIC_DEFAULT_INSTANCE_URL=http://localhost:8091; login below.
import http from 'node:http'
import { Server } from 'socket.io'
const user = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Picker QA', username: 'picker_qa', email: 'picker@example.test', role: 'user', avatarUrl: null, profileColor: null, blocked: false, stateRevision: 0, storageLimitBytes: 10485760, createdAt: '2026-09-15T00:00:00Z', balanceMicros: 1000000 }
const values = { favoriteModelIds: ['picker-a', 'picker-b'], providerOrder: ['lab-b', 'lab-a'], defaultModelId: 'picker-a', composerSyncEnabled: false, automaticChatExpiration: 'disabled', showPromptSuggestions: false }
const models = [
  ['picker-a', 'Picker Alpha', 'lab-a', 'Lab Alpha'],
  ['picker-b', 'Picker Beta', 'lab-b', 'Lab Beta'],
  ['picker-c', 'Picker Gamma', 'lab-b', 'Lab Beta'],
].map(([id, name, labId, labName]) => ({ id, name, description: 'Native picker validation', executionMode: 'stream', maxOutputTokens: 1000, agentEnabled: false, tags: [], logo: null, iconLight: null, iconDark: null, provider: { id: labId, name: labName }, lab: { id: labId, name: labName, logo: 'openai' }, presets: [] }))
const handleRequest = async (req, res) => {
  const url = new URL(req.url, 'http://localhost:8091')
  let body = ''; for await (const chunk of req) body += chunk
  const input = body ? JSON.parse(body) : {}
  const send = (data, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)) }
  console.log(req.method, url.pathname)
  if (url.pathname === '/api/mobile/config') return send({ mobileApiVersion: 1, instance: { name: 'Picker QA', version: 'test', publicUrl: 'http://localhost:8091' }, setupRequired: false, auth: { signupEnabled: false, pendingDetails: false, adminEmail: '', pendingMessage: '' }, limits: { maxInlineImages: 6, maxAttachmentBytes: 10485760 }, capabilities: { bearerSessions: true, realtime: true, chatDuplication: true, publicSharing: true, attachments: true, folders: true, passkeys: false, dictation: false } })
  if (url.pathname === '/api/mobile/auth/login') {
    if (input.email !== 'picker@example.test' || input.password !== 'Picker-test-only-2026') return send({ error: { message: 'Use the disposable picker fixture credentials.' } }, 401)
    return send({ user, session: { token: 'picker-fixture-session', expiresAt: '2027-01-01T00:00:00Z' } })
  }
  if (req.headers.authorization !== 'Bearer picker-fixture-session') return send({ error: { message: 'Fixture login required.' } }, 401)
  if (url.pathname === '/api/mobile/me') return send({ user })
  if (url.pathname === '/api/models') return send({ agentAvailable: false, data: models })
  if (url.pathname === '/api/interface/suggested-prompts') return send({ enabled: false, count: 0, prompts: [] })
  if (url.pathname === '/api/shelved-drafts') return send({ revision: 0, drafts: [] })
  if (url.pathname === '/api/settings') {
    if (req.method === 'PATCH') Object.assign(values, input)
    return send({ values, updatedAt: new Date().toISOString() })
  }
  if (['/api/chats', '/api/chats/deleted', '/api/folders'].includes(url.pathname)) return send({ data: [] })
  if (url.pathname.includes('draft')) return send({ draft: null })
  return send({ data: [] })
}
const server = http.createServer(handleRequest)
const ipv6Server = http.createServer(handleRequest)
const io = new Server(server)
io.attach(ipv6Server)
io.on('connection', (socket) => { socket.onAny((event, ...args) => {
  const ack = args.at(-1)
  if (typeof ack === 'function') ack(event === 'client.sync'
    ? { accountRevision: 0, invalidate: [], snapshots: [], events: [] }
    : { ok: true })
}) })
server.listen(8091, '127.0.0.1', () => console.log('Picker UI fixture on http://localhost:8091'))

ipv6Server.listen(8091, '::1')
