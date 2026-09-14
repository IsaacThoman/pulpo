import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
const holder = vi.hoisted(() => ({ db: null as unknown }))
vi.mock('../database/client.js', () => ({ db: new Proxy({}, { get(_target, key) { const d = holder.db as Record<string | symbol, unknown>; const v = d[key]; return typeof v === 'function' ? v.bind(d) : v } }) }))
import { beginDiagnostic, writeDiagnosticPayload, updateDiagnostic } from './provider-diagnostics.js'
import { purgeExpiredDetailedPayloads, reconcileDetailedPayloadRetention } from './detailed-payload-retention.js'
import { retentionHealth } from './retention-health.js'
const url = process.env.PULPO_PAYLOAD_TEST_DATABASE_URL
const client = postgres(url ?? 'postgres://localhost/unused', { max: 1 })
const database = drizzle(client)
const userId = randomUUID(), logId = randomUUID()

describe.skipIf(!url)('provider diagnostic persistence and expiry', () => {
  beforeAll(async () => {
    holder.db = database
    await client`create temporary table users (id uuid primary key)`
    await client`create temporary table application_settings (key text primary key, value jsonb, updated_at timestamptz)`
    await client`create temporary table request_logs (id uuid primary key, user_id uuid, created_at timestamptz, updated_at timestamptz, response_id uuid, capture_detailed_payloads boolean, payload_expires_at timestamptz, request_payload text, response_payload text)`
    await client`create temporary table generation_attempts (id uuid primary key, first_token_ms int)`
    await client`create temporary table ocr_attempts (id uuid primary key, request_log_id uuid, request_payload text, response_payload text, updated_at timestamptz)`
    await client`create temporary table agent_runs (id uuid primary key, response_id uuid)`
    await client`create temporary table tool_executions (id uuid primary key, agent_run_id uuid, arguments text, output text, updated_at timestamptz)`
    const migration = await readFile(new URL('../../drizzle/0076_provider_diagnostics.sql', import.meta.url), 'utf8')
    for (const statement of migration.replace('CREATE TABLE provider_diagnostics', 'CREATE TEMPORARY TABLE provider_diagnostics').split('--> statement-breakpoint')) await client.unsafe(statement)
  })
  beforeEach(async () => {
    await client`truncate provider_diagnostics, tool_executions, agent_runs, ocr_attempts, generation_attempts, request_logs, application_settings, users cascade`
    await client`insert into users values (${userId})`
    await client`insert into application_settings (key,value) values ('logging', '{"logDetailedPayloads":true,"payloadRetention":"24h"}')`
    await client`insert into request_logs (id,user_id,created_at,capture_detailed_payloads,payload_expires_at,response_id) values (${logId},${userId},now(),true,now()+interval '1 hour',${randomUUID()})`
  })
  afterAll(async () => client.end())
  it.each(['generation', 'image_edit', 'speech', 'dictation', 'title', 'memory', 'compaction', 'ocr', 'tool'])('expires %s copies but preserves metadata and rejects late writes', async purpose => {
    const row = (await beginDiagnostic({ requestLogId: logId, purpose }))!
    await writeDiagnosticPayload(row.id, 'requestPayload', { fidelity: 'redacted', body: { prompt: 'secret\u0000' } })
    await writeDiagnosticPayload(row.id, 'responsePayload', { fidelity: 'reconstructed', body: { text: 'private' } })
    await updateDiagnostic(row.id, { httpStatus: 400, providerRequestId: 'req-1' }, 'failed')
    await client`update provider_diagnostics set payload_expires_at=now()-interval '1 second' where id=${row.id}`
    expect((await retentionHealth()).overdueRecords).toBe(1)
    const count = await database.transaction(tx => purgeExpiredDetailedPayloads(q => tx.execute(q)))
    expect(count.clearedRecords).toBe(1)
    await writeDiagnosticPayload(row.id, 'responsePayload', { fidelity: 'exact', body: 'late' })
    const [saved] = await client`select * from provider_diagnostics where id=${row.id}`
    expect(saved).toMatchObject({ request_payload: null, response_payload: null, capture_detailed_payloads: false, status: 'failed', metadata: { httpStatus: 400, providerRequestId: 'req-1' } })
    expect((await retentionHealth()).overdueRecords).toBe(0)
  })
  it('inherits parent deadlines, supports standalone calls, and cannot recapture after disable', async () => {
    const child = (await beginDiagnostic({ requestLogId: logId, purpose: 'image_edit' }))!
    const standalone = (await beginDiagnostic({ userId, purpose: 'speech' }))!
    const rows = await client`select id,extract(epoch from (payload_expires_at-retention_started_at)) as seconds from provider_diagnostics`
    expect(Number(rows.find(r => r.id === standalone.id)?.seconds)).toBe(86400)
    expect(Number(rows.find(r => r.id === child.id)?.seconds)).toBeCloseTo(3600, 0)
    await database.transaction(tx => reconcileDetailedPayloadRetention(q => tx.execute(q), { logDetailedPayloads: false, payloadRetention: '24h' }))
    await writeDiagnosticPayload(child.id, 'responsePayload', { fidelity: 'exact', body: 'late' })
    const newer = (await beginDiagnostic({ requestLogId: logId, purpose: 'image_edit' }))!
    expect(newer.capture).toBe(false)
    expect((await client`select response_payload from provider_diagnostics where id=${child.id}`)[0]?.response_payload).toBeNull()
  })
  it('does not revive expired captures when extending retention', async () => {
    const row = (await beginDiagnostic({ userId, purpose: 'speech' }))!
    await client`update provider_diagnostics set payload_expires_at=now()-interval '1 second',request_payload='"private"' where id=${row.id}`
    await database.transaction(tx => reconcileDetailedPayloadRetention(q => tx.execute(q), { logDetailedPayloads: true, payloadRetention: 'indefinite' }))
    expect((await client`select capture_detailed_payloads,request_payload from provider_diagnostics`)[0]).toMatchObject({ capture_detailed_payloads: false, request_payload: null })
  })
  it('expires legacy tool diagnostic copies without deleting execution/billing metadata', async () => {
    const run = randomUUID(), tool = randomUUID()
    await client`insert into agent_runs select ${run},response_id from request_logs where id=${logId}`
    await client`insert into tool_executions (id,agent_run_id,arguments,output) values (${tool},${run},'{"prompt":"secret"}','"private"')`
    await client`update request_logs set capture_detailed_payloads=false`
    expect((await retentionHealth()).overdueRecords).toBe(1)
    await database.transaction(tx => purgeExpiredDetailedPayloads(q => tx.execute(q)))
    expect((await client`select id,arguments,output from tool_executions`)[0]).toEqual({ id: tool, arguments: '{}', output: null })
  })
})
