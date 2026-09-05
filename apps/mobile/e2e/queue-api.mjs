// Run against the isolated backend described in README.md, never production.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
const origin = 'http://localhost:8091'
const login = await fetch(`${origin}/api/mobile/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'queue@example.test', password: 'Queue-test-only-2026', deviceLabel: 'API queue acceptance' }) }).then((response) => response.json())
assert(login.session?.token, 'Test account must exist')
const request = async (path, method = 'GET', body) => {
  const response = await fetch(`${origin}/api${path}`, { method, headers: { authorization: `Bearer ${login.session.token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const data = response.status === 204 ? null : await response.json()
  assert(response.ok, `${method} ${path}: ${JSON.stringify(data)}`)
  return data
}
const chat = await request('/chats', 'POST', { clientId: randomUUID(), title: 'Queue API acceptance', modelId: 'queue-test' })
const path = `/chats/${chat.id}`
await request(`${path}/responses`, 'POST', { clientId: randomUUID(), input: 'HOLD API acceptance', modelId: 'queue-test' })
const body = (input, clientId = randomUUID()) => ({ clientId, input, modelId: 'queue-test', presetSelections: {}, attachmentIds: [], agentMode: false })
const firstInput = body('First')
const [first, duplicate] = await Promise.all([request(`${path}/queued-messages`, 'POST', firstInput), request(`${path}/queued-messages`, 'POST', firstInput)])
assert.equal(first.queuedMessage.id, duplicate.queuedMessage.id)
const second = await request(`${path}/queued-messages`, 'POST', body('Second'))
const removed = await request(`${path}/queued-messages`, 'POST', body('Remove me'))
await request(`${path}/queued-messages/${removed.queuedMessage.id}`, 'DELETE')
await request(`${path}/queued-messages/${first.queuedMessage.id}`, 'PATCH', { action: 'begin_edit' })
await request(`${path}/queued-messages/${first.queuedMessage.id}`, 'PATCH', { action: 'cancel_edit' })
await request(`${path}/queued-messages/${first.queuedMessage.id}`, 'PATCH', { action: 'begin_edit' })
await request(`${path}/queued-messages/${first.queuedMessage.id}`, 'PATCH', { action: 'save_edit', ...body('First edited'), modelId: 'queue-test-alternate' })
await request(`${path}/queued-messages/${second.queuedMessage.id}/reorder`, 'PATCH', { targetMessageId: first.queuedMessage.id, edge: 'before' })
assert.deepEqual((await request(path)).queuedMessages.map((item) => item.content), ['Second', 'First edited'])
await fetch('http://localhost:8092/release', { method: 'POST' })
let detail
for (let attempt = 0; attempt < 80; attempt++) {
  detail = await request(path)
  if (detail.queuedMessages.length === 0 && detail.responses.length === 3 && detail.responses.every((item) => item.status === 'completed')) break
  await new Promise((resolve) => setTimeout(resolve, 250))
}
assert.equal(detail.queuedMessages.length, 0)
assert.equal(detail.responses.length, 3)
assert(detail.responses.every((item) => item.status === 'completed'))
const retry = await request(`${path}/queued-messages`, 'POST', firstInput)
assert.equal(retry.queuedMessage, null)
assert.equal((await request(path)).responses.length, 3)
const requests = await fetch('http://localhost:8092/requests').then((response) => response.json())
const turns = requests.filter((item) => ['HOLD API acceptance', 'Second', 'First edited'].includes(item.prompt))
assert.deepEqual(turns.slice(-3).map((item) => item.prompt), ['HOLD API acceptance', 'Second', 'First edited'])
assert.equal(turns.at(-1).model, 'queue-test-alternate')
console.log(JSON.stringify({ passed: true, chatId: chat.id, checks: ['concurrent retry deduplication', 'edit/cancel/save', 'delete', 'reorder', 'sequential dispatch', 'saved model', 'retry after dispatch'] }))
