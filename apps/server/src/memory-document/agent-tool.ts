import { Type } from '@earendil-works/pi-ai'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import {
  applyMemoryDocumentEdits,
  type MemoryDocumentEdit,
  MemoryDocumentError,
  readMemoryDocument,
  updateMemoryDocument,
} from './service.js'

const UPDATE_MEMORY_DESCRIPTION = `Edit the user's MEMORY.md profile using atomic text operations.
Use this tool when the user directly asks you to remember, change, or forget information. Without a direct request, use it only for an explicit identity confirmation or explicit preference confirmation.
Never save guesses, assistant-authored or recalled claims, tool output, incidental biography, credentials, authentication tokens, private keys, or other secrets.
Consolidate existing material instead of appending duplicates. Current explicit user statements take precedence over stale MEMORY.md content.`

type MemoryUpdateBasis = 'user_request' | 'identity_confirmation' | 'preference_confirmation'

const DIRECT_MEMORY_REQUEST = /\b(?:remember|memorize|save (?:this|that)|keep (?:this|that) in mind|forget|stop remembering|memory\.md|memory document|recuerda|recordar|olvida|olvidar|memoria)\b/i
const IDENTITY_CONFIRMATION = /\b(?:my name is|call me|i am|i'm|me llamo|soy)\b/i
const PREFERENCE_CONFIRMATION = /\b(?:i prefer|i like|i dislike|i (?:do not|don't) like|my preference is|please always|please never|prefiero|me gusta|no me gusta)\b/i
const SECRET_LIKE_CONTENT = /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:password|passphrase|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|private[_ -]?key|client[_ -]?secret)\s*[:=]|\bBearer\s+[A-Za-z0-9._~+/-]+=*|\bsk-[A-Za-z0-9_-]{16,}|\bgh[opusr]_[A-Za-z0-9]{20,}|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b)/i

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

function changedText(edit: MemoryDocumentEdit): string {
  if (edit.operation === 'replace') return edit.newText
  return edit.operation === 'append' ? edit.text : ''
}

export function validateMemoryUpdateBasis(basis: MemoryUpdateBasis, userMessage: string): void {
  const permitted = basis === 'user_request'
    ? DIRECT_MEMORY_REQUEST.test(userMessage)
    : basis === 'identity_confirmation'
      ? IDENTITY_CONFIRMATION.test(userMessage)
      : PREFERENCE_CONFIRMATION.test(userMessage)
  if (!permitted) {
    throw new MemoryDocumentError(
      'memory_document_basis_not_permitted',
      'The current user message does not permit this kind of MEMORY.md update',
    )
  }
}

export function createMemoryDocumentTool(input: {
  userId: string
  responseId: string
  userMessage: string
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
      basis: Type.Union([
        Type.Literal('user_request'),
        Type.Literal('identity_confirmation'),
        Type.Literal('preference_confirmation'),
      ], { description: 'Why this update is permitted.' }),
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
      if (!['user_request', 'identity_confirmation', 'preference_confirmation'].includes(String(args.basis))) {
        throw new Error('basis must describe a permitted memory update')
      }
      const basis = args.basis as MemoryUpdateBasis
      validateMemoryUpdateBasis(basis, input.userMessage)
      if (typeof args.summary !== 'string' || !args.summary.trim()) throw new Error('summary is required')
      if (!Array.isArray(args.edits)) throw new Error('edits must be an array')
      const edits = args.edits.map(parseEdit)
      if (SECRET_LIKE_CONTENT.test(args.summary) || edits.some((edit) => SECRET_LIKE_CONTENT.test(changedText(edit)))) {
        throw new MemoryDocumentError('memory_document_secret_rejected', 'Credentials and secrets cannot be saved to MEMORY.md')
      }
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
        details: { kind: 'memory_document_update', revision: updated.revision, basis: args.basis, summary },
      }
    },
  }
}
