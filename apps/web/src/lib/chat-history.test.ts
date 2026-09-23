import { expect, it } from 'vitest'
import { mergeHistory } from './chat-history'
const rows = Array.from({ length: 1200 }, (_, i) => ({ id: String(i), parentResponseId: i ? String(i - 1) : null }))

it('prepends without losing the latest leaf and preserves the absolute offset on refetch', () => {
  const first = rows.slice(700)
  const older = mergeHistory(first, rows.slice(200, 700), { offset: 200, leafId: '1199', before: '200', hasMore: true })
  expect(older.responses).toEqual(rows.slice(200))
  expect(older.history.offset).toBe(200)
  const refreshed = mergeHistory(older.responses, first, { offset: 700, leafId: '1199', before: '700', hasMore: true })
  expect(refreshed.responses).toEqual(older.responses)
  expect(refreshed.history).toEqual(older.history)
})

it('discards the abandoned tail on branch changes and deletion', () => {
  const branch = { id: 'edited', parentResponseId: '500' }
  const merged = mergeHistory(rows, [rows[500]!, branch], { offset: 500, leafId: 'edited', before: '500', hasMore: true })
  expect(merged.responses).toEqual([...rows.slice(0, 501), branch])
  expect(merged.history).toMatchObject({ offset: 0, hasMore: false, leafId: 'edited' })
})
