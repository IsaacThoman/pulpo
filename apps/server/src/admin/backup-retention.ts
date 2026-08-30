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
