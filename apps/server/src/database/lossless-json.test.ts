import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import * as schema from './schema.js'
import { decodePayloadRow, encodePayloadRow, LOSSLESS_PAYLOAD_COLUMNS, serializeLosslessJson } from './lossless-json.js'
import { unusualPayload, unusualText } from './fixtures/windows-tool-output.js'

it.each([unusualPayload, unusualText, '', null, [], {}, 'null', '\\u0000'])('preserves JSON values without sanitization: %j', value => {
  const encoded = serializeLosslessJson(value)
  expect(encoded).not.toContain('\0')
  expect(JSON.parse(encoded)).toEqual(value)
})

it('keeps backup wire values logical and preserves nullable columns', () => {
  const row = { id: 'response', input: unusualPayload, output: [], error: null, instructions: unusualText }
  const encoded = encodePayloadRow('responses', row)
  expect(encoded.error).toBeNull()
  expect(encoded.id).toBe(row.id)
  expect(encoded.instructions).toBe(JSON.stringify(unusualText))
  expect(decodePayloadRow('responses', encoded)).toEqual(row)
  expect(row.input).toEqual(unusualPayload)
})

it('does not collapse SQL NULL, JSON null, or the string null in raw storage', () => {
  expect(decodePayloadRow('responses', { error: null }).error).toBeNull()
  expect(decodePayloadRow('responses', { error: 'null' }).error).toBeNull()
  expect(decodePayloadRow('responses', { error: '"null"' }).error).toBe('null')
})

describe('raw SQL adapter coverage', () => {
  it('lists every custom lossless column and no ordinary operational column', () => {
    const actual: Record<string, string[]> = {}
    for (const value of Object.values(schema)) {
      if (!value || typeof value !== 'object') continue
      let config: ReturnType<typeof getTableConfig>
      try { config = getTableConfig(value as PgTable) } catch { continue }
      for (const column of config.columns) {
        if (column.getSQLType() === 'text' && column.mapToDriverValue(unusualText) === JSON.stringify(unusualText)) {
          (actual[config.name] ??= []).push(column.name)
        }
      }
    }
    const sorted = (map: Record<string, readonly string[]>) => Object.fromEntries(Object.entries(map).map(([key, columns]) => [key, [...columns].sort()]))
    expect(sorted(actual)).toEqual(sorted(LOSSLESS_PAYLOAD_COLUMNS))
  })
})
