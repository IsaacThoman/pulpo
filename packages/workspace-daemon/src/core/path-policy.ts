import { realpath, stat } from 'node:fs/promises'
import { posix, win32, type PlatformPath } from 'node:path'

export type PathPlatform = 'posix' | 'win32'

export interface PathPolicyOptions {
  /** Root directory that write/edit/ls/export operations are confined to. Should already be canonical (realpath). */
  writableRoot: string
  /** Extra roots that may be read but not written, or 'anywhere' to allow reads from any absolute path. */
  readableRoots?: string[] | 'anywhere'
  platform?: PathPlatform
  /** Full-access mode: paths still resolve against the root, but nothing is confined to it. */
  unrestricted?: boolean
}

export interface PathPolicy {
  readonly root: string
  readonly platform: PathPlatform
  readonly path: PlatformPath
  readonly unrestricted: boolean
  /** Resolve a path for writing. Lexical containment check against the writable root. */
  writable(value: unknown): string
  /** Resolve a path for writing and confirm the closest existing ancestor does not escape through a symlink. */
  writableChecked(value: unknown): Promise<string>
  /** Resolve a path for reading. Realpath is checked when the target exists. */
  readable(value: unknown): Promise<string>
  /** Resolve an existing regular file under the writable root for export. Symlinks are resolved and re-checked. */
  exportable(value: unknown): Promise<string>
  /** Whether a canonical path lies inside one of the readable roots. */
  isReadable(resolved: string): boolean
  /** Whether a canonical path lies inside the writable root. */
  isWritable(resolved: string): boolean
}

export function platformForProcess(platform: NodeJS.Platform = process.platform): PathPlatform {
  return platform === 'win32' ? 'win32' : 'posix'
}

function pathModule(platform: PathPlatform): PlatformPath {
  return platform === 'win32' ? win32 : posix
}

/** True when `target` equals `root` or lives beneath it. Both must be resolved absolute paths on the same platform. */
export function isWithinRoot(path: PlatformPath, root: string, target: string): boolean {
  const relative = path.relative(root, target)
  if (relative === '') return true
  if (path.isAbsolute(relative)) return false
  if (relative === '..' || relative.startsWith(`..${path.sep}`)) return false
  if (path === win32 && relative.startsWith('../')) return false
  return true
}

function rejectExoticWindowsPath(path: PlatformPath, root: string, requested: string): void {
  if (path !== win32) return
  const normalized = requested.replace(/\//g, '\\')
  const exotic = normalized.startsWith('\\\\?\\') || normalized.startsWith('\\\\.\\')
  if (exotic) throw new Error('Device and long-path prefixes are not allowed')
  const unc = normalized.startsWith('\\\\')
  const rootUnc = root.replace(/\//g, '\\').startsWith('\\\\')
  if (unc && !rootUnc) throw new Error('UNC paths are not allowed')
}

export function createPathPolicy(options: PathPolicyOptions): PathPolicy {
  const platform = options.platform ?? platformForProcess()
  const path = pathModule(platform)
  const root = path.resolve(options.writableRoot)
  const readableRoots = options.readableRoots === 'anywhere'
    ? 'anywhere'
    : [root, ...(options.readableRoots ?? [])].map((entry) => path.resolve(entry))

  const requestedString = (value: unknown, fallback = '.'): string => {
    if (value === undefined || value === null) return fallback
    if (typeof value !== 'string') throw new Error('path must be a string')
    return value
  }

  const unrestricted = options.unrestricted === true
  const isWritable = (resolved: string): boolean => unrestricted || isWithinRoot(path, root, resolved)
  const isReadable = (resolved: string): boolean => unrestricted || readableRoots === 'anywhere'
    ? true
    : readableRoots.some((entry) => isWithinRoot(path, entry, resolved))

  const writable = (value: unknown): string => {
    const requested = requestedString(value)
    rejectExoticWindowsPath(path, root, requested)
    const resolved = path.resolve(root, requested)
    if (!isWritable(resolved)) throw new Error(`Path escapes ${root}`)
    return resolved
  }

  const closestExistingAncestor = async (target: string): Promise<string | undefined> => {
    let current = target
    for (let depth = 0; depth < 512; depth += 1) {
      try {
        await stat(current)
        return current
      } catch {
        const parent = path.dirname(current)
        if (parent === current) return undefined
        current = parent
      }
    }
    return undefined
  }

  const writableChecked = async (value: unknown): Promise<string> => {
    const resolved = writable(value)
    if (unrestricted) return resolved
    const existing = await closestExistingAncestor(resolved)
    // When nothing at or below the root exists yet there is no symlink that could redirect the write.
    if (!existing || !isWithinRoot(path, root, existing)) return resolved
    const canonical = await realpath(existing)
    if (!isWritable(canonical)) throw new Error(`Path escapes ${root}`)
    return resolved
  }

  const readable = async (value: unknown): Promise<string> => {
    const requested = requestedString(value)
    if (!requested.trim()) throw new Error('path must be a non-empty string')
    rejectExoticWindowsPath(path, root, requested)
    const resolved = path.resolve(root, requested)
    if (!isReadable(resolved)) throw new Error(`Path is outside the readable roots`)
    if (unrestricted || readableRoots === 'anywhere') return resolved
    let canonical: string
    try {
      canonical = await realpath(resolved)
    } catch {
      return resolved
    }
    if (!isReadable(canonical)) throw new Error(`Path is outside the readable roots`)
    return canonical
  }

  const exportable = async (value: unknown): Promise<string> => {
    const requested = writable(value)
    const resolved = await realpath(requested)
    if (!isWritable(resolved)) throw new Error(`Path escapes ${root}`)
    const metadata = await stat(resolved)
    if (!metadata.isFile()) throw new Error('Path must be a regular file')
    return resolved
  }

  return { root, platform, path, unrestricted, writable, writableChecked, readable, exportable, isReadable, isWritable }
}
