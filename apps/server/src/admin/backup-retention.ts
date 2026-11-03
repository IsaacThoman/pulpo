/**
 * Object Lock dates are stored with whole-second precision. Round up so the
 * lock never ends before the requested time and reads back exactly as sent.
 */
export function wholeSecondLock(date: Date): Date {
  return new Date(Math.ceil(date.getTime() / 1_000) * 1_000)
}

export interface ExpiredBackupObject {
  id: string
  objectKey: string | null
}

export async function deleteExpiredBackupObjects(
  jobs: ExpiredBackupObject[],
  deleteObject: (key: string) => Promise<void>,
): Promise<string[]> {
  const deletedJobIds: string[] = []
  for (const job of jobs) {
    try {
      if (job.objectKey) await deleteObject(job.objectKey)
      deletedJobIds.push(job.id)
    } catch {
      // Keep the job so cleanup can retry rather than orphaning its archive.
    }
  }
  return deletedJobIds
}
