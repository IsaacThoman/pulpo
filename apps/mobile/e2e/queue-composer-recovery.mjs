// Real Socket.IO verification of multiple accepted offline draft receipts.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { io } from 'socket.io-client'
import { ComposerSync } from '@pulpo/client-core'
import { emptyComposerState } from '@pulpo/contracts'
const origin = 'http://127.0.0.1:8091'
const login = await fetch(`${origin}/api/mobile/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'queue@example.test', password: 'Queue-test-only-2026', deviceLabel: 'Composer recovery acceptance' }) }).then(r => r.json())
assert(login.session?.token)
const chat = await fetch(`${origin}/api/chats`, { method: 'POST', headers: { authorization: `Bearer ${login.session.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Offline composer receipt acceptance', modelId: 'queue-test' }) }).then(r => r.json())
assert(chat.id)
const handles = []
async function client(saved = new Map()) {
  const socket = io(origin, { transports: ['websocket'], auth: { sessionToken: login.session.token, composerSyncEnabled: true } })
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject) })
  socket.emit('composer.configure', { enabled: true })
  const sync = new ComposerSync({ load: async id => saved.get(id) ?? null, save: async (id, value) => { saved.set(id, structuredClone(value)) } }, `qa-${randomUUID()}`)
  const call = (event, data) => new Promise((resolve, reject) => socket.timeout(5000).emit(event, data, (err, result) => err ? reject(err) : resolve(result)))
  const transport = { read: draftId => call('composer.read', { draftId }), write: input => call('composer.write', input) }
  socket.on('composer.changed', snapshot => sync.receive(snapshot))
  sync.connect(transport)
  const handle = { socket, sync, saved, transport }
  handles.push(handle)
  return handle
}
const state = content => ({ ...emptyComposerState(), content })
try {
  const first = state('First offline accepted draft')
  const a = await client(), b = await client()
  await a.sync.open(chat.id, first, () => {})
  await b.sync.open(chat.id, emptyComposerState(), () => {})
  const revision = await a.sync.prepareSubmission(chat.id, first)
  assert.equal((await b.transport.read(chat.id)).snapshot.state.content, first.content)
  a.socket.disconnect(); a.sync.disconnect()
  await a.sync.completeSubmission(chat.id, first, revision ?? undefined)
  await a.sync.completeSubmission(chat.id, state('Second offline accepted draft'))
  a.sync.dispose()
  const restarted = await client(a.saved)
  await restarted.sync.open(chat.id, emptyComposerState(), () => {})
  assert.equal((await b.transport.read(chat.id)).snapshot.state.content, '')
  // A later unrelated draft must survive recovery.
  const accepted = state('Accepted before disconnect')
  restarted.sync.edit(chat.id, accepted)
  await restarted.sync.flush(chat.id)
  restarted.socket.disconnect(); restarted.sync.disconnect()
  await restarted.sync.completeSubmission(chat.id, accepted)
  await restarted.sync.completeSubmission(chat.id, state('Another offline acceptance'))
  b.sync.edit(chat.id, state('Preserve this new remote draft')); await b.sync.flush(chat.id)
  restarted.sync.dispose()
  const recovered = await client(restarted.saved)
  await recovered.sync.open(chat.id, emptyComposerState(), () => {})
  assert.equal((await b.transport.read(chat.id)).snapshot.state.content, 'Preserve this new remote draft')
  console.log(JSON.stringify({ passed: true, chatId: chat.id, checks: ['real socket synchronization', 'multiple offline accepted receipts', 'restart clears earlier accepted draft', 'unsubmitted remote draft preserved'] }))
} finally {
  for (const { socket, sync } of handles) { sync.dispose(); socket.disconnect() }
}
