import { describe, expect, it, vi } from 'vitest'
import { deleteExpiredBackupObjects } from './backup-retention.js'

describe('backup retention', () => {
  it('deletes metadata only after its archive is removed', async () => {
    const deleteObject = vi.fn(async (key: string) => {
      if (key === 'backups/retry.tar.gz') throw new Error('storage unavailable')
    })

    const deleted = await deleteExpiredBackupObjects([
      { id: 'deleted', objectKey: 'backups/deleted.tar.gz' },
      { id: 'retry', objectKey: 'backups/retry.tar.gz' },
      { id: 'metadata-only', objectKey: null },
    ], deleteObject)

    expect(deleteObject).toHaveBeenCalledTimes(2)
    expect(deleted).toEqual(['deleted', 'metadata-only'])
  })
})
