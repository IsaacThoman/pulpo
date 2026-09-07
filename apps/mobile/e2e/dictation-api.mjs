import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const origin = 'http://localhost:8096'
const control = 'http://localhost:8097'
const audio = await readFile(process.argv[2])
const config = await fetch(`${origin}/api/mobile/config`).then((response) => response.json())
assert.equal(config.capabilities.dictation, true)
const login = await fetch(`${origin}/api/mobile/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'dictation@example.test', password: 'Dictation-test-only-2026', deviceLabel: 'Dictation API acceptance', platform: 'ios', appType: 'mobile' }) })
assert.equal(login.status, 200)
const { session } = await login.json()
async function upload(bytes = audio, type = 'audio/mp4', token = session.token) {
  const body = new FormData()
  body.set('file', new Blob([bytes], { type }), 'dictation.m4a')
  return fetch(`${origin}/api/dictation/transcriptions`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body })
}
async function mode(value) {
  await fetch(control, { method: 'POST', body: JSON.stringify({ mode: value, text: 'Hello from mobile dictation.' }) })
}
try {
  await mode('success')
  const good = await upload(); assert.equal(good.status, 200)
  assert.deepEqual(await good.json(), { text: 'Hello from mobile dictation.' })
  assert.equal((await upload(audio, 'audio/mp4', 'invalid')).status, 401)
  assert.equal((await upload(Buffer.alloc(0))).status, 400)
  assert.equal((await upload(audio, 'application/octet-stream')).status, 415)
  assert.equal((await upload(Buffer.alloc(10 * 1024 * 1024 + 1))).status, 413)
  for (const [fault, status] of [['no-speech', 422], ['failure', 502], ['rate-limit', 429]]) {
    await mode(fault)
    const result = await upload(); assert.equal(result.status, status, await result.text())
  }
  console.log('Passed: native bearer M4A upload, transcript, unauthorized, empty, oversized, unsupported, no-speech, provider failure and rate limit.')
} finally { await mode('success') }
