import { describe, expect, it } from 'vitest'
import { fillMissingUsernames } from './username.js'

describe('fillMissingUsernames', () => {
  it('assigns pulpo plus an unused integer to missing or reserved usernames', () => {
    const rows: Array<Record<string, unknown>> = [
      { id: 'existing', username: 'Pulpo42' },
      { id: 'reserved', username: 'friends' },
      { id: 'missing', username: null },
      { id: 'absent' },
    ]
    const values = [42, 7, 42, 9, 11]

    fillMissingUsernames(rows, () => values.shift()!)

    expect(rows).toEqual([
      { id: 'existing', username: 'Pulpo42' },
      { id: 'reserved', username: 'pulpo7' },
      { id: 'missing', username: 'pulpo9' },
      { id: 'absent', username: 'pulpo11' },
    ])
  })
})
