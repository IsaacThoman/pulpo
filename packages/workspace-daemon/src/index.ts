import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, open, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, isAbsolute, resolve, relative } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

const port = Number(process.env.PORT ?? 8787)
const token = process.env.PULPO_WORKSPACE_TOKEN
const root = resolve(process.env.PULPO_WORKSPACE_ROOT ?? '/workspace')
const maxBody = Number(process.env.PULPO_WORKSPACE_MAX_BODY ?? 20 * 1024 * 1024)
const maxImageBytes = Number(process.env.PULPO_WORKSPACE_MAX_IMAGE_BYTES ?? 20 * 1024 * 1024)
const maxExportBytes = Number(process.env.PULPO_WORKSPACE_MAX_EXPORT_BYTES ?? 25 * 1024 * 1024)
if (!token || token.length < 32) throw new Error('PULPO_WORKSPACE_TOKEN must contain at least 32 characters')

type Operation = { id: string; status: 'running' | 'completed' | 'failed' | 'cancelled'; output: string; exitCode: number | null; error?: string; startedAt: string; completedAt?: string }
const operations = new Map<string, Operation>()
const children = new Map<string, ChildProcess>()
const journalRoot = resolve(root, '.pulpo', 'operations')

function journalPath(id: string): string { return resolve(journalRoot, `${createHash('sha256').update(id).digest('hex')}.json`) }
async function saveOperation(operation: Operation): Promise<void> { await mkdir(journalRoot, { recursive: true }); await writeFile(journalPath(operation.id), JSON.stringify(operation), 'utf8') }
async function findOperation(id: string): Promise<Operation | undefined> {
  const current = operations.get(id); if (current) return current
  try {
    const stored = JSON.parse(await readFile(journalPath(id), 'utf8')) as Operation
    if (stored.status === 'running') { stored.status = 'failed'; stored.error = 'Operation outcome is unknown after daemon restart'; stored.completedAt = new Date().toISOString(); await saveOperation(stored) }
    operations.set(id, stored); return stored
  } catch { return undefined }
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(value))
}

