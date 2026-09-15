import { customType } from 'drizzle-orm/pg-core'

/** Store serialized JSON as text: PostgreSQL must never interpret its Unicode escapes. */
export function serializeLosslessJson(value: unknown): string {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new TypeError('Payload must be JSON serializable')
  return serialized
}

export const losslessJson = customType<{ data: unknown; driverData: string }>({
  dataType: () => 'text',
  toDriver: serializeLosslessJson,
  fromDriver: (value) => JSON.parse(value),
})

/** Same representation for arbitrary text, retaining the application's string type. */
export const losslessText = customType<{ data: string; driverData: string }>({
  dataType: () => 'text',
  toDriver: serializeLosslessJson,
  fromDriver: (value) => JSON.parse(value) as string,
})

/** Raw SQL backup/restore bypasses column codecs. Keep this registry in sync with schema. */
export const LOSSLESS_PAYLOAD_COLUMNS: Record<string, readonly string[]> = {
  provider_diagnostics: ['request_payload', 'response_payload'],
  responses: ['input', 'instructions', 'parameters', 'metadata', 'output', 'error', 'incomplete_details'],
  response_items: ['payload'],
  response_content_parts: ['payload'],
  agent_runs: ['context', 'error'],
  agent_questions: ['item'],
  tool_executions: ['arguments', 'output', 'error', 'provider_attempts'],
  request_logs: ['request_payload', 'response_payload', 'error_message'],
  generation_attempts: ['error_message'],
  ocr_attempts: ['request_payload', 'response_payload', 'error_message'],
  ocr_cache_entries: ['text'],
}

export function decodePayloadRow(table: string, row: Record<string, unknown>): Record<string, unknown> {
  const decoded = { ...row }
  for (const column of LOSSLESS_PAYLOAD_COLUMNS[table] ?? []) {
    if (decoded[column] != null) decoded[column] = JSON.parse(decoded[column] as string)
  }
  return decoded
}

export function encodePayloadRow(table: string, row: Record<string, unknown>): Record<string, unknown> {
  const encoded = { ...row }
  for (const column of LOSSLESS_PAYLOAD_COLUMNS[table] ?? []) {
    if (encoded[column] != null) encoded[column] = serializeLosslessJson(encoded[column])
  }
  return encoded
}
