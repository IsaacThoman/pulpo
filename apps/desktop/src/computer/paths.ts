import { lstat, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { ComputerError } from './errors'

/**
 * Folder modes confine every path the agent names to the session's folder. Paths arrive from the
 * server as `/`-separated relative paths; anything that could name a different place (absolute
 * paths, `..`, drive letters, device names, aliases Windows silently rewrites) is refused before
 * the disk is touched, and what remains is resolved through `realpath` so a symlink can never lead
 * out of the folder.
 */

const WINDOWS_RESERVED = /^(con|prn|aux|nul|conin\$|conout\$|clock\$|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i
// eslint-disable-next-line no-control-regex
const WINDOWS_FORBIDDEN = /[<>:"|?*\u0000-\u001f]/

function outside(requested: string): ComputerError {
  return new ComputerError('outside_folder', `"${requested}" is not inside the folder. Use a path relative to the folder, without "..".`)
}

/** Splits a folder-relative path into segments, refusing anything that is not plainly inside. `''` and `.` mean the folder itself. */
export function folderPathSegments(requested: string, platform: NodeJS.Platform): string[] {
  if (typeof requested !== 'string' || requested.includes('\0')) throw outside(String(requested))
  // Backslashes are separators on Windows and never appear in the agent's (Linux) paths.
  if (requested.includes('\\') || requested.startsWith('/') || /^[a-z]:/i.test(requested) || requested.startsWith('~')) throw outside(requested)
  const segments = requested.split('/').filter((segment) => segment !== '' && segment !== '.')
  for (const segment of segments) {
    if (segment === '..') throw outside(requested)
    if (platform === 'win32') {
      // Windows drops trailing dots and spaces, so `.. ` would mean `..` and `a.` would alias `a`.
      if (/[. ]$/.test(segment) || WINDOWS_FORBIDDEN.test(segment) || WINDOWS_RESERVED.test(segment)) throw outside(requested)
    }
  }
  return segments
}

export function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

export interface ResolvedFolderPath {
  /** Real absolute path on disk (symlinks resolved; segments that do not exist yet appended). */
  absolute: string
  /** The requested path, normalized: `/`-separated, relative to the folder, `''` for the folder itself. */
  relative: string
  exists: boolean
}

async function exists(value: string): Promise<boolean> {
  try { await lstat(value); return true } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/** The folder's real path; fails plainly when the folder is gone. */
export async function realFolder(folder: string): Promise<string> {
  try { return await realpath(folder) } catch {
    throw new ComputerError('not_found', `The folder ${folder} is no longer available on the user's computer.`)
  }
}

/**
 * Resolves a folder-relative path inside `root` (already a real path). For a path that does not
 * exist yet, the nearest existing ancestor is resolved instead; a dangling symlink anywhere on the
 * way is refused, since writing through it would land wherever it points.
 */
export async function resolveInFolder(root: string, requested: string, platform: NodeJS.Platform = process.platform): Promise<ResolvedFolderPath> {
  const segments = folderPathSegments(requested, platform)
  const relative = segments.join('/')
  const candidate = path.join(root, ...segments)
  const missing: string[] = []
  let current = candidate
  for (;;) {
    try {
      const real = await realpath(current)
      const absolute = missing.length ? path.join(real, ...missing.reverse()) : real
      if (!isInside(root, absolute)) throw outside(requested)
      // POSIX answers ENOTDIR for a path through a file; Windows says ENOENT, so check what the ancestor is.
      if (missing.length && !(await stat(real)).isDirectory()) throw new ComputerError('not_found', `"${requested}" goes through a file as if it were a folder.`)
      return { absolute, relative, exists: missing.length === 0 }
    } catch (error) {
      if (error instanceof ComputerError) throw error
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOTDIR') throw new ComputerError('not_found', `"${requested}" goes through a file as if it were a folder.`)
      if (code !== 'ENOENT' && code !== 'ELOOP') throw error
      // It exists but cannot be resolved: a dangling or looping symlink.
      if (code === 'ELOOP' || await exists(current)) throw outside(requested)
      if (current === root || !isInside(root, current)) throw outside(requested)
      missing.push(path.basename(current))
      current = path.dirname(current)
    }
  }
}

/**
 * Whether a folder-relative path is, or goes through, a symbolic link (or a Windows junction).
 * Reads may follow a link that stays inside the folder; a change must name the real thing, or
 * removing `link` would remove what it points at, the folder itself included.
 */
export async function goesThroughLink(root: string, segments: readonly string[]): Promise<boolean> {
  let current = root
  for (const segment of segments) {
    current = path.join(current, segment)
    let metadata
    try { metadata = await lstat(current) } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') return false
      throw error
    }
    if (metadata.isSymbolicLink()) return true
  }
  return false
}

/** Git's own folder: writing there (config, hooks) would make git run things on the user's computer. */
function isGitFolderName(segment: string, platform: NodeJS.Platform): boolean {
  const name = segment.toLowerCase()
  // NTFS short names alias `.git` as `GIT~1`.
  return name === '.git' || (platform === 'win32' && /^git~\d+$/.test(name))
}

/**
 * Resolves a path that is about to be created, replaced, moved or removed. On top of the
 * confinement every path gets, a change may not name the folder itself, anything inside `.git`,
 * or a path that is or goes through a symbolic link.
 */
export async function resolveForChange(root: string, requested: string, platform: NodeJS.Platform = process.platform): Promise<ResolvedFolderPath> {
  const segments = folderPathSegments(requested, platform)
  if (segments.some((segment) => isGitFolderName(segment, platform))) {
    throw new ComputerError('not_allowed', `"${requested}" is inside .git, which cannot be changed from here. Ask the user to run git themselves.`)
  }
  const target = await resolveInFolder(root, requested, platform)
  if (target.relative && (target.absolute === root || await goesThroughLink(root, segments))) {
    throw new ComputerError('not_allowed', `"${requested}" is or goes through a symbolic link; change the real file or folder instead.`)
  }
  return target
}

/** Joins a folder-relative path for display and storage. */
export function joinFolderPath(...parts: string[]): string {
  return parts.filter(Boolean).join('/')
}
