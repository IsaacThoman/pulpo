import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { constants } from 'node:fs'
import { open, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { OperationRunner, StagedFiles, assertRegularFileWithin, createPathPolicy, writeStreamToFile } from './core/index.js'

const port = Number(process.env.PORT ?? 8787)
const token = process.env.PULPO_WORKSPACE_TOKEN
const root = resolve(process.env.PULPO_WORKSPACE_ROOT ?? '/workspace')
const maxBody = Number(process.env.PULPO_WORKSPACE_MAX_BODY ?? 20 * 1024 * 1024)
const maxImageBytes = Number(process.env.PULPO_WORKSPACE_MAX_IMAGE_BYTES ?? 20 * 1024 * 1024)
const maxExportBytes = Number(process.env.PULPO_WORKSPACE_MAX_EXPORT_BYTES ?? 25 * 1024 * 1024)
const maxFileBytes = Number(process.env.PULPO_WORKSPACE_MAX_FILE_BYTES ?? 1_000 * 1024 * 1024)
if (!token || token.length < 32) throw new Error('PULPO_WORKSPACE_TOKEN must contain at least 32 characters')

const stagedFiles = new StagedFiles()
const policy = createPathPolicy({ writableRoot: root, readableRoots: 'anywhere', platform: 'posix' })
const runner = new OperationRunner({
  policy,
  shell: 'bash',
  env: { ...process.env, HOME: '/home/agent' },
  journalDir: resolve(root, '.pulpo', 'operations'),
  rgPath: 'rg',
})

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

function vmPath(value: unknown): string {
  const requested = String(value ?? '')
  if (!isAbsolute(requested)) throw new Error('Path must be absolute')
  return resolve(requested)
}

async function exportPath(value: unknown): Promise<string> {
  const resolved = await policy.exportable(value)
  await assertRegularFileWithin(resolved, maxExportBytes, 'File')
  return resolved
}

const server = createServer(async (request, response) => {
  try {
    if (request.url === '/healthz') return json(response, 200, { status: 'ok' })
    if (request.headers.authorization !== `Bearer ${token}`) return json(response, 401, { error: 'unauthorized' })
    const url = new URL(request.url ?? '/', 'http://workspace')
    if (request.method === 'POST' && url.pathname === '/v1/files/missing') {
      const input = JSON.parse((await body(request)).toString('utf8')) as { files?: Array<{ path: string; checksum: string | null; sizeBytes: number }> }
      if (!Array.isArray(input.files) || input.files.length > 500) throw new Error('Invalid staging inventory')
      const missing: string[] = []
      for (const file of input.files) {
        if (typeof file.path !== 'string' || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0 || (file.checksum !== null && typeof file.checksum !== 'string')) throw new Error('Invalid staging file')
        if (!await stagedFiles.matches(policy.writable(file.path), file.checksum, file.sizeBytes)) missing.push(file.path)
      }
      return json(response, 200, { missing })
    }
    if (request.method === 'PUT' && url.pathname === '/v1/files') {
      const path = policy.writable(url.searchParams.get('path'))
      const checksum = request.headers['x-pulpo-file-checksum']
      await writeStreamToFile(request, path, {
        expectedBytes: Number(request.headers['content-length']),
        maxBytes: maxFileBytes,
        checksum: typeof checksum === 'string' ? checksum : null,
        stagedFiles,
      })
      return json(response, 201, { path })
    }
    if (request.method === 'GET' && url.pathname === '/v1/files') {
      const file = await exportPath(url.searchParams.get('path'))
      const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        const metadata = await handle.stat()
        if (!metadata.isFile() || metadata.size > maxExportBytes) throw new Error('File is unavailable for export')
        response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': metadata.size })
        await pipeline(handle.createReadStream({ autoClose: false }), response)
        return
      } finally {
        await handle.close()
      }
    }
    if (request.method === 'GET' && url.pathname === '/v1/images') {
      const path = vmPath(url.searchParams.get('path'))
      const size = await assertRegularFileWithin(path, maxImageBytes, 'Image')
      response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': size }); response.end(await readFile(path)); return
    }
    const match = url.pathname.match(/^\/v1\/operations\/([^/]+)(?:\/(cancel))?$/)
    if (request.method === 'GET' && match) {
      const operation = await runner.find(match[1]!); return operation ? json(response, 200, operation) : json(response, 404, { error: 'not_found' })
    }
    if (request.method === 'POST' && match?.[2] === 'cancel') {
      const operation = await runner.cancel(match[1]!)
      return operation ? json(response, 202, operation) : json(response, 404, { error: 'not_found' })
    }
    if (request.method === 'POST' && url.pathname === '/v1/operations') {
      const input = JSON.parse((await body(request)).toString('utf8')) as { id?: string; type?: string; args?: Record<string, unknown> }
      return json(response, 200, await runner.execute(input.id ?? randomUUID(), String(input.type ?? ''), input.args ?? {}))
    }
    json(response, 404, { error: 'not_found' })
  } catch (error) { json(response, 400, { error: error instanceof Error ? error.message : String(error) }) }
})

void realpath(root).catch(() => undefined)
server.listen(port, '0.0.0.0', () => process.stdout.write(`pulpo workspace daemon listening on ${(server.address() as import('node:net').AddressInfo).port}\n`))
