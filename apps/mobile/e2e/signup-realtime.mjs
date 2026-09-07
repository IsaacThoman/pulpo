// Run only against the disposable signup QA Compose stack.
// PULPO_SIGNUP_QA_ADMIN_TOKEN supplies a native administrator bearer token.
import assert from 'node:assert/strict'
import { io } from 'socket.io-client'

const origin = process.env.PULPO_SIGNUP_QA_URL ?? 'http://localhost:8187'
const url = new URL(origin)
assert.equal(url.hostname, 'localhost', 'This fixture must only target a disposable localhost server')
const adminToken = process.env.PULPO_SIGNUP_QA_ADMIN_TOKEN
assert.ok(adminToken, 'Set PULPO_SIGNUP_QA_ADMIN_TOKEN')
const suffix = Date.now().toString(36)
const password = 'Signup-test-only-2026'
const sockets = []
async function request(path, { token, method = 'GET', body, status = 200 } = {}) {
  const response = await fetch(`${origin}${path}`, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  assert.equal(response.status, status, `${path}: ${await response.clone().text()}`)
  return response.status === 204 ? undefined : response.json()
}
function socketFor(token) {
  const socket = io(origin, { path: '/socket.io', transports: ['websocket'], auth: { sessionToken: token }, autoConnect: false, reconnectionDelayMax: 100 })
  sockets.push(socket)
  return socket
}
function event(socket, name) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${name}`)), 10_000)
    socket.once(name, (...args) => { clearTimeout(timer); resolve(args) })
  })
}
async function signup(kind) {
  return request('/api/mobile/auth/signup', { method: 'POST', status: 201, body: {
    name: `Signup QA ${kind}`, username: `qa_${kind}_${suffix}`, email: `${kind}-${suffix}@signup.test`, password, deviceLabel: 'Signup QA', platform: 'ios',
  } })
}
const initial = (await request('/api/admin/settings', { token: adminToken })).values.auth ?? {}
try {
  await request('/api/admin/settings', { token: adminToken, method: 'PATCH', body: { auth: { ...initial, signupEnabled: true, defaultSignupRole: 'pending' } } })
  const pending = await signup('pending')
  assert.equal(pending.user.role, 'pending')
  const socket = socketFor(pending.session.token)
  const rejected = event(socket, 'connect_error'); socket.connect()
  assert.equal((await rejected)[0].message, 'unauthorized')
  assert.equal(socket.active, false, 'Authorization rejection disables automatic reconnection')
  await request(`/api/admin/users/${pending.user.id}`, { token: adminToken, method: 'PATCH', body: { role: 'user' } })
  assert.equal((await request('/api/mobile/me', { token: pending.session.token })).user.role, 'user')
  assert.equal(socket.connected, false, 'Approval and HTTP session refresh do not reconnect the rejected socket')
  const connected = event(socket, 'connect'); socket.connect(); await connected
  const sync = await socket.timeout(5_000).emitWithAck('client.sync', { tabId: 'signup-qa', accountRevision: 0, responseCursors: {} })
  assert.ok(Array.isArray(sync.snapshots))
  console.log('PASS: pending signup rejects realtime; approval retains token; explicit connection restores sync')

  await request('/api/admin/settings', { token: adminToken, method: 'PATCH', body: { auth: { ...initial, signupEnabled: true, defaultSignupRole: 'user' } } })
  const open = await signup('open')
  assert.equal(open.user.role, 'user')
  const openSocket = socketFor(open.session.token)
  const openConnected = event(openSocket, 'connect'); openSocket.connect(); await openConnected
  console.log('PASS: open signup connects immediately')
  await request('/api/mobile/auth/login', { method: 'POST', status: 401, body: { email: open.user.email, password: 'Wrong-test-password', deviceLabel: 'QA' } })
  assert.equal((await request('/api/mobile/me', { token: open.session.token })).user.id, open.user.id)
  const login = await request('/api/mobile/auth/login', { method: 'POST', body: { email: open.user.email.toUpperCase(), password, deviceLabel: 'QA' } })
  assert.equal(login.user.id, open.user.id)
  await request('/api/mobile/auth/logout', { token: login.session.token, method: 'POST', status: 204 })
  await request('/api/mobile/me', { token: login.session.token, status: 401 })
  console.log('PASS: wrong password preserves valid session; email case insensitive; logout revokes token')

  await request('/api/mobile/auth/signup', { method: 'POST', status: 409, body: { name: 'Duplicate QA', username: `duplicate_${suffix}`, email: open.user.email.toUpperCase(), password, deviceLabel: 'QA' } })
  await request('/api/admin/settings', { token: adminToken, method: 'PATCH', body: { auth: { ...initial, signupEnabled: false } } })
  await request('/api/mobile/auth/signup', { method: 'POST', status: 403, body: { name: 'Disabled QA', username: `disabled_${suffix}`, email: `disabled-${suffix}@signup.test`, password, deviceLabel: 'QA' } })
  console.log('PASS: duplicate email and disabled signup rejected')
} finally {
  for (const socket of sockets) socket.disconnect()
  await request('/api/admin/settings', { token: adminToken, method: 'PATCH', body: { auth: initial } })
}
