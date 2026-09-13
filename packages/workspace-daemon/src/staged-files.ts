import { lstat, stat } from 'node:fs/promises'

type Stamp = { checksum: string; size: number; mtimeMs: number; ctimeMs: number; ino: number }

/** Lives with the lease's daemon; a restart safely causes one fresh staging pass. */
export class StagedFiles {
  private files = new Map<string, Stamp>()
  async record(path: string, checksum: string): Promise<void> {
    const metadata = await stat(path)
    this.files.set(path, { checksum, size: metadata.size, mtimeMs: metadata.mtimeMs, ctimeMs: metadata.ctimeMs, ino: metadata.ino })
  }
  async matches(path: string, checksum: string | null, size: number): Promise<boolean> {
    const stamp = this.files.get(path)
    if (!checksum || !stamp || stamp.checksum !== checksum || stamp.size !== size) return false
    try {
      const metadata = await lstat(path)
      return metadata.isFile() && metadata.size === stamp.size && metadata.mtimeMs === stamp.mtimeMs
        && metadata.ctimeMs === stamp.ctimeMs && metadata.ino === stamp.ino
    } catch { return false }
  }
}
