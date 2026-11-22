import { execFileSync } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ComputerOperation } from '@pulpo/contracts'
import { Operations, type OperationContext } from './operations'
import { commandShell } from './platform'

/**
 * The Windows half of the command runner, against a real PowerShell. It only runs on Windows; the
 * pure parts of the Windows branch (script text, invocation, shell choice) are tested everywhere
 * in platform.test.ts.
 */
describe.skipIf(process.platform !== 'win32')('Operations on Windows', () => {
  let base: string
  let operations: Operations
  let context: OperationContext

  beforeEach(async () => {
    base = await mkdtemp(path.join(os.tmpdir(), 'pulpo-ops-win-'))
    operations = new Operations({ platform: 'win32', savedOutputDir: path.join(base, 'saved'), scriptDir: path.join(base, 'scripts') })
    context = { sessionId: 's1', cwd: base, shell: commandShell('win32', process.env), env: async () => process.env }
  })

  afterEach(async () => {
    operations.cancelSession('s1')
    await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  })

  const until = async (id: string): Promise<ComputerOperation> => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const operation = await operations.get('s1', id, 5_000)
      if (operation.status !== 'running') return operation
    }
    throw new Error('operation never finished')
  }
  const run = async (id: string, command: string, extra: Record<string, unknown> = {}) => {
    operations.start(context, id, 'bash', { command, ...extra })
    return until(id)
  }

  it('runs a command in the session folder and reports success', async () => {
    const operation = await run('ok', 'Write-Output "hello"; (Get-Location).Path')
    expect(operation.status).toBe('completed')
    expect(operation.exitCode).toBe(0)
    const lines = operation.output.trim().split(/\r?\n/)
    expect(lines[0]).toBe('hello')
    expect(lines[1]!.toLowerCase()).toBe(base.toLowerCase())
  })

  it('keeps non-ASCII text intact in both directions', async () => {
    const operation = await run('utf8', 'Write-Output "héllo wörld ✓ 日本語"')
    expect(operation.output.trim()).toBe('héllo wörld ✓ 日本語')
  })

  it('exits with a failing native command\'s code, and with 1 after a failing cmdlet', async () => {
    expect((await run('native', 'cmd /c "exit 3"')).exitCode).toBe(3)
    const cmdlet = await run('cmdlet', 'Get-Item C:\\definitely\\not\\here')
    expect(cmdlet.exitCode).toBe(1)
    expect(cmdlet.output).toContain('not\\here')
    expect((await run('explicit', 'exit 7')).exitCode).toBe(7)
  })

  it('leaves quotes, dollar signs and line breaks in the command alone', async () => {
    const operation = await run('quoting', '$name = "a \'quoted\' value"\nWrite-Output "got: $name"\nWrite-Output \'single $notExpanded\'')
    expect(operation.output.trim().split(/\r?\n/)).toEqual(['got: a \'quoted\' value', 'single $notExpanded'])
  })

  it('removes its temporary script', async () => {
    await run('cleanup', 'Write-Output done')
    expect(await readdir(path.join(base, 'scripts'))).toEqual([])
  })

  it('cancelling ends the whole process tree', async () => {
    const marker = path.join(base, 'pid.txt')
    // PowerShell starts a child that would outlive it unless the tree is killed.
    operations.start(context, 'tree', 'bash', {
      command: `$child = Start-Process -FilePath ping.exe -ArgumentList '-n','120','127.0.0.1' -PassThru -WindowStyle Hidden; Set-Content -Path '${marker}' -Value $child.Id; Wait-Process -Id $child.Id`,
    })
    let pid = ''
    for (let attempt = 0; attempt < 100 && !pid; attempt += 1) {
      pid = (await readFile(marker, 'utf8').catch(() => '')).trim()
      if (!pid) await new Promise((resolve) => setTimeout(resolve, 100))
    }
    expect(pid).toMatch(/^\d+$/)
    expect(operations.cancel('s1', 'tree').status).toBe('cancelled')
    expect((await until('tree')).status).toBe('cancelled')
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    const listed = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], { encoding: 'utf8' })
    expect(listed).not.toContain('ping.exe')
  })

  it('stops a command that runs past its timeout', async () => {
    const operation = await run('timeout', 'Start-Sleep -Seconds 60', { timeoutMs: 1_500 })
    expect(operation.status).toBe('failed')
    expect(operation.error).toMatch(/timed out after 2 seconds/)
  })
})
