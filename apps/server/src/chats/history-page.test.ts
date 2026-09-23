import { expect, it } from 'vitest'
import { historyPageQuery, selectHistoryPage } from './history-page.js'
const rows = Array.from({ length: 1200 }, (_, i) => ({ id: String(i), parentResponseId: i ? String(i - 1) : null, input: [] }))
it('pages backward on the selected lineage without skipping or repeating turns', () => {
  const newest = selectHistoryPage(rows, '1199', 500)
  expect(newest.turns).toEqual(rows.slice(700))
  expect(newest.history).toEqual({ offset: 700, hasMore: true, before: '700', leafId: '1199' })
  const older = selectHistoryPage(rows, '1199', 500, newest.history.before!)
  expect(older.turns).toEqual(rows.slice(200, 700))
  const oldest = selectHistoryPage(rows, '1199', 500, older.history.before!)
  expect(oldest.turns).toEqual(rows.slice(0, 200))
  expect(oldest.history.hasMore).toBe(false)
})
it('rejects a cursor on an abandoned branch and bounds page sizes', () => {
  expect(() => selectHistoryPage(rows, '20', 500, '100')).toThrow('branch changed')
  expect(historyPageQuery.safeParse({ historyLimit: 1001 }).success).toBe(false)
  expect(historyPageQuery.safeParse({ historyLimit: 0 }).success).toBe(false)
  expect(historyPageQuery.safeParse({ historyLimit: 500, before: 'bad' }).success).toBe(false)
})
