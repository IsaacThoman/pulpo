import { randomBytes } from 'node:crypto'
import { rmSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import path from 'node:path'
import type { Operations } from './operations'

/**
 * The workspace daemon's relay socket, on the user's computer: `pulpo files` in an agent command
 * posts `{ operationId, command, args }` to `POST /v1/requests` on `PULPO_RELAY_SOCKET` and waits
 * for the answer (packages/workspace-daemon/src/cli-relay.ts). The request is held by Operations
 * until the server answers it. A unix domain socket on macOS/Linux, a named pipe on Windows.
 */

const MAX_RELAY_BODY = 1024 * 1024
const BODY_TOO_LARGE = 'Request body is too large'
/** sun_path is 104 bytes on macOS (108 on Linux), including the terminating NUL. */
const MAX_SOCKET_PATH_BYTES = 103

export function fitsSocketPath(socketPath: string): boolean { return Buffer.byteLength(socketPath) <= MAX_SOCKET_PATH_BYTES }

/**
 * Where the endpoint listens. Windows: a named pipe with an unguessable name. Elsewhere a socket in
 * a private folder under the app's data when the path fits sun_path, else null: the caller makes a
 * private temporary folder instead (`~/Library/Application Support/Pulpo/…` is long for a long user name).
 */
export function relayEndpoint(platform: NodeJS.Platform, computerDir: string, random = randomBytes(8).toString('hex')): string | null {
  if (platform === 'win32') return `\\\\.\\pipe\\pulpo-relay-${random}`
  const candidate = path.posix.join(computerDir, 'relay', 'pulpo.sock')
  return fitsSocketPath(candidate) ? candidate : null
}

export interface RelayServer {
  /** The value of `PULPO_RELAY_SOCKET`. */
  endpoint: string
  close(): Promise<void>
}

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }

function json(response: ServerResponse, status: number, value: unknown): void {
  if (response.writableEnded || response.destroyed) return
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(value))
}

async function body(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []; let size = 0
  for await (const chunk of request) {
    const value = Buffer.from(chunk as Buffer); size += value.length
    if (size > MAX_RELAY_BODY) throw new Error(BODY_TOO_LARGE)
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

export interface RelayServerOptions {
  platform: NodeJS.Platform
  /** `<userData>/computer`. */
  computerDir: string
  /** For the fallback folder when the usual socket path is too long. */
  tmpdir: string
  operations: Pick<Operations, 'holdRelay'>
  /** Tests pin the endpoint. */
  endpoint?: string
}

/** Starts listening; rejects when the endpoint cannot be created, which costs the agent only `pulpo files`. */
export async function startRelayServer(options: RelayServerOptions): Promise<RelayServer> {
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== 'POST' || new URL(request.url ?? '/', 'http://relay').pathname !== '/v1/requests') return json(response, 404, { ok: false, error: 'not_found' })
      const input = JSON.parse((await body(request)).toString('utf8')) as unknown
      // The contract bounds what an operation may list (computerRelayRequestSchema).
      if (!isRecord(input) || typeof input.operationId !== 'string' || !input.operationId || input.operationId.length > 200
        || typeof input.command !== 'string' || !input.command || input.command.length > 200 || !isRecord(input.args)) {
        return json(response, 400, { ok: false, error: 'Invalid relay request' })
      }
      if (response.destroyed) return
      const drop = options.operations.holdRelay({ operationId: input.operationId, command: input.command, args: input.args }, (status, value) => json(response, status, value))
      // The CLI was killed (or the command with it): nobody waits for the answer any more.
      response.once('close', drop)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      json(response, message === BODY_TOO_LARGE ? 413 : 400, { ok: false, error: message })
    }
  })

  let endpoint = options.endpoint ?? relayEndpoint(options.platform, options.computerDir)
  let temporaryDir: string | null = null
  if (options.platform !== 'win32') {
    if (endpoint) await mkdir(path.dirname(endpoint), { recursive: true, mode: 0o700 })
    else {
      // mkdtemp makes the folder 0700, so nobody else can reach the socket in the moment before its chmod.
      for (const base of [options.tmpdir, '/tmp']) {
        const directory = await mkdtemp(path.join(base, 'pulpo-'))
        const candidate = path.join(directory, 'r.sock')
        if (fitsSocketPath(candidate)) { temporaryDir = directory; endpoint = candidate; break }
        await rm(directory, { recursive: true, force: true })
      }
      if (!endpoint) throw new Error('No folder is short enough for the relay socket')
    }
    await chmod(path.dirname(endpoint), 0o700).catch(() => undefined)
    // A socket left behind by a crash; the single-instance lock means no live app owns it.
    await rm(endpoint, { force: true })
  }
  const listening = endpoint!
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(listening, () => { server.off('error', reject); resolve() })
  })
  if (options.platform !== 'win32') await chmod(listening, 0o600)

  let closed: Promise<void> | null = null
  return {
    endpoint: listening,
    close: () => {
      closed ??= (async () => {
        // First and synchronously: the app may be gone before anything awaited here runs.
        if (options.platform !== 'win32') { try { rmSync(listening, { force: true }) } catch { /* already gone */ } }
        await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections() })
        if (temporaryDir) await rm(temporaryDir, { recursive: true, force: true }).catch(() => undefined)
      })()
      return closed
    },
  }
}
