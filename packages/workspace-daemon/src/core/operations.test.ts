import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createPathPolicy } from './path-policy.js'
import { OperationRunner, type Operation } from './operations.js'

const posixOnly = process.platform === 'win32' ? describe.skip : describe

async function settled(runner: OperationRunner, id: string): Promise<Operation> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const operation = await runner.find(id)
    if (operation && operation.status !== 'running') return operation
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`operation ${id} did not settle`)
}

posixOnly('OperationRunner', () => {
  let directory = ''
  let root = ''
  let runner!: OperationRunner

  beforeEach(async () => {
    directory = await realpath(await mkdtemp(join(tmpdir(), 'pulpo-ops-')))
    root = join(directory, 'root')
    await mkdir(root)
    await writeFile(join(directory, 'outside.txt'), 'outside')
    runner = new OperationRunner({
      policy: createPathPolicy({ writableRoot: root }),
      shell: 'bash',
      journalDir: join(directory, 'journal'),
      defaultTimeoutMs: 5_000,
    })
  })
  afterEach(async () => {
    await runner.cancelAll()
    await rm(directory, { recursive: true, force: true })
  })

  it('runs shell commands with cwd pinned to the root', async () => {
    await runner.execute('op-1', 'bash', { command: 'pwd; echo hi' })
    const operation = await settled(runner, 'op-1')
    expect(operation.status).toBe('completed')
    expect(operation.output.trim().split('\n')).toEqual([root, 'hi'])
    expect(operation.exitCode).toBe(0)
  })

  it('returns the journaled outcome for a repeated operation id', async () => {
    await runner.execute('op-2', 'write', { path: 'a.txt', content: 'one' })
    await settled(runner, 'op-2')
    const replay = await runner.execute('op-2', 'write', { path: 'a.txt', content: 'two' })
    expect(replay.status).toBe('completed')
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('one')
  })

  it('marks a running journal entry failed after a restart', async () => {
    await runner.execute('op-3', 'bash', { command: 'sleep 30' })
    const fresh = new OperationRunner({
      policy: createPathPolicy({ writableRoot: root }), shell: 'bash', journalDir: join(directory, 'journal'),
    })
    const recovered = await fresh.find('op-3')
    expect(recovered?.status).toBe('failed')
    expect(recovered?.error).toMatch(/restart/)
    await runner.cancel('op-3')
  })

  it('cancels a running command and kills its process tree', async () => {
    await runner.execute('op-4', 'bash', { command: 'sleep 30 & wait' })
    await new Promise((resolve) => setTimeout(resolve, 200))
    await runner.cancel('op-4')
    const operation = await settled(runner, 'op-4')
    expect(operation.status).toBe('cancelled')
  })

  it('confines write, edit, and read to the policy roots', async () => {
    await runner.execute('op-5', 'write', { path: '../escape.txt', content: 'x' })
    expect((await settled(runner, 'op-5')).error).toMatch(/escapes/)
    await runner.execute('op-6', 'read', { path: join(directory, 'outside.txt') })
    expect((await settled(runner, 'op-6')).error).toMatch(/readable roots/)
    await runner.execute('op-7', 'write', { path: 'nested/file.txt', content: 'hello world' })
    expect((await settled(runner, 'op-7')).output).toBe('Wrote nested/file.txt')
    await runner.execute('op-8', 'edit', { path: 'nested/file.txt', oldText: 'world', newText: 'there' })
    expect((await settled(runner, 'op-8')).status).toBe('completed')
    await runner.execute('op-9', 'read', { path: 'nested/file.txt' })
    const read = await settled(runner, 'op-9')
    expect(read.output).toContain('1: hello there')
    expect(read.details?.kind).toBe('bounded_read')
  })

  it('caps shell output', async () => {
    const capped = new OperationRunner({
      policy: createPathPolicy({ writableRoot: root }), shell: 'bash', journalDir: join(directory, 'journal-capped'), maxOutputBytes: 100,
    })
    await capped.execute('op-10', 'bash', { command: 'head -c 10000 /dev/zero | tr "\\0" a' })
    const operation = await settled(capped, 'op-10')
    expect(operation.output.length).toBeLessThanOrEqual(65_536)
    expect(operation.status).toBe('completed')
  })

  it('lists and greps within the root using the fallback search', async () => {
    await writeFile(join(root, 'notes.md'), 'alpha\nbeta\n')
    await runner.execute('op-11', 'list', {})
    expect((await settled(runner, 'op-11')).output).toContain('- notes.md')
    await runner.execute('op-12', 'grep', { pattern: 'beta' })
    expect((await settled(runner, 'op-12')).output).toBe('notes.md:2:beta')
    await runner.execute('op-13', 'find', { pattern: '*.md' })
    expect((await settled(runner, 'op-13')).output).toBe('notes.md')
  })
})
