import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Operations, outputForAnswer, type OperationContext } from './operations'

const posix = process.platform !== 'win32'

describe.skipIf(!posix)('Operations', () => {
  let base: string
  let operations: Operations
  let context: OperationContext

  beforeEach(async () => {
    base = await mkdtemp(path.join(os.tmpdir(), 'pulpo-ops-'))
    operations = new Operations({ platform: process.platform, savedOutputDir: path.join(base, 'saved'), scriptDir: path.join(base, 'scripts') })
    context = { sessionId: 's1', cwd: base, shell: { path: '/bin/sh', name: 'sh' }, env: async () => ({ PATH: '/usr/bin:/bin' }) }
  })

  afterEach(async () => {
    operations.cancelSession('s1')
    await rm(base, { recursive: true, force: true })
  })

  const until = async (id: string, sessionId = 's1') => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const operation = await operations.get(sessionId, id, 5_000)
      if (operation.status !== 'running') return operation
    }
    throw new Error('operation never finished')
  }

  it('starts at once, runs in the session folder and reports the exit code', async () => {
    const started = operations.start(context, 'op-1', 'bash', { command: 'pwd; echo err >&2; exit 3' })
    expect(started).toEqual({ id: 'op-1', status: 'running', output: '', exitCode: null })
    const finished = await until('op-1')
    expect(finished.status).toBe('completed')
    expect(finished.exitCode).toBe(3)
    expect(finished.output).toContain(await realpath(base))
    expect(finished.output).toContain('err')
  })

  it('is idempotent by id and keeps sessions apart', async () => {
    operations.start(context, 'same', 'bash', { command: 'echo first' })
    const again = operations.start(context, 'same', 'bash', { command: 'echo second' })
    expect(again.id).toBe('same')
    expect((await until('same')).output).toBe('first\n')
    await expect(operations.get('other-session', 'same')).rejects.toMatchObject({ code: 'not_found' })
  })

  it('returns early from a long poll once new output has waited about 250 ms', async () => {
    operations.start(context, 'stream', 'bash', { command: 'echo one; sleep 5; echo two' })
    const startedAt = Date.now()
    const first = await operations.get('s1', 'stream', 10_000)
    expect(Date.now() - startedAt).toBeLessThan(2_000)
    expect(first).toMatchObject({ status: 'running', output: 'one\n' })
    const cancelled = operations.cancel('s1', 'stream')
    expect(cancelled.status).toBe('cancelled')
    expect((await until('stream')).status).toBe('cancelled')
  })

  it('kills the whole process tree on cancel', async () => {
    const marker = path.join(base, 'survived')
    operations.start(context, 'tree', 'bash', { command: `(sleep 1; touch ${marker}) & sleep 30` })
    await new Promise((resolve) => setTimeout(resolve, 200))
    operations.cancel('s1', 'tree')
    await until('tree')
    await new Promise((resolve) => setTimeout(resolve, 1_300))
    await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('stops a command at its timeout', async () => {
    operations.start(context, 'slow', 'bash', { command: 'sleep 10', timeoutMs: 300 })
    const finished = await until('slow')
    expect(finished.status).toBe('failed')
    expect(finished.error).toMatch(/timed out/)
  })

  it('fails plainly for a missing working directory', async () => {
    operations.start(context, 'nowhere', 'bash', { command: 'true', cwd: 'missing' })
    expect((await until('nowhere')).error).toMatch(/Working directory does not exist/)
  })

  it('saves large output for paging', async () => {
    operations.start(context, 'big', 'bash', { command: 'i=0; while [ $i -lt 3000 ]; do echo "line $i of a long output"; i=$((i+1)); done' })
    const finished = await until('big')
    expect(finished.details).toMatchObject({ fullOutputComplete: true })
    expect(String(finished.details?.fullOutputPath)).toContain(path.join(base, 'saved'))
  })

  it('reads, writes, edits and lists relative to the session folder or anywhere absolute', async () => {
    operations.start(context, 'w', 'write', { path: 'notes/a.txt', content: 'hello $world' })
    expect((await until('w')).output).toBe(`Wrote ${path.join('notes', 'a.txt')}`)
    operations.start(context, 'e', 'edit', { path: 'notes/a.txt', oldText: '$world', newText: '$& there' })
    expect((await until('e')).status).toBe('completed')
    expect(await readFile(path.join(base, 'notes', 'a.txt'), 'utf8')).toBe('hello $& there')
    operations.start(context, 'r', 'read', { path: path.join(base, 'notes', 'a.txt') })
    const read = await until('r')
    expect(read.output).toContain('1: hello $& there')
    expect(read.details).toMatchObject({ kind: 'bounded_read', eof: true })
    operations.start(context, 'l', 'list', {})
    expect((await until('l')).output).toBe('d notes')
    operations.start(context, 'missing-edit', 'edit', { path: 'notes/a.txt', oldText: 'absent', newText: 'x' })
    expect(await until('missing-edit')).toMatchObject({ status: 'failed', error: 'Edit target was not found' })
  })

  it('leaves a file alone when a write or an edit is cancelled before it reaches it', async () => {
    const created = path.join(base, 'new', 'file.txt')
    operations.start(context, 'write', 'write', { path: created, content: 'late' })
    expect(operations.cancel('s1', 'write').status).toBe('cancelled')
    expect((await until('write')).status).toBe('cancelled')
    // Long enough for a write that was not held back to land.
    await new Promise((resolve) => setTimeout(resolve, 50))
    await expect(readFile(created)).rejects.toMatchObject({ code: 'ENOENT' })

    const existing = path.join(base, 'existing.txt')
    await writeFile(existing, 'before')
    operations.start(context, 'edit', 'edit', { path: existing, oldText: 'before', newText: 'after' })
    // A session that ends cancels what it was doing, as when access is taken back.
    operations.cancelSession('s1')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(await readFile(existing, 'utf8')).toBe('before')
  })

  it('finds and greps without ripgrep', async () => {
    await writeFile(path.join(base, 'a.md'), 'needle\n')
    operations.start(context, 'f', 'find', { pattern: '*.md' })
    expect(await until('f')).toMatchObject({ output: 'a.md', exitCode: 0 })
    operations.start(context, 'g', 'grep', { pattern: 'needle' })
    expect(await until('g')).toMatchObject({ output: 'a.md:1:needle', exitCode: 0 })
  })
})

