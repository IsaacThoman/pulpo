import { diagnosticPayloadAvailability } from './diagnostic-policy.js'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
const holder = vi.hoisted(() => ({ db: null as unknown }))
vi.mock('./diagnostic-database.js', () => ({ diagnosticClient: { end: async () => {} }, diagnosticDb: new Proxy({}, { get(_target, key) { const d = holder.db as Record<string | symbol, unknown>; const v = d[key]; return typeof v === 'function' ? v.bind(d) : v } }) }))
vi.mock('../database/client.js', () => ({ db: new Proxy({}, { get(_target, key) { const d = holder.db as Record<string | symbol, unknown>; const v = d[key]; return typeof v === 'function' ? v.bind(d) : v } }) }))
import { beginDiagnostic, writeDiagnosticPayload, updateDiagnostic, refreshDiagnosticPolicy, flushDiagnostics } from './provider-diagnostics.js'
import { purgeExpiredDetailedPayloads, reconcileDetailedPayloadRetention } from './detailed-payload-retention.js'
import { sampleRetentionBacklog } from './retention-health.js'
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
    const policyMigration = await readFile(new URL('../../drizzle/0077_diagnostic_writer_policy.sql', import.meta.url), 'utf8')
    for (const statement of policyMigration.replace('CREATE TABLE diagnostic_policy', 'CREATE TEMPORARY TABLE diagnostic_policy').split('--> statement-breakpoint')) await client.unsafe(statement)
  })
  beforeEach(async () => {
    await flushDiagnostics()
    await client`update diagnostic_policy set enabled=true,epoch=0,retention_seconds=86400,expired_before=null`
    await client`truncate provider_diagnostics, tool_executions, agent_runs, ocr_attempts, generation_attempts, request_logs, application_settings, users cascade`
    await client`insert into users values (${userId})`
    await client`insert into application_settings (key,value) values ('logging', '{"logDetailedPayloads":true,"payloadRetention":"24h"}')`
    await client`insert into request_logs (id,user_id,created_at,capture_detailed_payloads,payload_expires_at,response_id) values (${logId},${userId},now(),true,now()+interval '1 hour',${randomUUID()})`
    await refreshDiagnosticPolicy()
  })
  afterAll(async () => { await flushDiagnostics(); await client.end() })
  it.each(['generation', 'image_edit', 'speech', 'dictation', 'title', 'memory', 'compaction', 'ocr', 'tool'])('expires %s copies but preserves metadata and rejects late writes', async purpose => {
    const row = (await beginDiagnostic({ requestLogId: logId, purpose }))!
    await writeDiagnosticPayload(row, 'requestPayload', { fidelity: 'redacted', body: { prompt: 'secret\u0000' } })
    await writeDiagnosticPayload(row, 'responsePayload', { fidelity: 'reconstructed', body: { text: 'private' } })
    await updateDiagnostic(row, { httpStatus: 400, providerRequestId: 'req-1' }, 'failed')
    await flushDiagnostics()
    await client`update provider_diagnostics set payload_expires_at=now()-interval '1 second' where id=${row.id}`
    expect((await sampleRetentionBacklog()).overdueRecords).toBe(1)
    const count = await database.transaction(tx => purgeExpiredDetailedPayloads(q => tx.execute(q)))
    expect(count.clearedRecords).toBe(1)
    await writeDiagnosticPayload(row, 'responsePayload', { fidelity: 'exact', body: 'late' })
    updateDiagnostic(row, {}, 'failed'); await flushDiagnostics()
    const [saved] = await client`select * from provider_diagnostics where id=${row.id}`
    expect(saved).toMatchObject({ request_payload: null, response_payload: null, capture_detailed_payloads: false, status: 'failed', metadata: { httpStatus: 400, providerRequestId: 'req-1' } })
    expect((await sampleRetentionBacklog()).overdueRecords).toBe(0)
  })
  it('inherits parent deadlines, supports standalone calls, and cannot recapture after disable', async () => {
    const child = (await beginDiagnostic({ requestLogId: logId, purpose: 'image_edit' }))!
    const standalone = (await beginDiagnostic({ userId, purpose: 'speech' }))!
    updateDiagnostic(child, {}, 'completed'); updateDiagnostic(standalone, {}, 'completed')
    await flushDiagnostics()
    const rows = await client`select id,extract(epoch from (payload_expires_at-retention_started_at)) as seconds from provider_diagnostics`
    expect(Number(rows.find(r => r.id === standalone.id)?.seconds)).toBe(86400)
    expect(Number(rows.find(r => r.id === child.id)?.seconds)).toBeCloseTo(3600, 0)
    await database.transaction(tx => reconcileDetailedPayloadRetention(q => tx.execute(q), { logDetailedPayloads: false, payloadRetention: '24h' }))
    await writeDiagnosticPayload(child, 'responsePayload', { fidelity: 'exact', body: 'late' })
    await refreshDiagnosticPolicy()
    const newer = (await beginDiagnostic({ requestLogId: logId, purpose: 'image_edit' }))!
    expect(newer.capture).toBe(false)
    updateDiagnostic(child, {}, 'completed'); await flushDiagnostics()
    expect((await client`select response_payload from provider_diagnostics where id=${child.id}`)[0]?.response_payload).toBeNull()
  })
  it('does not revive expired captures when extending retention', async () => {
    const row = (await beginDiagnostic({ userId, purpose: 'speech' }))!
    updateDiagnostic(row, {}, 'completed')
    await flushDiagnostics()
    await client`update provider_diagnostics set payload_expires_at=now()-interval '1 second',request_payload='"private"' where id=${row.id}`
    await database.transaction(tx => reconcileDetailedPayloadRetention(q => tx.execute(q), { logDetailedPayloads: true, payloadRetention: 'indefinite' }))
    await database.transaction(tx => purgeExpiredDetailedPayloads(q => tx.execute(q)))
    expect((await client`select capture_detailed_payloads,request_payload from provider_diagnostics`)[0]).toMatchObject({ capture_detailed_payloads: false, request_payload: null })
  })
  it('preserves historical tool data even when its parent logging was disabled', async () => {
    const run = randomUUID(), tool = randomUUID()
    await client`insert into agent_runs select ${run},response_id from request_logs where id=${logId}`
    await client`insert into tool_executions (id,agent_run_id,arguments,output) values (${tool},${run},'{"prompt":"secret"}','"private"')`
    await client`update request_logs set capture_detailed_payloads=false`
    expect((await sampleRetentionBacklog()).overdueRecords).toBe(0)
    await database.transaction(tx => purgeExpiredDetailedPayloads(q => tx.execute(q)))
    expect((await client`select id,arguments,output from tool_executions`)[0]).toEqual({ id: tool, arguments: '{"prompt":"secret"}', output: '"private"' })
  })
  it('rejects stale queued bodies after disable and re-enable while preserving metadata', async () => {
    const row = beginDiagnostic({ userId, purpose: 'speech' })!
    writeDiagnosticPayload(row, 'requestPayload', { fidelity: 'exact', body: 'private' })
    await database.transaction(tx => reconcileDetailedPayloadRetention(q => tx.execute(q), { logDetailedPayloads: false, payloadRetention: '24h' }))
    await database.transaction(tx => reconcileDetailedPayloadRetention(q => tx.execute(q), { logDetailedPayloads: true, payloadRetention: '24h' }))
    updateDiagnostic(row, { httpStatus: 200 }, 'completed'); await flushDiagnostics()
    expect((await client`select * from provider_diagnostics where id=${row.id}`)[0]).toMatchObject({ request_payload: null, capture_detailed_payloads: false, metadata: { httpStatus: 200 } })
  })
  it('deletes old standalone metadata in bounded batches and does not resurrect it', async () => {
    await client`insert into provider_diagnostics(id,user_id,purpose,created_at) select gen_random_uuid(),${userId},'speech',now()-interval '91 days' from generate_series(1,510)`
    const result = await database.transaction(tx => purgeExpiredDetailedPayloads(q => tx.execute(q)))
    expect(result.deletedRecords).toBe(500)
    expect(Number((await client`select count(*) as count from provider_diagnostics`)[0]!.count)).toBe(10)
  })
  it('can persist metadata while another connection holds the global settings advisory lock', async () => {
    const other = postgres(url!, { max: 1 })
    try {
      await other.begin(async tx => {
        await tx`select pg_advisory_xact_lock(1886747744)`
        const row = beginDiagnostic({ userId, purpose: 'speech' })!
        updateDiagnostic(row, { httpStatus: 200 }, 'completed')
        await flushDiagnostics()
        expect((await client`select status from provider_diagnostics where id=${row.id}`)[0]?.status).toBe('completed')
      })
    } finally { await other.end() }
  })

  it('does not revive bodies when retention is shortened then extended before cleanup catches up', async () => {
    await client`insert into provider_diagnostics(id,user_id,purpose,created_at,retention_started_at,payload_expires_at,capture_detailed_payloads,request_payload)
      select gen_random_uuid(),${userId},'speech',now()-interval '2 hours',now()-interval '2 hours',now()+interval '22 hours',true,'"private"' from generate_series(1,1100)`
    await database.transaction(tx => reconcileDetailedPayloadRetention(q => tx.execute(q), { logDetailedPayloads: true, payloadRetention: '1h' }))
    await database.transaction(tx => reconcileDetailedPayloadRetention(q => tx.execute(q), { logDetailedPayloads: true, payloadRetention: 'indefinite' }))
    const [saved] = await client`select * from provider_diagnostics where request_payload is not null limit 1`
    expect(saved).toBeDefined() // The remaining physical copy must still be inaccessible.
    const [policy] = await client`select * from diagnostic_policy`
    expect(diagnosticPayloadAvailability({ captureDetailedPayloads: saved!.capture_detailed_payloads, payloadEpoch: Number(saved!.payload_epoch),
      payloadExpiresAt: new Date(saved!.payload_expires_at), retentionStartedAt: new Date(saved!.retention_started_at), createdAt: new Date(saved!.created_at) },
      { enabled: policy!.enabled, epoch: Number(policy!.epoch), retentionSeconds: policy!.retention_seconds, expiredBefore: new Date(policy!.expired_before) }).active).toBe(false)
  })

})
