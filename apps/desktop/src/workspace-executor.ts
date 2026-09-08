import { workspaceOperationIdentity } from '@pulpo/contracts'
import { readTextFile } from '../../../packages/workspace-daemon/src/read'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, open, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ComputerOperation, ComputerOperationResult } from '@pulpo/contracts'

export interface ExecutorConfig { journal: string; stagingPath: string; roots: Array<{ id: string; path: string }>; shell: string; rgPath: string }
export function commandEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const allowed = ['PATH', 'HOME', 'USERPROFILE', 'SYSTEMROOT', 'SystemRoot', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'USER', 'USERNAME', 'APPDATA', 'LOCALAPPDATA', 'PATHEXT']
  return Object.fromEntries(allowed.flatMap(key => source[key] === undefined ? [] : [[key, source[key]]]))
}
export function shellArguments(platform: string, command: string): string[] {
  return platform === 'win32' ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command] : ['-lc', command]
}
export function stopProcess(child: ChildProcess): void {
  if (!child.pid) return
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, env: commandEnvironment(process.env) }).on('error', () => child.kill())
  else { try { process.kill(-child.pid, 'SIGKILL') } catch { /* Already exited. */ } }
}
export class WorkspaceExecutor {
  private operations = new Map<string, { hash: string; result: ComputerOperationResult }>()
  private children = new Map<string, ChildProcess>()
  private queues = new Map<string, Promise<void>>()
  private executing = new Set<string>()
  private accepting = true
  private acknowledged = new Set<string>()
  private cancellationRequested = new Set<string>()
  constructor(private config: ExecutorConfig, private report: (result: ComputerOperationResult) => void) {}
  private journal(id: string) { return path.join(this.config.journal, `${id}.json`) }
  private async save(id: string) {
    await mkdir(this.config.journal, { recursive: true, mode: 0o700 })
    const target = this.journal(id); const temporary = `${target}.tmp`
    const file = await open(temporary, 'w', 0o600)
    try { await file.writeFile(JSON.stringify(this.operations.get(id))); await file.sync() } finally { await file.close() }
    await rename(temporary, target)
  }
  async accept(operation: ComputerOperation): Promise<void> {
    if (!this.accepting || !/^[a-f0-9-]{36}$/i.test(operation.id) || !/^[a-f0-9-]{36}$/i.test(operation.sessionId)) return
    const root = this.config.roots.find(root => root.id === operation.rootId)
    if (!root) return
    const hash = createHash('sha256').update(workspaceOperationIdentity(operation.type, operation.args)).digest('hex')
    if (hash !== operation.hash) return
    let known = this.operations.get(operation.id)
    if (!known) {
      try {
        known = JSON.parse(await readFile(this.journal(operation.id), 'utf8')) as { hash: string; result: ComputerOperationResult }
        if (known?.result.status === 'running') { known.result.status = 'unknown'; known.result.error = 'Operation outcome is unknown after desktop restart' }
        if (known) this.operations.set(operation.id, known)
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.report({ id: operation.id, status: 'unknown', output: '', exitCode: null, error: 'Operation journal could not be read; command was not repeated' }); return
      } }
    }
    if (known) {
      this.report(known.hash === hash ? known.result : { id: operation.id, status: 'failed', output: '', exitCode: null, error: 'Operation identity conflict' }); return
    }
    if (operation.reconcileOnly) { this.report({ id: operation.id, status: 'unknown', output: '', exitCode: null, error: 'This command was previously dispatched but its local journal is missing. It was not repeated.' }); return }
    const result: ComputerOperationResult = { id: operation.id, status: 'running', output: '', exitCode: null }
    this.operations.set(operation.id, { hash, result })
    await this.save(operation.id)
    this.report(result)
    const previous = this.queues.get(root.id) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(async () => {
      if (result.status === 'cancelled') return
      try {
        if (!this.accepting) { result.status = 'cancelled'; await this.save(operation.id); this.report(result); return }
        this.executing.add(operation.id)
        if (Date.parse(operation.deadline) <= Date.now()) throw new Error('Command deadline expired before execution')
        await this.execute(operation, root.path, result)
        if (result.status === 'running') result.status = 'completed'
      } catch (error) { if (result.status === 'running') { result.status = 'failed'; result.error = error instanceof Error ? error.message : String(error) } }
      this.executing.delete(operation.id)
      await this.save(operation.id); this.report(result)
    })
    this.queues.set(root.id, next)
    void next.catch(() => this.report({ ...result, status: 'unknown', error: 'Unable to persist command result' }))
  }
  acknowledge(id: string, status: ComputerOperationResult['status']) { const result = this.operations.get(id)?.result; if (status !== 'running' && result?.status === status) this.acknowledged.add(id) }
  heartbeat() { for (const { result } of this.operations.values()) if (!this.acknowledged.has(result.id)) this.report(result) }
  async cancel(id: string) {
    const operation = this.operations.get(id)
    if (!operation || operation.result.status !== 'running') return
    const child = this.children.get(id)
    if (child) { this.cancellationRequested.add(id); stopProcess(child); return } // Completion is acknowledged by close, never by the request.
    if (this.executing.has(id)) return // A filesystem operation already in progress must report its actual outcome.
    operation.result.status = 'cancelled'; await this.save(id); this.report(operation.result)
  }
  shutdown() { this.accepting = false; for (const child of this.children.values()) stopProcess(child) }
  private async execute(operation: ComputerOperation, root: string, result: ComputerOperationResult) {
    const staging = path.join(this.config.stagingPath, operation.sessionId)
    const resolve = (value: unknown) => {
      const requested = String(value ?? '.')
      if (requested === '/workspace' || requested.startsWith('/workspace/')) {
        const target = path.resolve(staging, requested.slice('/workspace/'.length))
        const relative = path.relative(staging, target)
        if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Invalid attachment path')
        return target
      }
      return path.resolve(root, requested)
    }
    const args = operation.args; const target = resolve(args.path)
    if (operation.type === 'import') {
      if (!String(args.path).startsWith('/workspace/')) throw new Error('Attachments require a staging path')
      await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, Buffer.from(String(args.data), 'base64')); result.output = 'Attachment staged'
    } else if (operation.type === 'export') {
      const metadata = await stat(target); if (!metadata.isFile() || metadata.size > 25 * 1024 * 1024) throw new Error('Export exceeds 25 MiB or is not a regular file')
      result.output = (await readFile(target)).toString('base64')
    } else if (operation.type === 'read') {
      const read = await readTextFile(target, args); result.output = read.output; result.details = read.details
    } else if (operation.type === 'write' || operation.type === 'edit') {
      let content = String(args.content ?? '')
      if (operation.type === 'edit') { const source = await readFile(target, 'utf8'); const old = String(args.oldText ?? ''); if (!old || !source.includes(old)) throw new Error('Edit target not found'); content = source.replace(old, String(args.newText ?? '')) }
      await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, content); result.output = `Wrote ${target}`
    } else if (operation.type === 'list') result.output = (await readdir(target, { withFileTypes: true })).map(entry => `${entry.isDirectory() ? 'd' : '-'} ${entry.name}`).join('\n')
    else if (operation.type === 'stat') result.output = JSON.stringify(await stat(target))
    else if (['bash', 'find', 'grep'].includes(operation.type)) {
      const command = operation.type === 'bash' ? this.config.shell : this.config.rgPath
      const parameters = operation.type === 'bash' ? shellArguments(process.platform, String(args.command ?? '')) : operation.type === 'find' ? ['--files', '--glob', String(args.pattern ?? '*'), target] : ['--line-number', '--no-heading', '--', String(args.pattern ?? ''), target]
      await new Promise<void>((resolveDone, reject) => {
        const child = spawn(command, parameters, { cwd: resolve(args.cwd), env: commandEnvironment(process.env), detached: process.platform !== 'win32', windowsHide: true })
        child.stdin?.end() // Commands are noninteractive; PowerShell otherwise waits for pipe EOF.
        this.children.set(operation.id, child)
        let output = Buffer.alloc(0)
        const collect = (chunk: Buffer) => { if (output.length < 50 * 1024) output = Buffer.concat([output, chunk]).subarray(0, 50 * 1024); result.output = output.toString('utf8') }
        child.stdout?.on('data', collect); child.stderr?.on('data', collect)
        const timer = setTimeout(() => { this.cancellationRequested.add(operation.id); stopProcess(child) }, Math.max(1, Date.parse(operation.deadline) - Date.now()))
        child.once('error', error => { clearTimeout(timer); this.children.delete(operation.id); reject(error) })
        child.once('close', (code, signal) => { clearTimeout(timer); this.children.delete(operation.id); result.exitCode = code; if (signal || this.cancellationRequested.has(operation.id)) { result.status = 'cancelled'; result.error = `Process stopped (${signal})` } resolveDone() })
      })
    } else throw new Error('Unsupported workspace operation')
  }
}