describe.skipIf(!posix)('Operations that ignore a polite stop', () => {
  it('kills a cancelled command that ignores SIGTERM, and what it started', async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'pulpo-ops-kill-'))
    const operations = new Operations({ platform: process.platform, savedOutputDir: path.join(base, 'saved'), scriptDir: path.join(base, 'scripts'), killGraceMs: 200 })
    const context: OperationContext = { sessionId: 's1', cwd: base, shell: { path: '/bin/sh', name: 'sh' }, env: async () => ({ PATH: '/usr/bin:/bin' }) }
    const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
    try {
      // The shell ignores SIGTERM and keeps a child going; both print their pids first.
      operations.start(context, 'stubborn', 'bash', { command: 'trap "" TERM; (trap "" TERM; echo child $$; sleep 60) & echo shell $$; wait' })
      let output = ''
      for (let attempt = 0; attempt < 50 && !/shell \d+/.test(output); attempt += 1) output = (await operations.get('s1', 'stubborn', 200)).output
      const shellPid = Number(/shell (\d+)/.exec(output)![1])
      expect(alive(shellPid)).toBe(true)
      expect(operations.cancel('s1', 'stubborn').status).toBe('cancelled')
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(alive(shellPid)).toBe(true)
      for (let attempt = 0; attempt < 50 && alive(shellPid); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100))
      expect(alive(shellPid)).toBe(false)
    } finally {
      operations.cancelSession('s1', { now: true })
      await rm(base, { recursive: true, force: true })
    }
  })
})

