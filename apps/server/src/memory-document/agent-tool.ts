import { Type } from '@earendil-works/pi-ai'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import {
  applyMemoryDocumentEdits,
  type MemoryDocumentEdit,
  MemoryDocumentError,
  readMemoryDocument,
  updateMemoryDocument,
} from './service.js'

const UPDATE_MEMORY_DESCRIPTION = `Edit the user's MEMORY.md profile using atomic text operations whenever doing so would improve future conversations.
Treat MEMORY.md as a concise, model-maintained notebook about the user. Consolidate existing material instead of appending duplicates, and keep it useful rather than exhaustive.`

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function parseEdit(value: unknown): MemoryDocumentEdit {
  const edit = record(value)
  if (edit.operation === 'append' && typeof edit.text === 'string') {
    return { operation: 'append', text: edit.text }
  }
  if (edit.operation === 'replace' && typeof edit.old_text === 'string' && typeof edit.new_text === 'string') {
    return { operation: 'replace', oldText: edit.old_text, newText: edit.new_text }
  }
  if (edit.operation === 'delete' && typeof edit.text === 'string') {
    return { operation: 'delete', text: edit.text }
  }
  throw new Error('Each memory edit must be a valid append, replace, or delete operation')
}

export function createMemoryDocumentTool(input: {
  userId: string
  responseId: string
  onOperationStarted?: (operationId: string) => void | Promise<void>
  read?: typeof readMemoryDocument
  update?: typeof updateMemoryDocument
}): AgentTool {
  const read = input.read ?? readMemoryDocument
  const update = input.update ?? updateMemoryDocument
  return {
    name: 'update_memory',
    label: 'update_memory',
    description: UPDATE_MEMORY_DESCRIPTION,
    parameters: Type.Object({
      expected_revision: Type.Integer({ minimum: 0, description: 'Current MEMORY.md revision shown in the system context.' }),
      summary: Type.String({ minLength: 1, maxLength: 240, description: 'Short user-facing description of the change.' }),
      edits: Type.Array(Type.Union([
        Type.Object({
          operation: Type.Literal('append'),
          text: Type.String({ minLength: 1, maxLength: 16_000 }),
        }, { additionalProperties: false }),
        Type.Object({
          operation: Type.Literal('replace'),
          old_text: Type.String({ minLength: 1, maxLength: 16_000 }),
          new_text: Type.String({ maxLength: 16_000 }),
        }, { additionalProperties: false }),
        Type.Object({
          operation: Type.Literal('delete'),
          text: Type.String({ minLength: 1, maxLength: 16_000 }),
        }, { additionalProperties: false }),
      ]), { minItems: 1, maxItems: 10 }),
    }, { additionalProperties: false }),
    executionMode: 'sequential',
    execute: async (id, rawArgs, signal) => {
      signal?.throwIfAborted()
      await input.onOperationStarted?.(id)
      const args = record(rawArgs)
      const expectedRevision = Number(args.expected_revision)
      if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new Error('expected_revision must be a non-negative integer')
      if (typeof args.summary !== 'string' || !args.summary.trim()) throw new Error('summary is required')
      if (!Array.isArray(args.edits)) throw new Error('edits must be an array')
      const edits = args.edits.map(parseEdit)
      const current = await read(input.userId)
      if (current.revision !== expectedRevision) {
        throw new MemoryDocumentError('memory_document_conflict', 'MEMORY.md changed; do not overwrite it without the latest revision', current.revision)
      }
      const content = applyMemoryDocumentEdits(current.content, edits)
      signal?.throwIfAborted()
      const updated = await update({
        userId: input.userId,
        expectedRevision,
        content,
        editor: 'agent',
        summary: args.summary,
        sourceResponseId: input.responseId,
      })
      const summary = args.summary.replace(/\s+/g, ' ').trim().slice(0, 240)
      return {
        content: [{ type: 'text' as const, text: `Updated MEMORY.md to revision ${updated.revision}: ${summary}` }],
        details: { kind: 'memory_document_update', revision: updated.revision, summary },
      }
    },
  }
}
