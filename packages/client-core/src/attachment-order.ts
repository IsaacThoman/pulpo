/** Preserve pending files' slots while applying the shared order of ready files. */
export function mergePendingAttachments<T>(current: readonly T[], remote: readonly T[], key: (item: T) => string, pending: (item: T) => boolean): T[] {
  const remoteIds = new Set(remote.map(key))
  const merged: T[] = []
  let index = 0
  for (const item of current) {
    if (pending(item) && !remoteIds.has(key(item))) merged.push(item)
    else if (index < remote.length) merged.push(remote[index++]!)
  }
  merged.push(...remote.slice(index))
  return merged
}