describe.skipIf(!posix)('Operations whose shell exits before what it started', () => {
  it('ends at the timeout when a background process still holds the output open', async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'pulpo-ops-bg-'))
    const operations = new Operations({ platform: process.platform, savedOutputDir: path.join(base, 'saved'), scriptDir: path.join(base, 'scripts') })
    const context: OperationContext = { sessionId: 's1', cwd: base, shell: { path: '/bin/sh', name: 'sh' }, env: async () => ({ PATH: '/usr/bin:/bin' }) }
    try {
      // The shell is gone at once; the sleep it left behind inherits stdout, so the command never "closes" by itself.
      operations.start(context, 'background', 'bash', { command: 'sleep 30 & echo started', timeoutMs: 600 })
      const startedAt = Date.now()
      let operation = await operations.get('s1', 'background', 5_000)
      for (let attempt = 0; attempt < 10 && operation.status === 'running'; attempt += 1) operation = await operations.get('s1', 'background', 2_000)
      expect(operation.status).toBe('failed')
      expect(operation.error).toMatch(/timed out/)
      expect(operation.output).toContain('started')
      expect(Date.now() - startedAt).toBeLessThan(10_000)
    } finally {
      operations.cancelSession('s1', { now: true })
      await rm(base, { recursive: true, force: true })
    }
  })
})

describe.skipIf(!posix)('Operations whose command left something running', () => {
  const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
  const gone = async (pid: number) => { for (let attempt = 0; attempt < 50 && alive(pid); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100)); return !alive(pid) }

  /** Runs a command that finishes at once and leaves a process behind; returns that process's pid. */
  async function leaveBehind(operations: Operations, context: OperationContext, base: string, background: string): Promise<number> {
    const pidFile = path.join(base, `pid-${context.sessionId}`)
    // Its output goes nowhere, so the command ends as soon as its shell does.
    operations.start(context, 'bg', 'bash', { command: `${background} >/dev/null 2>&1 & echo $! > ${pidFile}` })
    let operation = await operations.get(context.sessionId, 'bg', 5_000)
    for (let attempt = 0; attempt < 10 && operation.status === 'running'; attempt += 1) operation = await operations.get(context.sessionId, 'bg', 2_000)
    expect(operation.status).toBe('completed')
    const pid = Number(await readFile(pidFile, 'utf8'))
    expect(alive(pid)).toBe(true)
    return pid
  }

  it('stops it when the session ends, and only that session\'s', async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'pulpo-ops-left-'))
    const operations = new Operations({ platform: process.platform, savedOutputDir: path.join(base, 'saved'), scriptDir: path.join(base, 'scripts'), killGraceMs: 200 })
    const context = (sessionId: string): OperationContext => ({ sessionId, cwd: base, shell: { path: '/bin/sh', name: 'sh' }, env: async () => ({ PATH: '/usr/bin:/bin' }) })
    try {
      const first = await leaveBehind(operations, context('s1'), base, 'sleep 60')
      const other = await leaveBehind(operations, context('s2'), base, 'sleep 60')
      // One that ignores the polite signal is killed once the grace period is over.
      const stubborn = await leaveBehind(operations, context('s3'), base, '(trap "" TERM; sleep 60; :)')
      operations.cancelSession('s1')
      operations.cancelSession('s3')
      expect(await gone(first)).toBe(true)
      expect(await gone(stubborn)).toBe(true)
      expect(alive(other)).toBe(true)
    } finally {
      for (const sessionId of ['s1', 's2', 's3']) operations.cancelSession(sessionId, { now: true })
      await rm(base, { recursive: true, force: true })
    }
  })

  it('kills it at once when the app quits', async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'pulpo-ops-left-quit-'))
    // A grace period far longer than the test: only quitting can kill it in time.
    const operations = new Operations({ platform: process.platform, savedOutputDir: path.join(base, 'saved'), scriptDir: path.join(base, 'scripts'), killGraceMs: 600_000 })
    const context: OperationContext = { sessionId: 's1', cwd: base, shell: { path: '/bin/sh', name: 'sh' }, env: async () => ({ PATH: '/usr/bin:/bin' }) }
    try {
      const pid = await leaveBehind(operations, context, base, '(trap "" TERM; sleep 60; :)')
      operations.cancelSession('s1', { now: true })
      expect(await gone(pid)).toBe(true)
    } finally {
      operations.cancelSession('s1', { now: true })
      await rm(base, { recursive: true, force: true })
    }
  })
})

