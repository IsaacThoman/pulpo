import { describe, expect, it } from 'vitest'
import { hasDatabaseErrorCode } from './errors.js'

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
