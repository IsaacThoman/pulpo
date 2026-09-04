import { describe, expect, it } from 'vitest'
import { notesQueryKey } from './api'

describe('notes query keys', () => {
  it('keeps active, trash, and search results under one realtime invalidation prefix', () => {
    expect(notesQueryKey('user', false, 'roadmap')).toEqual(['notes', 'user', 'active', 'roadmap'])
    expect(notesQueryKey('user', true, '')).toEqual(['notes', 'user', 'trash', ''])
  })
})
