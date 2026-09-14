import { realpath } from 'node:fs/promises'
import type { PathPolicy } from '@pulpo/workspace-daemon/core'

/** Keep managed chat storage private even when the chosen working root contains app data. */
export function scopeChatPaths(policy: PathPolicy, storageRoot: string, attachmentsDir: string): PathPolicy {
  const path = policy.path
  const inside = (root: string, target: string) => {
    const relative = path.relative(root, target)
    return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  }
  const allowed = (target: string) => !inside(storageRoot, target) || inside(attachmentsDir, target)
  const check = (target: string) => {
    if (!allowed(target)) throw new Error('Attachments belong to a different chat')
    return target
  }
  // Resolve the nearest existing ancestor too, so a not-yet-created attachment
  // cannot escape through a symlink in its chat directory.
  const canonical = async (target: string): Promise<string> => {
    try { return await realpath(target) } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
      const parent = path.dirname(target)
      if (parent === target) return target
      return path.join(await canonical(parent), path.basename(target))
    }
  }
  const checked = async (target: string) => {
    check(target)
    const resolved = await canonical(target)
    check(resolved)
    if (inside(attachmentsDir, target) && !inside(attachmentsDir, resolved)) throw new Error('Attachment path escapes this chat')
    return target
  }
  return {
    ...policy,
    isReadable: (target) => allowed(target) && policy.isReadable(target),
    isWritable: (target) => allowed(target) && policy.isWritable(target),
    writable: (value) => check(policy.writable(value)),
    writableChecked: async (value) => checked(await policy.writableChecked(value)),
    readable: async (value) => checked(await policy.readable(value)),
    exportable: async (value) => {
      await checked(path.resolve(policy.root, String(value)))
      return checked(await policy.exportable(value))
    },
  }
}
