import { FILE_NAME_MAX_LENGTH, type FileNameError } from '@pulpo/contracts'

const FILE_NAME_MESSAGES: Record<FileNameError, string> = {
  empty: 'Name is required',
  too_long: `Names can be at most ${FILE_NAME_MAX_LENGTH} characters`,
  reserved: 'This name is reserved',
  invalid_character: 'Names cannot contain "/" or control characters',
}

export function fileNameMessage(error: FileNameError): string {
  return FILE_NAME_MESSAGES[error]
}

function splitExtension(name: string): [base: string, extension: string] {
  const dot = name.lastIndexOf('.')
  // Dotfiles such as ".env" have no extension to preserve, and a very long "extension" is just text.
  return dot > 0 && name.length - dot <= 32 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
}

function truncateCodePoints(value: string, length: number): string {
  const points = [...value]
  return points.length > length ? points.slice(0, Math.max(0, length)).join('') : value
}

/**
 * Picks the first free Drive-style name ("Report (2).pdf") given the lowercase names already
 * used by live siblings. Suffixed names are truncated so they stay within the length limit.
 */
export function nextAvailableName(desired: string, takenLowercase: ReadonlySet<string>): string {
  if (!takenLowercase.has(desired.toLowerCase())) return desired
  const [base, extension] = splitExtension(desired)
  for (let index = 2; ; index += 1) {
    const suffix = ` (${index})${extension}`
    const candidate = truncateCodePoints(base, FILE_NAME_MAX_LENGTH - [...suffix].length) + suffix
    if (!takenLowercase.has(candidate.toLowerCase())) return candidate
  }
}
