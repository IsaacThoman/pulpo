// Extra acceptance against queue-proxy.mjs and the disposable local fixture.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
const origin = 'http://127.0.0.1:8091'
const control = async (body) => fetch('http://127.0.0.1:8095', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
await control({ online: true, realtime: true, nextQueueFailure: null })
const requestOffset = (await fetch('http://127.0.0.1:8092/requests').then(r => r.json())).length
const login = await fetch(`${origin}/api/mobile/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'queue@example.test', password: 'Queue-test-only-2026', deviceLabel: 'Queue fault acceptance' }) }).then(r => r.json())
assert(login.session?.token)
const request = async (path, method = 'GET', body, expectedStatus) => {
  const r = await fetch(`${origin}/api${path}`, { method, headers: { authorization: `Bearer ${login.session.token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  if (expectedStatus) { assert.equal(r.status, expectedStatus); return }
  const data = r.status === 204 ? null : await r.json()
  assert(r.ok, JSON.stringify(data)); return data
}
const body = input => ({ clientId: randomUUID(), input, modelId: 'queue-test', presetSelections: {}, attachmentIds: [], agentMode: false })
const chat = await request('/chats', 'POST', { title: 'Queue fault acceptance', modelId: 'queue-test' })
const path = `/chats/${chat.id}`
await request(`${path}/responses`, 'POST', body('HOLD Fault acceptance'))
const accepted = body('Lost API acknowledgment')
await control({ nextQueueFailure: 'drop' })
await assert.rejects(request(`${path}/queued-messages`, 'POST', accepted))
assert.equal((await request(path)).queuedMessages.filter(x => x.id === accepted.clientId).length, 1)
const replay = await request(`${path}/queued-messages`, 'POST', accepted)
assert.equal(replay.queuedMessage.id, accepted.clientId)
assert.equal((await request(path)).queuedMessages.length, 1)
await request(`${path}/queued-messages/${accepted.clientId}`, 'PATCH', { action: 'begin_edit' })
const second = await request(`${path}/queued-messages`, 'POST', body('After edit lock'))
await fetch('http://127.0.0.1:8092/release', { method: 'POST' })
for (let i = 0; i < 80; i++) {
  const current = await request(path)
  if (current.responses[0]?.status === 'completed') break
  await new Promise(r => setTimeout(r, 100))
}
const locked = await request(path)
assert.equal(locked.responses.length, 1)
assert.equal(locked.queuedMessages[0].status, 'editing')
await request(`${path}/queued-messages/${accepted.clientId}`, 'PATCH', { action: 'cancel_edit' })
let completed
for (let i = 0; i < 100; i++) {
  completed = await request(path)
  if (completed.responses.length === 3 && completed.responses.every(x => x.status === 'completed') && !completed.queuedMessages.length) break
  await new Promise(r => setTimeout(r, 100))
}
assert.equal(completed.responses.length, 3)
assert(completed.responses.every(x => x.status === 'completed'))
assert.equal((await request(`${path}/queued-messages`, 'POST', accepted)).queuedMessage, null)
assert.equal((await request(path)).responses.length, 3)
// Idle enqueue can dispatch before POST returns; retry must still be safe.
const immediate = body('Immediate dispatch race')
await request(`${path}/queued-messages`, 'POST', immediate)
for (let i = 0; i < 100; i++) {
  const current = await request(path)
  if (current.responses.some(x => x.id === immediate.clientId && x.status === 'completed')) break
  await new Promise(r => setTimeout(r, 100))
}
assert.equal((await request(`${path}/queued-messages`, 'POST', immediate)).queuedMessage, null)
assert.equal((await request(path)).responses.length, 4)
await request(`${path}/queued-messages`, 'POST', { ...body('Invalid model'), modelId: 'missing-qa-model' }, 400)
assert.equal((await request(path)).responses.length, 4)
const attempts = await fetch('http://127.0.0.1:8092/requests').then(r => r.json())
assert.deepEqual(attempts.slice(requestOffset).filter(x => ['HOLD Fault acceptance', accepted.input, second.queuedMessage.content, immediate.input].includes(x.prompt)).map(x => x.prompt), ['HOLD Fault acceptance', accepted.input, second.queuedMessage.content, immediate.input])
console.log(JSON.stringify({ passed: true, chatId: chat.id, checks: ['lost acknowledgment replay', 'edit lock blocks sequential dispatch', 'cancel resumes dispatch', 'retry after dispatch', 'idle enqueue race', 'invalid model rejection', 'exact execution order'] }))
