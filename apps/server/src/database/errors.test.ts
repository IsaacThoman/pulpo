import { describe, expect, it } from 'vitest'
import { hasDatabaseErrorCode } from './errors.js'

describe('hasDatabaseErrorCode', () => {
  it('finds a Postgres error wrapped by the database client', () => {
    const postgresError = Object.assign(new Error('foreign key violation'), { code: '23503' })
    expect(hasDatabaseErrorCode(new Error('query failed', { cause: postgresError }), '23503')).toBe(true)
  })

  it('handles unrelated and circular error chains', () => {
    const error = Object.assign(new Error('query failed'), { code: '22001' })
    Object.assign(error, { cause: error })
    expect(hasDatabaseErrorCode(error, '23503')).toBe(false)
  })
})
