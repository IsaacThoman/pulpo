import { decodeTextFile } from '@pulpo/client-core/office/text'
import { MarkdownDiff } from '../../MarkdownDiff'
import { FileVersionsSummary } from '../FileVersionsSummary'
import type { LiveDiffProps } from '../types'

function decoded(bytes: Uint8Array): string | null {
  try {
    return decodeTextFile(bytes).text
  } catch {
    return null
  }
}

/** A text file's change as a line diff, the same one Markdown conflicts show. */
export function TextDiff({ name, before, after, className }: LiveDiffProps) {
  const left = decoded(before)
  const right = decoded(after)
  if (left === null || right === null) return <FileVersionsSummary name={name} before={before} after={after} className={className} />
  return <MarkdownDiff before={left} after={right} className={className} />
}

export default TextDiff