describe.skipIf(!posix)('Operations when the app quits', () => {
  it('kills at once a command that was cancelled and is still ignoring the polite stop', async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'pulpo-ops-quit-'))
    // A grace period far longer than the test: only quitting can kill it in time.
    const operations = new Operations({ platform: process.platform, savedOutputDir: path.join(base, 'saved'), scriptDir: path.join(base, 'scripts'), killGraceMs: 600_000 })
    const context: OperationContext = { sessionId: 's1', cwd: base, shell: { path: '/bin/sh', name: 'sh' }, env: async () => ({ PATH: '/usr/bin:/bin' }) }
    const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
    try {
      operations.start(context, 'stubborn', 'bash', { command: 'trap "" TERM; echo shell $$; sleep 60 & wait' })
      let output = ''
      for (let attempt = 0; attempt < 50 && !/shell \d+/.test(output); attempt += 1) output = (await operations.get('s1', 'stubborn', 200)).output
      const shellPid = Number(/shell (\d+)/.exec(output)![1])
      operations.cancel('s1', 'stubborn')
      // Ending the session finds the operation already cancelled and leaves it to its grace period.
      operations.cancelSession('s1')
      await new Promise((resolve) => setTimeout(resolve, 150))
      expect(alive(shellPid)).toBe(true)
      operations.killStopping()
      for (let attempt = 0; attempt < 50 && alive(shellPid); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50))
      expect(alive(shellPid)).toBe(false)
    } finally {
      operations.killStopping()
      await rm(base, { recursive: true, force: true })
    }
  })
})

describe('outputForAnswer', () => {
  it('leaves short output alone', () => {
    expect(outputForAnswer('hello', 10)).toBe('hello')
  })

  it('keeps the start and end of long output and says how much is missing', () => {
    const output = `${'a'.repeat(50)}${'b'.repeat(100)}${'c'.repeat(50)}`
    const cut = outputForAnswer(output, 100)
    expect(cut.startsWith('a'.repeat(50))).toBe(true)
    expect(cut.endsWith('c'.repeat(50))).toBe(true)
    expect(cut).toContain('[… 100 characters left out here …]')
  })

  it('never splits a surrogate pair', () => {
    const cut = outputForAnswer('😀'.repeat(60), 61)
    // A lone surrogate does not survive a round trip through UTF-8.
    expect(Buffer.from(cut, 'utf8').toString('utf8')).toBe(cut)
  })
})

describe.skipIf(!posix)('Operations with long output', () => {
  it('answers with a cut output but saves the whole of it', async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'pulpo-ops-long-'))
    const operations = new Operations({ platform: process.platform, savedOutputDir: path.join(base, 'saved'), scriptDir: path.join(base, 'scripts') })
    const context: OperationContext = { sessionId: 's1', cwd: base, shell: { path: '/bin/sh', name: 'sh' }, env: async () => ({ PATH: '/usr/bin:/bin' }) }
    try {
      operations.start(context, 'long', 'bash', { command: 'head -c 300000 /dev/zero | tr "\\0" x; echo END' })
      let operation = await operations.get('s1', 'long', 5_000)
      for (let attempt = 0; attempt < 100 && operation.status === 'running'; attempt += 1) operation = await operations.get('s1', 'long', 5_000)
      expect(operation.status).toBe('completed')
      expect(operation.output.length).toBeLessThan(210_000)
      expect(operation.output).toContain('characters left out here')
      expect(operation.output.endsWith('END\n')).toBe(true)
      const saved = operation.details as { fullOutputPath: string; fullOutputBytes: number }
      expect(saved.fullOutputBytes).toBe(300_004)
      expect((await readFile(saved.fullOutputPath, 'utf8')).length).toBe(300_004)
    } finally {
      operations.cancelSession('s1')
      await rm(base, { recursive: true, force: true })
    }
  })
})
