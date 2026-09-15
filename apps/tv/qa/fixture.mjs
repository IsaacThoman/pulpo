// Disposable loopback API, exercising the production HTTP and Socket.IO clients.
// No production credentials, database, or model provider is used.
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
const require = createRequire(process.env.PULPO_TV_FIXTURE_MODULES ?? import.meta.url)
const { Server } = require('socket.io')
const port = Number(process.env.PULPO_TV_FIXTURE_PORT ?? 8371)
const token = 'pulpo_tv_fixture_session_token_00000000000000'
const CHAT = '11111111-1111-4111-8111-111111111111'
const FOLDER = '22222222-2222-4222-8222-222222222222'
const TURN = '33333333-3333-4333-8333-333333333333'
const FILE = '44444444-4444-4444-8444-444444444444'
const user = { id: '55555555-5555-4555-8555-555555555555', name: 'TV Tester', email: 'tv@example.test', role: 'member', stateRevision: 1 }
const models = [
  { id: 'test-model', name: 'Claude', provider: { id: 'test-provider', name: 'Anthropic' }, lab: null, agentEnabled: true, presets: [{ id: 'effort', name: 'Reasoning', defaultChoiceId: 'medium', choices: [{ id: 'medium', displayName: 'Medium', action: { type: 'none' } }, { id: 'high', displayName: 'High', action: { type: 'none' } }] }] },
  { id: 'second-model', name: 'GPT', provider: { id: 'other-provider', name: 'OpenAI' }, agentEnabled: false, presets: [] },
]
let chats, folders, settings, calls, mode, sessions, dedupe, timers = [], pendingChecks, twoFactor
function response(id, text, output = 'The coastline has quieter trails in the morning.\n\n**Start early**, bring water, and leave time to explore.\n\n```text\nMorning  →  Walk\nAfternoon  →  Lunch\n```') {
  return { id, parentResponseId: null, previousResponseId: null, userMessageId: id, modelId: 'test-model', status: 'completed', input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text }] }], output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: output }] }], presetSelections: {}, agentMode: false, usage: null, error: null, snapshot: { responseId: id, status: 'completed', sequence: 0 }, branches: { user: { ids: [id], index: 0 }, assistant: { ids: [id], index: 0 } }, createdAt: new Date().toISOString() }
}
function reset() {
  timers.forEach(clearTimeout); timers = []; calls = []; mode = 'normal'; dedupe = new Map(); pendingChecks = 0; twoFactor = false
  sessions = true
  settings = { theme: 'dark', showReasoning: true, defaultModelId: 'test-model', agentModes: { 'test-model': false } }
  folders = [{ id: FOLDER, name: 'Weekend', pinned: false, sortOrder: 0 }]
  const r = response(TURN, 'Plan a quiet weekend by the coast.')
  r.input[0].content.push({ type: 'input_file', attachment_id: FILE })
  chats = [{ id: CHAT, title: 'A weekend by the coast', modelId: 'test-model', pinned: false, folderId: null, temporary: false, activeResponseId: TURN, activeBranchLeafId: TURN, responses: [r], queuedMessages: [], attachments: [{ id: FILE, originalName: 'Pulpo.png', mimeType: 'image/png', sizeBytes: 3000 }], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }]
}
reset()
function summary(c) { const { responses, attachments, queuedMessages, ...rest } = c; return rest }
function activeChat(c) {
  const byID = new Map(c.responses.map(r => [r.id, r])); const lineage = []; let id = c.activeBranchLeafId
  while (id && byID.has(id)) { const r = byID.get(id); lineage.unshift(r); id = r.parentResponseId }
  return { ...c, responses: c.responses.map(r => lineage.includes(r) ? r : { ...r, input: [], output: [], detailAvailable: false }) }
}
function snapshot(r) { return { ...r.snapshot, responseId: r.id, status: r.status, output: r.output, error: r.error, updatedAt: new Date().toISOString() } }
function emit(c) { io.emit('chat.changed', { chatId: c.id, revision: ++user.stateRevision }) }
function begin(c, body, regenerated) {
  if (typeof body.input !== 'string' || !models.some(m => m.id === body.modelId) || !body.clientId || !body.timeZone) throw new Error('Invalid response contract')
  const r = response(body.clientId, body.input, '')
  r.modelId = body.modelId; r.parentResponseId = body.parentResponseId ?? null; r.agentMode = body.agentMode; r.presetSelections = body.presetSelections
  if (regenerated) {
    r.parentResponseId = regenerated.parentResponseId
    const ids = [...regenerated.branches.assistant.ids, r.id]
    for (const existing of c.responses) if (ids.includes(existing.id)) existing.branches.assistant = { ids, index: ids.indexOf(existing.id) }
    r.branches.assistant = { ids, index: ids.length - 1 }
  }
  r.status = r.snapshot.status = 'in_progress'
  c.responses.push(r); c.activeResponseId = c.activeBranchLeafId = r.id; emit(c)
  if (mode !== 'slow') {
    timers.push(setTimeout(() => {
      if (r.status !== 'in_progress') return
      r.output = [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'A fresh reply is arriving…' }] }]
      io.emit('response.event', { responseId: r.id, type: 'response.output_text.delta' })
    }, 400))
    timers.push(setTimeout(() => {
      if (r.status !== 'in_progress') return
      r.status = r.snapshot.status = mode === 'response-failure' ? 'failed' : 'completed'
      r.error = mode === 'response-failure' ? { message: 'The model could not respond.' } : null
      r.output = [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: `Reply to: ${body.input}\n\n**Done.** Your conversation is saved.` }] }]
      io.emit('response.snapshot', snapshot(r)); io.emit('response.completed', { chatId: c.id }); emit(c)
      const q = c.queuedMessages.shift()
      if (q) begin(c, { ...q, input: q.content, clientId: q.id, parentResponseId: r.id })
    }, 1800))
  }
  return r
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`), path = url.pathname
  let body = {}; try { let raw = ''; for await (const part of req) raw += part; body = raw ? JSON.parse(raw) : {} } catch {}
  const send = (status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(status === 204 ? '' : JSON.stringify(data)) }
  const fail = (status, code, message) => send(status, { error: { code, message } })
  if (path === '/__control') {
    if (body.reset) reset()
    if (body.mode) mode = body.mode
    if (body.twoFactor !== undefined) twoFactor = body.twoFactor
    if (body.expire) { sessions = false; io.disconnectSockets(true) }
    if (body.externalTitle) { chats[0].title = body.externalTitle; emit(chats[0]) }
    return send(200, { calls, chats, folders, settings, mode })
  }
  calls.push({ method: req.method, path, body, key: req.headers['idempotency-key'] ?? null })
  try {
    if (path === '/api/mobile/config') return send(200, { mobileApiVersion: 1, instance: { name: 'Pulpo', version: 'test' }, auth: { signupEnabled: true }, capabilities: { bearerSessions: true, realtime: true }, setupRequired: false })
    if (path === '/api/mobile/auth/login' || path === '/api/mobile/auth/signup') {
      if (body.email !== user.email || body.password !== 'test-password') return fail(401, 'invalid_credentials', 'Invalid email or password')
      if (twoFactor && body.twoFactorCode !== '123456') return fail(401, 'two_factor_required', 'Enter your authenticator or recovery code.')
      sessions = true
      return send(200, { user, session: { token, expiresAt: '2030-01-01T00:00:00Z' } })
    }
    if (req.headers.authorization !== `Bearer ${token}` || !sessions) return fail(401, 'unauthorized', 'Sign in again.')
    if (mode === 'offline') return fail(503, 'unavailable', 'Server unavailable. Try again.')
    if (path === '/api/mobile/me') return send(200, { user })
    if (path === '/api/mobile/auth/logout') { sessions = false; return send(204) }
    if (path === '/api/models') return send(200, { data: models, agentAvailable: true })
    if (path === '/api/settings') { if (req.method === 'PATCH') Object.assign(settings, body); return send(200, { values: settings, updatedAt: new Date().toISOString() }) }
    if (path === '/api/auth/settings') return send(200, { accountDeletionEnabled: true })
    if (path === '/api/me/deletion') return send(200, { twoFactorEnabled: twoFactor })
    if (path === '/api/me/password' || (path === '/api/me' && req.method === 'DELETE')) {
      if (body.currentPassword !== 'test-password') return fail(401, 'invalid_password', 'Incorrect password')
      if (req.method === 'DELETE') { sessions = false; return send(202, { status: 'deleting' }) }
      return send(204)
    }
    if (path === '/api/me') { Object.assign(user, body); return send(200, { user }) }
    if (path === '/api/me/sessions') return send(200, { sessions: [{ id: 'tv-session', deviceLabel: 'Apple TV', isCurrent: true }, { id: 'phone-session', deviceLabel: 'iPhone', isCurrent: false }] })
    if (path.startsWith('/api/me/sessions/') && req.method === 'DELETE') return send(204)
    if (path === '/api/chats') return send(200, { data: chats.filter(c => !c.deletedAt && !c.temporary).map(summary) })
    if (path === '/api/chats/search') { const q = (url.searchParams.get('q') ?? '').toLowerCase(); return send(200, { data: chats.filter(c => !c.deletedAt && !c.temporary && JSON.stringify(c).toLowerCase().includes(q)).map(summary) }) }
    if (path === '/api/chats/deleted') return send(200, { data: chats.filter(c => c.deletedAt).map(summary) })
    if (path === '/api/chats/start') {
      const key = req.headers['idempotency-key']; if (!key || key !== body.response?.clientId) throw new Error('Missing idempotency key')
      if (dedupe.has(key)) return send(202, dedupe.get(key))
      const c = { id: body.chat.clientId, title: body.chat.title, modelId: body.chat.modelId, temporary: body.chat.temporary, pinned: false, folderId: null, responses: [], attachments: [], queuedMessages: [] }
      chats.unshift(c); const r = begin(c, body.response); const result = { chat: summary(c), response: snapshot(r) }; dedupe.set(key, result)
      if (mode === 'drop-after-accept' && pendingChecks++ === 0) { req.socket.destroy(); return }
      return send(202, result)
    }
    if (path === '/api/folders') {
      if (req.method === 'POST') { const f = { id: body.clientId ?? randomUUID(), name: body.name }; folders.push(f); return send(201, f) }
      return send(200, { data: folders })
    }
    const folderMatch = path.match(/^\/api\/folders\/([^/]+)$/)
    if (folderMatch) {
      const f = folders.find(f => f.id === folderMatch[1]); if (!f) return fail(404, 'not_found', 'Folder not found')
      if (req.method === 'DELETE') { folders = folders.filter(x => x !== f); chats.forEach(c => { if (c.folderId === f.id) c.folderId = null }); return send(204) }
      Object.assign(f, body); return send(200, f)
    }
    const chatMatch = path.match(/^\/api\/chats\/([^/]+)(?:\/(.*))?$/)
    if (chatMatch) {
      const c = chats.find(c => c.id === chatMatch[1]), action = chatMatch[2]
      if (!c || (c.deletedAt && !['recover', 'permanent'].includes(action))) return fail(404, 'not_found', 'Chat not found')
      if (action === 'responses') {
        const key = req.headers['idempotency-key']; if (dedupe.has(key)) return send(202, dedupe.get(key))
        const r = begin(c, body); const result = { response: snapshot(r) }; dedupe.set(key, result); return send(202, result)
      }
      if (action === 'queued-messages') { const q = { ...body, id: body.clientId, content: body.input, status: 'pending' }; c.queuedMessages.push(q); emit(c); return send(202, { queuedMessage: q }) }
      if (action?.startsWith('queued-messages/')) { c.queuedMessages = c.queuedMessages.filter(q => q.id !== action.split('/')[1]); return send(204) }
      if (action === 'recover') { delete c.deletedAt; return send(200, summary(c)) }
      if (action === 'permanent') { chats = chats.filter(x => x !== c); return send(204) }
      if (action === 'persist') { c.temporary = false; return send(200, summary(c)) }
      if (action === 'duplicate') { const copy = structuredClone(c); copy.id = randomUUID(); copy.title += ' copy'; chats.unshift(copy); return send(201, summary(copy)) }
      if (req.method === 'DELETE') { c.deletedAt = new Date().toISOString(); emit(c); return send(204) }
      if (req.method === 'PATCH') Object.assign(c, body)
      if (mode === 'slow-read' && req.method === 'GET') await new Promise(resolve => setTimeout(resolve, 350))
      return send(200, activeChat(c))
    }
    const responseMatch = path.match(/^\/api\/(responses|messages)\/([^/]+)(?:\/(.*))?$/)
    if (responseMatch) {
      const id = decodeURIComponent(responseMatch[2]).replace(/:input$/, '')
      const c = chats.find(c => c.responses.some(r => r.id === id)), r = c?.responses.find(r => r.id === id)
      if (!r) return fail(404, 'not_found', 'Message not found')
      if (responseMatch[3] === 'cancel') { r.status = r.snapshot.status = 'cancelled'; emit(c); return send(200, snapshot(r)) }
      if (responseMatch[3] === 'activate') { c.activeBranchLeafId = c.activeResponseId = r.id; return send(200, { activeBranchLeafId: r.id }) }
      if (responseMatch[3] === 'regenerate' || req.method === 'PATCH') {
        if (req.method === 'PATCH' && !decodeURIComponent(responseMatch[2]).endsWith(':input')) throw new Error('User edit must use responseID:input')
        const next = begin(c, { ...body, input: body.content ?? r.input[0].content[0].text }, r)
        return send(202, { response: snapshot(next) })
      }
      if (req.method === 'DELETE') { c.responses = c.responses.filter(x => x !== r); c.activeBranchLeafId = c.activeResponseId = c.responses.at(-1)?.id ?? null; return send(204) }
      return send(200, snapshot(r))
    }
    if (path === '/api/chat-shares') return send(201, { token: 'fixture-public-share' })
    if (path === `/api/attachments/${FILE}/download`) return send(200, { url: '/fixture-image' })
    if (path === '/fixture-image') { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(await readFile(new URL('../../mobile/assets/pulpo-smiley.png', import.meta.url))) }
    fail(404, 'unknown_route', `Unhandled ${req.method} ${path}`)
  } catch (error) { fail(400, 'contract_error', error.message) }
})
const io = new Server(server)
io.use((socket, next) => socket.handshake.auth.sessionToken === token && sessions ? next() : next(new Error('unauthorized')))
io.on('connection', socket => { socket.on('chat.subscribe', () => {}); socket.on('chat.unsubscribe', () => {}) })
server.listen(port, '127.0.0.1', () => console.log(`Pulpo TV fixture: http://127.0.0.1:${port}`))
process.on('SIGTERM', () => { timers.forEach(clearTimeout); io.close(); server.close() })
