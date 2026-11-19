import { workspacePath } from '../files/agent/command-context.js'

export { formatSize } from '../files/agent/command-context.js'

/** A refusal or failure whose message is written for the agent. */
export class FolderCommandError extends Error {}

/**
 * A path inside the shared folder as the agent typed it: `/`-separated and relative, `''` for the
 * folder itself. The desktop app confines paths too, but nothing that could climb out of the
 * folder or mean something else on Windows (`..`, backslashes, drive letters) is passed along.
 */
export function folderPath(value: string): string {
  if (value.includes('\0') || value.includes('\\')) throw new FolderCommandError(`"${value}" is not a valid path in the shared folder; use / between names`)
  const segments = value.split('/').filter(Boolean)
  for (const segment of segments) {
    if (segment === '.' || segment === '..') throw new FolderCommandError(`"${value}" is not a valid path in the shared folder; give it relative to the folder, without . or .. parts`)
  }
  if (/^[a-z]:/i.test(segments[0] ?? '')) throw new FolderCommandError(`"${value}" is not a valid path in the shared folder; give it relative to the folder`)
  return segments.join('/')
}

/** Whether a path the desktop app answered with is already in the form `folderPath` makes. */
export function isFolderPath(value: string): boolean {
  try { return folderPath(value) === value } catch { return false }
}

/** A local workspace path the agent named, confined to /workspace/. */
export function localPath(value: string): string {
  try {
    return workspacePath(value)
  } catch (error) {
    throw new FolderCommandError(error instanceof Error ? error.message : String(error))
  }
}

/** The shared folder's own name, for messages; the full path stays out of them. */
export function folderName(folder: string): string {
  return folder.split(/[\\/]/).filter(Boolean).at(-1) ?? folder
}

export function joinFolderPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name
}

/** Whether `path` is `parent` or inside it. */
export function isWithin(path: string, parent: string): boolean {
  return !parent || path === parent || path.startsWith(`${parent}/`)
}
