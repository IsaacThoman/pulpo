import { DrizzleQueryError } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { databaseErrorDetails, hasDatabaseErrorCode, safeErrorMessage } from './errors.js'

describe('hasDatabaseErrorCode', () => {
  it('finds a PostgreSQL error code wrapped by the query layer', () => {
    const postgresError = Object.assign(new Error('duplicate key value'), { code: '23505' })
    const queryError = new Error('Failed query', { cause: postgresError })

    expect(hasDatabaseErrorCode(queryError, '23505')).toBe(true)
  })

  it('returns false for unrelated and cyclic errors', () => {
    const error = new Error('unrelated') as Error & { cause?: unknown }
    error.cause = error

    expect(hasDatabaseErrorCode(error, '23505')).toBe(false)
  })
})


it('extracts diagnostics without query text, parameters, detail or stack', () => {
  const cause = Object.assign(new Error('private payload'), { name: 'PostgresError', code: '22P05', detail: 'private payload' })
  const error = Object.assign(new Error('Failed query: private payload', { cause }), {
    name: 'DrizzleQueryError', query: 'insert into responses values (private payload)', params: ['private payload'],
  })
  expect(databaseErrorDetails(error)).toEqual({ code: '22P05', operation: 'insert' })
  expect(safeErrorMessage(new Error('wrapper private payload', { cause: error }))).toBe('Database insert failed (22P05)')
  expect(JSON.stringify(databaseErrorDetails(error))).not.toContain('private')
})

it('handles cycles and non-database errors', () => {
  const error = new Error('ordinary failure'); error.cause = error
  expect(databaseErrorDetails(error)).toBeUndefined()
  expect(safeErrorMessage(error)).toBe('ordinary failure')
})


it('redacts actual Drizzle connection failures that have no PostgreSQL error name', () => {
  const error = new DrizzleQueryError('insert into responses values ($1)', ['private prompt'], new Error('socket closed'))
  expect(databaseErrorDetails(error)).toEqual({ operation: 'insert', code: 'unknown' })
  expect(safeErrorMessage(error)).not.toContain('private prompt')
})
