import { describe, expect, it } from 'vitest'
import { FULL_BACKUP_TABLES } from './backup-format.js'
import {
  FULL_BACKUP_TEMPORARY_DATA_POLICY,
  projectFullBackup,
  type FullBackupDatabase,
  type FullBackupRow,
} from './backup-projection.js'

function databaseWith(overrides: Partial<Record<keyof FullBackupDatabase, FullBackupRow[]>>): FullBackupDatabase {
  return Object.fromEntries(FULL_BACKUP_TABLES.map((table) => [table, overrides[table] ?? []])) as FullBackupDatabase
}

const rowIds = (rows: FullBackupRow[]) => rows.map((row) => row.id)

describe('temporary chat backup projection', () => {
  it('requires every full-backup table to declare a temporary-data policy', () => {
    expect(Object.keys(FULL_BACKUP_TEMPORARY_DATA_POLICY).sort()).toEqual([...FULL_BACKUP_TABLES].sort())
  })

  it('excludes active and expired temporary chat graphs without mutating the source snapshot', () => {
    const source = databaseWith({
      chats: [
        { id: 'chat-normal', temporary: false },
        { id: 'chat-active-temp', temporary: true, expires_at: '2099-01-01' },
        { id: 'chat-expired-temp', temporary: true, expires_at: '2000-01-01' },
      ],
      responses: [
        { id: 'response-normal', chat_id: 'chat-normal' },
        { id: 'response-active-temp', chat_id: 'chat-active-temp' },
        { id: 'response-expired-temp', chat_id: 'chat-expired-temp' },
      ],
      response_items: [
        { id: 'item-normal', response_id: 'response-normal' },
        { id: 'item-temp', response_id: 'response-active-temp' },
      ],
      response_content_parts: [
        { id: 'part-normal', response_item_id: 'item-normal' },
        { id: 'part-temp', response_item_id: 'item-temp' },
      ],
      chat_shares: [
        { id: 'share-normal', chat_id: 'chat-normal' },
        { id: 'share-temp', chat_id: 'chat-active-temp' },
      ],
      attachments: [
        { id: 'attachment-normal', chat_id: 'chat-normal', source_response_id: 'response-normal', status: 'ready', object_key: 'normal-file', checksum: 'normal-checksum' },
        { id: 'attachment-user', chat_id: null, source_response_id: null, status: 'ready', object_key: 'user-file', checksum: 'user-checksum' },
        { id: 'attachment-active-temp', chat_id: 'chat-active-temp', status: 'ready', object_key: 'active-temp-file', checksum: 'active-temp-checksum' },
        { id: 'attachment-expired-temp', chat_id: 'chat-expired-temp', status: 'pending', object_key: 'expired-temp-file', checksum: 'expired-temp-checksum' },
        { id: 'attachment-generated-temp', chat_id: null, source_response_id: 'response-active-temp', status: 'ready', object_key: 'generated-temp-file', checksum: 'generated-temp-checksum' },
        { id: 'attachment-queued-temp', chat_id: null, source_response_id: null, status: 'ready', object_key: 'queued-temp-file', checksum: 'queued-temp-checksum' },
      ],
      composer_drafts: [
        { id: 'draft-normal', chat_id: 'chat-normal', scope: 'chat-normal' },
        { id: 'draft-new', chat_id: null, scope: 'new' },
        { id: 'draft-temp', chat_id: 'chat-active-temp', scope: 'chat-active-temp' },
      ],
      composer_draft_attachments: [
        { draft_id: 'draft-normal', attachment_id: 'attachment-normal', position: 0 },
        { draft_id: 'draft-new', attachment_id: 'attachment-user', position: 0 },
        { draft_id: 'draft-temp', attachment_id: 'attachment-active-temp', position: 0 },
      ],
      user_memory_documents: [{ user_id: 'user', source_response_id: 'response-active-temp', content: 'durable memory' }],
      user_memory_document_revisions: [
        { id: 'memory-normal', source_response_id: 'response-normal' },
        { id: 'memory-temp', source_response_id: 'response-expired-temp' },
      ],
      chat_turn_embeddings: [
        { id: 'embedding-normal', chat_id: 'chat-normal', response_id: 'response-normal' },
        { id: 'embedding-temp', chat_id: 'chat-active-temp', response_id: 'response-active-temp' },
        { id: 'embedding-temp-response', chat_id: 'chat-normal', response_id: 'response-active-temp' },
      ],
      credit_ledger: [
        { id: 'credit-normal', response_id: 'response-normal' },
        { id: 'credit-temp', response_id: 'response-active-temp' },
      ],
      usage_events: [
        { id: 'usage-normal', response_id: 'response-normal' },
        { id: 'usage-temp', response_id: 'response-expired-temp' },
      ],
      request_logs: [
        { id: 'log-normal', response_id: 'response-normal' },
        { id: 'log-temp', response_id: 'response-active-temp' },
      ],
      generation_attempts: [
        { id: 'generation-normal', request_log_id: 'log-normal' },
        { id: 'generation-temp', request_log_id: 'log-temp' },
      ],
      ocr_attempts: [
        { id: 'ocr-normal', request_log_id: 'log-normal', attachment_id: 'attachment-normal' },
        { id: 'ocr-temp-log', request_log_id: 'log-temp', attachment_id: null },
        { id: 'ocr-temp-attachment', request_log_id: 'log-normal', attachment_id: 'attachment-active-temp' },
      ],
      ocr_cache_entries: [
        { checksum: 'normal-checksum', text: 'normal text' },
        { checksum: 'active-temp-checksum', text: 'temporary text' },
        { checksum: 'generated-temp-checksum', text: 'generated temporary text' },
        { checksum: 'queued-temp-checksum', text: 'queued temporary text' },
      ],
      chat_import_sources: [
        { source_chat_id: 'source-normal', chat_id: 'chat-normal' },
        { source_chat_id: 'source-temp', chat_id: 'chat-active-temp' },
      ],
      workspace_leases: [
        { id: 'lease-normal', chat_id: 'chat-normal', response_id: 'response-normal' },
        { id: 'lease-redacted', chat_id: 'chat-normal', response_id: 'response-active-temp' },
        { id: 'lease-temp', chat_id: 'chat-active-temp', response_id: 'response-active-temp' },
      ],
      agent_runs: [
        { id: 'run-normal', response_id: 'response-normal', workspace_lease_id: 'lease-normal' },
        { id: 'run-temp-response', response_id: 'response-active-temp', workspace_lease_id: null },
        { id: 'run-temp-lease', response_id: 'response-normal', workspace_lease_id: 'lease-temp' },
      ],
      tool_executions: [
        { id: 'tool-normal', agent_run_id: 'run-normal', workspace_lease_id: 'lease-normal' },
        { id: 'tool-temp-run', agent_run_id: 'run-temp-response', workspace_lease_id: null },
        { id: 'tool-temp-lease', agent_run_id: 'run-normal', workspace_lease_id: 'lease-temp' },
      ],
    })

    const result = projectFullBackup(source, { temporaryQueuedAttachmentIds: ['attachment-queued-temp'] })

    expect(rowIds(result.database.chats)).toEqual(['chat-normal'])
    expect(rowIds(result.database.responses)).toEqual(['response-normal'])
    expect(rowIds(result.database.response_items)).toEqual(['item-normal'])
    expect(rowIds(result.database.response_content_parts)).toEqual(['part-normal'])
    expect(rowIds(result.database.chat_shares)).toEqual(['share-normal'])
    expect(rowIds(result.database.attachments)).toEqual(['attachment-normal', 'attachment-user'])
    expect(rowIds(result.database.composer_drafts)).toEqual(['draft-normal', 'draft-new'])
    expect(result.database.composer_draft_attachments).toEqual([
      { draft_id: 'draft-normal', attachment_id: 'attachment-normal', position: 0 },
      { draft_id: 'draft-new', attachment_id: 'attachment-user', position: 0 },
    ])
    expect(rowIds(result.database.chat_turn_embeddings)).toEqual(['embedding-normal'])
    expect(result.database.chat_import_sources).toEqual([{ source_chat_id: 'source-normal', chat_id: 'chat-normal' }])
    expect(result.database.workspace_leases).toEqual([
      { id: 'lease-normal', chat_id: 'chat-normal', response_id: 'response-normal' },
      { id: 'lease-redacted', chat_id: 'chat-normal', response_id: null },
    ])
    expect(rowIds(result.database.agent_runs)).toEqual(['run-normal'])
    expect(rowIds(result.database.tool_executions)).toEqual(['tool-normal'])
    expect(rowIds(result.database.request_logs)).toEqual(['log-normal'])
    expect(rowIds(result.database.generation_attempts)).toEqual(['generation-normal'])
    expect(rowIds(result.database.ocr_attempts)).toEqual(['ocr-normal'])
    expect(result.database.ocr_cache_entries).toEqual([{ checksum: 'normal-checksum', text: 'normal text' }])
    expect(result.attachmentBlobs).toEqual([
      { objectKey: 'normal-file', checksum: 'normal-checksum' },
      { objectKey: 'user-file', checksum: 'user-checksum' },
    ])

    expect(result.database.credit_ledger).toEqual([
      { id: 'credit-normal', response_id: 'response-normal' },
      { id: 'credit-temp', response_id: null },
    ])
    expect(result.database.usage_events).toEqual([
      { id: 'usage-normal', response_id: 'response-normal' },
      { id: 'usage-temp', response_id: null },
    ])
    expect(result.database.user_memory_documents[0]).toMatchObject({ source_response_id: null, content: 'durable memory' })
    expect(result.database.user_memory_document_revisions).toEqual([
      { id: 'memory-normal', source_response_id: 'response-normal' },
      { id: 'memory-temp', source_response_id: null },
    ])

    expect(source.credit_ledger[1]?.response_id).toBe('response-active-temp')
    expect(source.user_memory_documents[0]?.source_response_id).toBe('response-active-temp')
  })

  it('leaves no projected references or blob entries for temporary entities', () => {
    const source = databaseWith({
      chats: [{ id: 'temp-chat', temporary: true }],
      responses: [{ id: 'temp-response', chat_id: 'temp-chat' }],
      response_items: [{ id: 'temp-item', response_id: 'temp-response' }],
      response_content_parts: [{ id: 'temp-part', response_item_id: 'temp-item' }],
      attachments: [{ id: 'temp-attachment', chat_id: 'temp-chat', status: 'ready', object_key: 'temp-blob', checksum: 'temp-checksum' }],
      request_logs: [{ id: 'temp-log', response_id: 'temp-response' }],
      generation_attempts: [{ id: 'temp-attempt', request_log_id: 'temp-log' }],
      ocr_attempts: [{ id: 'temp-ocr', request_log_id: 'temp-log', attachment_id: 'temp-attachment' }],
      ocr_cache_entries: [{ checksum: 'temp-checksum', text: 'secret' }],
    })

    const result = projectFullBackup(source)
    const serialized = JSON.stringify(result)

    for (const value of [
      'temp-chat', 'temp-response', 'temp-item', 'temp-part', 'temp-attachment', 'temp-log',
      'temp-attempt', 'temp-ocr', 'temp-checksum', 'temp-blob', 'secret',
    ]) {
      expect(serialized).not.toContain(value)
    }
  })
})
