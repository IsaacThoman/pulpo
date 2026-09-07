import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { io, type Socket } from 'socket.io-client'
import postgres from 'postgres'
import type { ComposerAck } from '@pulpo/contracts'

const enabled = process.env.PULPO_PROFILES_REALTIME_TEST === '1'
const origin = process.env.PULPO_PROFILES_TEST_ORIGIN ?? 'http://127.0.0.1:30527'
if (enabled && (new URL(process.env.DATABASE_URL!).pathname !== '/pulpo_profiles_test' || !/^http:\/\/(127\.0\.0\.1|localhost):30527$/.test(origin))) throw new Error('Use the disposable profile preview server and database')
const sql = enabled ? postgres(process.env.DATABASE_URL!, { max: 1 }) : null
const sockets: Socket[] = []
const owners: string[] = []
async function request(path: string, token?: string, body?: unknown, profileId?: string) {
  const response = await fetch(`${origin}${path}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(profileId ? { 'X-Pulpo-Profile-Id': profileId } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const value = await response.json() as any
  expect(response.ok, JSON.stringify(value)).toBe(true)
  return value
}
async function connect(token: string, profileId?: string): Promise<Socket> {
  const socket = io(origin, { transports: ['websocket'], auth: { sessionToken: token, profileId }, reconnection: false })
  sockets.push(socket)
  await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject) })
  return socket
}
const readDraft = (socket: Socket) => socket.timeout(5000).emitWithAck('composer.read', { draftId: 'new' }) as Promise<ComposerAck>

describe.skipIf(!enabled)('real profile Socket.IO isolation', () => {
  afterAll(async () => {
    for (const socket of sockets) socket.disconnect()
    for (const owner of owners) await sql!`delete from users where id = ${owner}`
    await sql?.end()
  })
  it('partitions drafts and invalidations, rejects foreign handshakes, and disconnects deleted selections', async () => {
    async function account() {
      const id = randomUUID().replaceAll('-', '')
      const result = await request('/api/mobile/auth/signup', undefined, { name: 'Socket test', username: `p${id.slice(0, 24)}`, email: `${id}@example.test`, password: 'Disposable-Profile-527!', deviceLabel: 'Test' })
      owners.push(result.user.id)
      await sql!`update users set role = 'user' where id = ${result.user.id}`
      return { id: result.user.id as string, token: result.session.token as string }
    }
    const owner = await account(), other = await account()
    const list = await request('/api/profiles', owner.token, { name: 'Work', color: '#0d9488' })
    const workId = list.createdProfileId as string
    const personal = await connect(owner.token), personalPeer = await connect(owner.token, owner.id), work = await connect(owner.token, workId), outsider = await connect(other.token)
    await expect(connect(other.token, workId)).rejects.toThrow()
    await Promise.all([personal, personalPeer, work, outsider].map(readDraft))
    const received: Record<string, string[]> = { personal: [], work: [], outsider: [] }
    personalPeer.on('composer.changed', (snapshot) => received.personal!.push(snapshot.state.content))
    work.on('composer.changed', (snapshot) => received.work!.push(snapshot.state.content))
    outsider.on('composer.changed', (snapshot) => received.outsider!.push(snapshot.state.content))
    const ack = await personal.timeout(5000).emitWithAck('composer.write', { draftId: 'new', baseRevision: 0, mutationId: randomUUID(), patch: { content: 'Personal socket secret' } }) as ComposerAck
    expect(ack.ok).toBe(true)
    await expect.poll(() => received.personal).toContain('Personal socket secret')
    expect(received.work).not.toContain('Personal socket secret')
    expect(received.outsider).not.toContain('Personal socket secret')
    const workDraft = await readDraft(work)
    expect(workDraft.ok && workDraft.snapshot.state.content).toBe('')
    const removed = new Promise<void>((resolve) => work.once('disconnect', () => resolve()))
    const deletion = await fetch(`${origin}/api/profiles/${workId}`, { method: 'DELETE', headers: { authorization: `Bearer ${owner.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Work' }) })
    expect(deletion.status).toBe(202)
    await removed
    expect(personal.connected).toBe(true)
    expect(outsider.connected).toBe(true)
  }, 30000)
})
