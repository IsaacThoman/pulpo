import { expect, it, vi } from 'vitest'
vi.mock('expo-sqlite', () => ({ openDatabaseAsync: vi.fn() }))
import { openDatabaseAsync } from 'expo-sqlite'
import { loadDraft, saveDraft } from './database'

it('keeps temporary composer drafts in the runtime cache instead of SQLite', async () => {
  await saveDraft('account', 'temporary:new', 'private draft', [])
  expect(await loadDraft('account', 'temporary:new')).toBeNull()
  expect(openDatabaseAsync).not.toHaveBeenCalled()
})
