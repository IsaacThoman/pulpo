import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { saveLargeOutput, SAVED_OUTPUT_MIN_BYTES } from './saved-output.js'

const directories: string[] = []
async function scratch(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'pulpo-saved-output-'))
  directories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('saved tool output', () => {
  it('does not save small output', async () => {
    const directory = await scratch()
    expect(await saveLargeOutput(directory, 'call-1', 'x'.repeat(SAVED_OUTPUT_MIN_BYTES - 1), true)).toBeUndefined()
  })

  it('saves large output to a stable per-operation path', async () => {
    const directory = await scratch()
    const output = 'é'.repeat(SAVED_OUTPUT_MIN_BYTES)

    const saved = await saveLargeOutput(directory, 'call_abc|fc_123', output, false)

    expect(saved).toEqual({
      fullOutputPath: expect.stringMatching(new RegExp(`^${directory}/[0-9a-f]{16}\\.txt$`)),
      fullOutputBytes: SAVED_OUTPUT_MIN_BYTES * 2,
      fullOutputComplete: false,
    })
    expect(await readFile(saved!.fullOutputPath, 'utf8')).toBe(output)
    expect((await saveLargeOutput(directory, 'call_abc|fc_123', output, true))?.fullOutputPath).toBe(saved!.fullOutputPath)
  })

  it('skips saving instead of failing the operation when the directory is unusable', async () => {
    const directory = await scratch()
    const blocked = join(directory, 'not-a-directory')
    await writeFile(blocked, '')

    expect(await saveLargeOutput(blocked, 'call-1', 'x'.repeat(SAVED_OUTPUT_MIN_BYTES), true)).toBeUndefined()
  })
})
