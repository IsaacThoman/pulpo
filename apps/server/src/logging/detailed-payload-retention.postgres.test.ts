import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { activeDetailedPayloadCondition, detailedPayloadPolicy, purgeExpiredDetailedPayloads, reconcileDetailedPayloadRetention, type DetailedPayloadRetention } from './detailed-payload-retention.js'

// Temporary tables isolate this suite from application data, even on a shared database.
const url = process.env.PULPO_PAYLOAD_TEST_DATABASE_URL
const client = postgres(url ?? 'postgres://localhost/pulpo_payload_test', { max: 1 })
const database = drizzle(client)
const now = new Date('2026-09-10T12:00:00Z')
const createdAt = new Date('2026-09-10T10:00:00Z')
const finite = ['1h', '24h', '7d', '30d', '90d'] as const
async function seed(expiry: Date | null, capture = true) {
  await database.execute(sql`insert into request_logs values ('log', ${createdAt.toISOString()}, ${createdAt.toISOString()}, ${capture}, ${expiry?.toISOString() ?? null}, '{"input":"secret"}', '{"output":"secret"}')`)
  await database.execute(sql`insert into ocr_attempts values ('ocr', 'log', ${createdAt.toISOString()}, '{"image":"secret"}', '{"text":"secret"}')`)
}
async function reconcile(retention: DetailedPayloadRetention, enabled = true) {
  await database.transaction((tx) => reconcileDetailedPayloadRetention((query) => tx.execute(query), { logDetailedPayloads: enabled, payloadRetention: retention }, now))
}
async function rows() {
  const [log] = await database.execute(sql`select * from request_logs`)
  const [ocr] = await database.execute(sql`select * from ocr_attempts`)
  return { log: log!, ocr: ocr! }
}
function cleared(result: Awaited<ReturnType<typeof rows>>) {
  expect(result.log.capture_detailed_payloads).toBe(false)
  for (const row of [result.log, result.ocr]) {
    expect(row.request_payload).toBeNull()
    expect(row.response_payload).toBeNull()
  }
}

describe.skipIf(!url)('detailed payload retention in PostgreSQL', () => {
  beforeAll(async () => {
    await client`create temporary table request_logs (id text primary key, created_at timestamptz, updated_at timestamptz, capture_detailed_payloads boolean, payload_expires_at timestamptz, request_payload jsonb, response_payload jsonb)`
    await client`create temporary table ocr_attempts (id text primary key, request_log_id text references request_logs(id), updated_at timestamptz, request_payload jsonb, response_payload jsonb)`
  })
  beforeEach(async () => { await client`truncate ocr_attempts, request_logs` })
  afterAll(async () => { await client.end() })

  it.each(finite)('applies %s from creation time, including immediate expiration', async (retention) => {
    await seed(null)
    await reconcile(retention)
    const result = await rows()
    expect(new Date(String(result.log.payload_expires_at))).toEqual(detailedPayloadPolicy({ logDetailedPayloads: true, payloadRetention: retention }, createdAt).payloadExpiresAt)
    if (retention === '1h') cleared(result)
    else {
      expect(result.log.capture_detailed_payloads).toBe(true)
      expect(result.ocr.request_payload).toEqual({ image: 'secret' })
    }
  })
  it.each([...finite, 'indefinite'] as const)('never revives expired payloads when changing to %s before cleanup', async (retention) => {
    await seed(now)
    await reconcile(retention)
    cleared(await rows())
  })
  it('extends unexpired payloads and supports switching to indefinite', async () => {
    await seed(new Date(now.getTime() + 1))
    await reconcile('30d')
    expect((await rows()).log.capture_detailed_payloads).toBe(true)
    await reconcile('indefinite')
    expect((await rows()).log.payload_expires_at).toBeNull()
  })
  it('clears all bodies when disabled and cannot restore them when reenabled', async () => {
    await seed(null)
    await reconcile('7d', false)
    cleared(await rows())
    await reconcile('indefinite')
    cleared(await rows())
  })
  it('purges at the exact deadline while retaining metadata and avoiding repeated writes', async () => {
    await seed(now)
    await database.transaction((tx) => purgeExpiredDetailedPayloads((query) => tx.execute(query), now))
    const first = await rows()
    cleared(first)
    expect(first.log.id).toBe('log')
    expect(first.ocr.id).toBe('ocr')
    await database.transaction((tx) => purgeExpiredDetailedPayloads((query) => tx.execute(query), new Date(now.getTime() + 1000)))
    expect(await rows()).toEqual(first)
  })
  it.each([null, new Date(now.getTime() + 1)])('preserves unexpired and indefinite payloads (%s)', async (expiry) => {
    await seed(expiry)
    await database.transaction((tx) => purgeExpiredDetailedPayloads((query) => tx.execute(query), now))
    expect((await rows()).log.request_payload).toEqual({ input: 'secret' })
    expect((await rows()).ocr.response_payload).toEqual({ text: 'secret' })
  })
  it('checks the database clock when a payload write executes, not when it is prepared', async () => {
    const condition = activeDetailedPayloadCondition('log')
    await seed(new Date(Date.now() + 100))
    await client`select pg_sleep(0.12)`
    await database.execute(sql`update request_logs set response_payload = '{"late":true}' where ${condition}`)
    expect((await rows()).log.response_payload).toEqual({ output: 'secret' })
  })
  it('clears lingering OCR bodies for a disabled parent', async () => {
    await seed(null, false)
    await database.transaction((tx) => purgeExpiredDetailedPayloads((query) => tx.execute(query), now))
    expect((await rows()).ocr.request_payload).toBeNull()
  })
})
