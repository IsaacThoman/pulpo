import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

/** Below the server's ~48 KB model-context cap, so any output the server truncates has a saved copy. */
export const SAVED_OUTPUT_MIN_BYTES = 32 * 1024

export type SavedOutputDetails = {
  fullOutputPath: string
  fullOutputBytes: number
  fullOutputComplete: boolean
}

/** Save large tool output where the agent can page through it with read or grep. */
export async function saveLargeOutput(directory: string, operationId: string, output: string, complete: boolean): Promise<SavedOutputDetails | undefined> {
  const bytes = Buffer.byteLength(output, 'utf8')
  if (bytes < SAVED_OUTPUT_MIN_BYTES) return undefined
  const path = resolve(directory, `${createHash('sha256').update(operationId).digest('hex').slice(0, 16)}.txt`)
  try {
    await mkdir(directory, { recursive: true })
    await writeFile(path, output, 'utf8')
  } catch {
    return undefined
  }
  return { fullOutputPath: path, fullOutputBytes: bytes, fullOutputComplete: complete }
}
