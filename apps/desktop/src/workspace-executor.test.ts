import { workspaceOperationIdentity } from '@pulpo/contracts'
import { randomUUID, createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComputerOperation, ComputerOperationResult } from '@pulpo/contracts'
import { WorkspaceExecutor, commandEnvironment, shellArguments } from './workspace-executor'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const fn of cleanup.splice(0)) await fn() })
async function setup() {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'pulpo-workspace-test-'))
  const rootId = randomUUID(); const results: ComputerOperationResult[] = []
  const config = { journal: path.join(folder, 'journal'), stagingPath: path.join(folder, 'attachments'), roots: [{ id: rootId, path: folder }], shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/bash', rgPath: 'rg' }
  const executor = new WorkspaceExecutor(config, result => results.push(structuredClone(result)))
  cleanup.push(async () => { executor.shutdown(); await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) })
  const operation = (type: string, args: Record<string, unknown>): ComputerOperation => ({ id: randomUUID(), rootId, sessionId: randomUUID(), generation: 0, type, args, hash: createHash('sha256').update(workspaceOperationIdentity(type, args)).digest('hex'), deadline: new Date(Date.now() + 20_000).toISOString() })
  const finished = async (id: string) => { await vi.waitFor(() => expect(results.some(result => result.id === id && result.status !== 'running')).toBe(true), { timeout: 10000 }); return results.filter(result => result.id === id).at(-1)! }
  return { folder, rootId, config, results, executor, operation, finished }
}
describe('native computer execution', () => {
  it('executes and journals a native command exactly once across redelivery and restart', async () => {
    const f = await setup()
    const command = process.platform === 'win32' ? "Add-Content count.txt 'once'" : "printf 'once\n' >> count.txt"
    const op = f.operation('bash', { command })
    await f.executor.accept(op); expect((await f.finished(op.id)).status).toBe('completed')
    await f.executor.accept(op)
    const restarted = new WorkspaceExecutor(f.config, result => f.results.push(result))
    await restarted.accept(op)
    expect((await readFile(path.join(f.folder, 'count.txt'), 'utf8')).trim().split(/\r?\n/)).toEqual(['once'])
  }, 15000)
  it('never reruns a command whose journal says it was running at restart', async () => {
    const f = await setup(); const op = f.operation('write', { path: 'should-not-exist', content: 'bad' })
    await mkdir(f.config.journal)
    await writeFile(path.join(f.config.journal, `${op.id}.json`), JSON.stringify({ hash: op.hash, result: { id: op.id, status: 'running', output: '', exitCode: null } }))
    await f.executor.accept(op)
    expect(f.results.at(-1)?.status).toBe('unknown')
    await expect(readFile(path.join(f.folder, 'should-not-exist'))).rejects.toThrow()
  })
  it('does not execute a previously dispatched command when its journal is missing', async () => {
    const f = await setup(); const op = { ...f.operation('write', { path: 'missing', content: 'bad' }), reconcileOnly: true }
    await f.executor.accept(op)
    expect(f.results.at(-1)?.status).toBe('unknown')
    await expect(readFile(path.join(f.folder, 'missing'))).rejects.toThrow()
  })
  it('accepts argument order changes caused by JSONB storage', async () => {
    const f = await setup(); const op = f.operation('write', { content: 'stable', path: 'ordered' })
    op.args = { path: 'ordered', content: 'stable' }
    await f.executor.accept(op)
    expect((await f.finished(op.id)).status).toBe('completed')
    expect(await readFile(path.join(f.folder, 'ordered'), 'utf8')).toBe('stable')
  })
  it('stages attachments apart from the project and exports finished files', async () => {
    const f = await setup(); const op = f.operation('import', { path: '/workspace/example.txt', data: Buffer.from('input').toString('base64') })
    await f.executor.accept(op); await f.finished(op.id)
    await expect(readFile(path.join(f.folder, 'example.txt'))).rejects.toThrow()
    const exported = { ...f.operation('export', { path: '/workspace/example.txt' }), sessionId: op.sessionId }
    await f.executor.accept(exported)
    expect(Buffer.from((await f.finished(exported.id)).output, 'base64').toString()).toBe('input')
  })
  it('rejects reused operation identities with changed arguments', async () => {
    const f = await setup(); const op = f.operation('write', { path: 'file', content: 'first' })
    await f.executor.accept(op); await f.finished(op.id)
    const other = { ...f.operation('write', { path: 'file', content: 'second' }), id: op.id }
    await f.executor.accept(other)
    expect(f.results.at(-1)?.error).toBe('Operation identity conflict')
    expect(await readFile(path.join(f.folder, 'file'), 'utf8')).toBe('first')
  })
  it('reports healthy silent commands and cancels their process group', async () => {
    const f = await setup(); const op = f.operation('bash', { command: process.platform === 'win32' ? 'Start-Sleep -Seconds 30' : 'sleep 30' })
    await f.executor.accept(op); await new Promise(resolve => setTimeout(resolve, 100)); f.executor.heartbeat()
    expect(f.results.at(-1)?.status).toBe('running')
    await f.executor.cancel(op.id)
    expect((await f.finished(op.id)).status).toBe('cancelled')
  })
  it('keeps retrying a completed result when an older running heartbeat is acknowledged late', async () => {
    const f = await setup(); const op = f.operation('write', { path: 'late-ack', content: 'done' })
    await f.executor.accept(op); await f.finished(op.id)
    f.executor.acknowledge(op.id, 'running')
    const count = f.results.length; f.executor.heartbeat()
    expect(f.results.length).toBe(count + 1)
    f.executor.acknowledge(op.id, 'completed'); f.executor.heartbeat()
    expect(f.results.length).toBe(count + 1)
  })
  it('keeps credentials out of child environments and chooses native shell arguments', () => {
    expect(commandEnvironment({ PATH: '/bin', HOME: '/tmp', PULPO_TOKEN: 'secret', OPENAI_API_KEY: 'secret' })).toEqual({ PATH: '/bin', HOME: '/tmp' })
    expect(shellArguments('win32', 'pwd')).toEqual(['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', 'pwd'])
    expect(shellArguments('darwin', 'pwd')).toEqual(['-lc', 'pwd'])
  })
})