async function body(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []; let size = 0
  for await (const chunk of request) {
    const value = Buffer.from(chunk); size += value.length
    if (size > maxBody) throw new Error('Request body is too large')
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

function workspacePath(value: unknown): string {
  const path = resolve(root, String(value ?? '.'))
  if (path !== root && relative(root, path).startsWith('..')) throw new Error('Path escapes /workspace')
  return path
}

function vmPath(value: unknown): string {
  const requested = String(value ?? '')
  if (!isAbsolute(requested)) throw new Error('Path must be absolute')
  return resolve(requested)
}

async function exportPath(value: unknown): Promise<string> {
  const requested = workspacePath(value)
  const resolved = await realpath(requested)
  const fromRoot = relative(root, resolved)
  if (resolved !== root && (fromRoot.startsWith('..') || isAbsolute(fromRoot))) throw new Error('Path escapes /workspace')
  const metadata = await stat(resolved)
  if (!metadata.isFile()) throw new Error('Path must be a regular file')
  if (metadata.size > maxExportBytes) throw new Error(`File exceeds the ${maxExportBytes} byte limit`)
  return resolved
}

function killProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  try { if (child.pid) process.kill(-child.pid, signal) } catch { /* process already exited */ }
}

async function execute(id: string, type: string, args: Record<string, unknown>): Promise<Operation> {
  const existing = await findOperation(id)
  if (existing) return existing
  const operation: Operation = { id, status: 'running', output: '', exitCode: null, startedAt: new Date().toISOString() }
  operations.set(id, operation)
  await saveOperation(operation)
  void finishOperation(operation, type, args)
  return operation
}

async function finishOperation(operation: Operation, type: string, args: Record<string, unknown>): Promise<void> {
  const id = operation.id
  try {
    if (type === 'bash') {
      const command = String(args.command ?? '')
      const timeoutMs = Math.min(Number(args.timeoutMs ?? 600_000), 3_600_000)
      operation.output = await new Promise<string>((resolveOutput, reject) => {
        const child = spawn('/bin/bash', ['-lc', command], { cwd: workspacePath(args.cwd), env: { ...process.env, HOME: '/home/agent' }, detached: true })
        children.set(id, child)
        const chunks: Buffer[] = []; let bytes = 0
        const collect = (chunk: Buffer) => {
          if (bytes >= 10_000_000) return
          chunks.push(chunk); bytes += chunk.length
          operation.output = Buffer.concat(chunks).toString('utf8')
        }
        child.stdout?.on('data', collect); child.stderr?.on('data', collect)
        const timer = setTimeout(() => killProcessGroup(child, 'SIGKILL'), timeoutMs)
        child.once('error', reject)
        child.once('close', (code, signal) => {
          clearTimeout(timer); children.delete(id); operation.exitCode = code
          const output = Buffer.concat(chunks).toString('utf8')
          if (signal && operation.status !== 'cancelled') reject(new Error(`Command terminated by ${signal}`))
          else resolveOutput(output)
        })
      })
    } else if (type === 'read') operation.output = await readFile(workspacePath(args.path), 'utf8')
    else if (type === 'write') {
      const path = workspacePath(args.path); await mkdir(dirname(path), { recursive: true }); await writeFile(path, String(args.content ?? ''), 'utf8'); operation.output = `Wrote ${relative(root, path)}`
    } else if (type === 'edit') {
      const path = workspacePath(args.path); const current = await readFile(path, 'utf8'); const oldText = String(args.oldText ?? '')
      if (!oldText || !current.includes(oldText)) throw new Error('Edit target was not found')
      const next = current.replace(oldText, String(args.newText ?? '')); await writeFile(path, next, 'utf8'); operation.output = `Edited ${relative(root, path)}`
    } else if (type === 'list') {
      const path = workspacePath(args.path); operation.output = (await readdir(path, { withFileTypes: true })).map((entry) => `${entry.isDirectory() ? 'd' : '-'} ${entry.name}`).join('\n')
    } else if (type === 'find' || type === 'grep') {
      const command = type === 'find'
        ? ['--files', '--glob', String(args.pattern ?? '*'), String(args.path ?? '.')]
        : ['--line-number', '--no-heading', '--', String(args.pattern ?? ''), String(args.path ?? '.')]
      operation.output = await new Promise<string>((resolveOutput, reject) => {
        const child = spawn('rg', command, { cwd: root }); const chunks: Buffer[] = []
        child.stdout.on('data', (chunk) => chunks.push(Buffer.from(chunk))); child.stderr.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        child.once('error', reject); child.once('close', (code) => { operation.exitCode = code; resolveOutput(Buffer.concat(chunks).toString('utf8')) })
      })
    } else if (type === 'stat') operation.output = JSON.stringify(await stat(workspacePath(args.path)))
    else throw new Error(`Unknown operation type: ${type}`)
    if (operation.status !== 'cancelled') operation.status = 'completed'
  } catch (error) {
    operation.status = operation.status === 'cancelled' ? 'cancelled' : 'failed'
    operation.error = error instanceof Error ? error.message : String(error)
  }
  operation.completedAt = new Date().toISOString()
  await saveOperation(operation)
}

const server = createServer(async (request, response) => {
  try {
    if (request.url === '/healthz') return json(response, 200, { status: 'ok' })
    if (request.headers.authorization !== `Bearer ${token}`) return json(response, 401, { error: 'unauthorized' })
    const url = new URL(request.url ?? '/', 'http://workspace')
    if (request.method === 'PUT' && url.pathname === '/v1/files') {
      const path = workspacePath(url.searchParams.get('path')); await mkdir(dirname(path), { recursive: true }); await writeFile(path, await body(request)); return json(response, 201, { path })
    }
    if (request.method === 'GET' && url.pathname === '/v1/files') {
      const file = await exportPath(url.searchParams.get('path'))
      const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        const metadata = await handle.stat()
        if (!metadata.isFile() || metadata.size > maxExportBytes) throw new Error('File is unavailable for export')
        const contents = await handle.readFile()
        if (contents.byteLength > maxExportBytes) throw new Error(`File exceeds the ${maxExportBytes} byte limit`)
        response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': contents.byteLength })
        response.end(contents)
        return
      } finally {
        await handle.close()
      }
    }
    if (request.method === 'GET' && url.pathname === '/v1/images') {
      const path = vmPath(url.searchParams.get('path')); const metadata = await stat(path)
      if (!metadata.isFile()) throw new Error('Image path must be a regular file')
      if (metadata.size > maxImageBytes) throw new Error(`Image exceeds the ${maxImageBytes} byte limit`)
      response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': metadata.size }); response.end(await readFile(path)); return
    }
    const match = url.pathname.match(/^\/v1\/operations\/([^/]+)(?:\/(cancel))?$/)
    if (request.method === 'GET' && match) {
      const operation = await findOperation(match[1]!); return operation ? json(response, 200, operation) : json(response, 404, { error: 'not_found' })
    }
    if (request.method === 'POST' && match?.[2] === 'cancel') {
      const operation = await findOperation(match[1]!); if (!operation) return json(response, 404, { error: 'not_found' })
      operation.status = 'cancelled'
      const child = children.get(operation.id); if (child) killProcessGroup(child, 'SIGTERM')
      await saveOperation(operation); return json(response, 202, operation)
    }
    if (request.method === 'POST' && url.pathname === '/v1/operations') {
      const input = JSON.parse((await body(request)).toString('utf8')) as { id?: string; type?: string; args?: Record<string, unknown> }
      return json(response, 200, await execute(input.id ?? randomUUID(), String(input.type ?? ''), input.args ?? {}))
    }
    json(response, 404, { error: 'not_found' })
  } catch (error) { json(response, 400, { error: error instanceof Error ? error.message : String(error) }) }
})

server.listen(port, '0.0.0.0', () => process.stdout.write(`pulpo workspace daemon listening on ${port}\n`))
