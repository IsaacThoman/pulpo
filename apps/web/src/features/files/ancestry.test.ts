import { describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { movesIntoItself } from './ancestry'

// The query keys only; the API module brings in the settings store, which needs a browser.
vi.mock('./api', () => ({
  folderQueryKey: (userId: string | undefined, folderId: string | null) => ['files', userId, 'folder', folderId ?? 'root'],
  fileNodeQueryKey: (userId: string | undefined, id: string) => ['files', userId, 'node', id],
}))
const { fileNodeQueryKey, folderQueryKey } = await import('./api')

const folder = (id: string) => ({ id })

describe('moving a folder into itself', () => {
  const client = new QueryClient()
  client.setQueryData(folderQueryKey('user', 'mobile'), { folder: folder('mobile'), ancestors: [folder('projects')], children: [] })
  client.setQueryData(fileNodeQueryKey('user', 'drafts'), { node: folder('drafts'), ancestors: [folder('projects'), folder('mobile')] })

  it('is refused into the folder itself or a folder inside it, as far as the cache knows', () => {
    expect(movesIntoItself(client, 'user', 'mobile', [folder('projects')])).toBe(true)
    expect(movesIntoItself(client, 'user', 'drafts', [folder('mobile')])).toBe(true)
    expect(movesIntoItself(client, 'user', 'mobile', [folder('mobile')])).toBe(true)
  })

  it('is allowed elsewhere, including My files and folders the cache has not seen', () => {
    expect(movesIntoItself(client, 'user', 'projects', [folder('mobile')])).toBe(false)
    expect(movesIntoItself(client, 'user', null, [folder('projects')])).toBe(false)
    expect(movesIntoItself(client, 'user', 'unknown', [folder('projects')])).toBe(false)
    expect(movesIntoItself(client, 'other', 'mobile', [folder('projects')])).toBe(false)
  })
})
