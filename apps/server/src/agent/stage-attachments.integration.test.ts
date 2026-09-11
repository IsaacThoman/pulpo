import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { once } from 'node:events'
import { expect, it, vi } from 'vitest'
import { stageWorkspaceAttachments } from './stage-attachments.js'
import { ControllerRequestError } from './lease-acquisition.js'

it('stages 500 files through the real daemon, skips a second pass, and repairs changed/deleted files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pulpo-stage-'))
  const token = 'isolated-workspace-test-token-0000000000'
  const child = spawn(process.execPath, ['--import', 'tsx', new URL('../../../../packages/workspace-daemon/src/index.ts', import.meta.url).pathname], {
    env: { ...process.env, PORT: '0', PULPO_WORKSPACE_ROOT: root, PULPO_WORKSPACE_TOKEN: token }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  try {
    const port = await new Promise<number>((resolve, reject) => {
      let output = ''
      const timeout = setTimeout(() => reject(new Error(`Daemon startup timed out: ${output}`)), 10_000)
      child.stderr.on('data', (data) => { output += data })
      child.stdout.on('data', (data) => {
        output += data
        const match = /listening on (\d+)/.exec(output)
        if (match) { clearTimeout(timeout); resolve(Number(match[1])) }
      })
      child.once('exit', () => { clearTimeout(timeout); reject(new Error(output)) })
    })
    const bytes = Buffer.alloc(1024, 'a')
    const checksum = createHash('sha256').update(bytes).digest('base64url')
    const files = Array.from({ length: 500 }, (_, index) => ({ path: join(root, `file-${index}`), objectKey: String(index), mimeType: 'application/octet-stream', checksum, sizeBytes: bytes.length }))
    const read = vi.fn(async () => Readable.from([bytes]))
    const request: Parameters<typeof stageWorkspaceAttachments>[1] = async (path, init) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, { ...init, headers: { ...init?.headers, authorization: `Bearer ${token}` } } as RequestInit)
      if (!response.ok) throw new ControllerRequestError(response.status, await response.text())
      return response
    }
    await stageWorkspaceAttachments(files, request, read)
    expect(read).toHaveBeenCalledTimes(500)
    await stageWorkspaceAttachments(files, request, read)
    expect(read).toHaveBeenCalledTimes(500)
    await writeFile(files[0]!.path, Buffer.alloc(1024, 'b'))
    await rm(files[1]!.path)
    await stageWorkspaceAttachments(files, request, read)
    expect(read).toHaveBeenCalledTimes(502)
    expect(await readFile(files[0]!.path)).toEqual(bytes)
    expect(await readFile(files[1]!.path)).toEqual(bytes)
    // A bad transfer never replaces a previously valid file.
    await expect(stageWorkspaceAttachments([{ ...files[0]!, checksum: 'incorrect' }], request, read)).rejects.toThrow('checksum')
    expect(await readFile(files[0]!.path)).toEqual(bytes)
  } finally {
    if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit') }
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)

it('falls back for old workspace images without hiding other controller errors', async () => {
  const read = vi.fn(async () => Readable.from(['x']))
  const request = vi.fn(async (path: string) => {
    if (path === '/v1/files/missing') throw new ControllerRequestError(404, 'not_found')
    return new Response('{}')
  })
  const files = [{ path: '/workspace/x', objectKey: 'x', mimeType: 'text/plain', checksum: null, sizeBytes: 1 }]
  await stageWorkspaceAttachments(files, request, read)
  expect(read).toHaveBeenCalledOnce()
  await expect(stageWorkspaceAttachments(files, async () => { throw new ControllerRequestError(503, 'busy') }, read)).rejects.toThrow('503')
  expect(read).toHaveBeenCalledOnce()
})
