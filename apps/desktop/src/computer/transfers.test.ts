import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startTransferServer, type TransferServer } from './test-helpers'
import { downloadFile, transferUrl, uploadFile, writeInline } from './transfers'

describe('transferUrl', () => {
  it('resolves the path against the session origin only', () => {
    expect(transferUrl('https://pulpo.example', '/api/computer/transfers/abc?token=x', false).toString()).toBe('https://pulpo.example/api/computer/transfers/abc?token=x')
  })

  it.each([
    ['/api/other', 'Invalid transfer URL'],
    ['/api/computer/transfers/../../admin', 'Invalid transfer URL'],
    ['/api/computer/transfers/a\\b', 'Invalid transfer URL'],
    ['https://evil.example/api/computer/transfers/x', 'Invalid transfer URL'],
    ['//evil.example/api/computer/transfers/x', 'Invalid transfer URL'],
  ])('refuses %j', (value, message) => {
    expect(() => transferUrl('https://pulpo.example', value, false)).toThrow(message)
  })

  it('needs https except for localhost in development', () => {
    expect(() => transferUrl('http://pulpo.example', '/api/computer/transfers/x', true)).toThrow(/https/)
    expect(() => transferUrl('http://localhost:3000', '/api/computer/transfers/x', false)).toThrow(/https/)
    expect(transferUrl('http://localhost:3000', '/api/computer/transfers/x', true).host).toBe('localhost:3000')
  })
})

describe('streaming transfers', () => {
  let server: TransferServer
  let base: string

  beforeAll(async () => {
    server = await startTransferServer()
    base = await mkdtemp(path.join(os.tmpdir(), 'pulpo-transfer-'))
  })

  afterAll(async () => {
    await server.close()
    await rm(base, { recursive: true, force: true })
  })

  it('uploads with content-length and no credentials', async () => {
    const file = path.join(base, 'up.bin')
    const bytes = Buffer.alloc(300_000, 7)
    await writeFile(file, bytes)
    await uploadFile(transferUrl(server.origin, '/api/computer/transfers/up?token=t', true), file, bytes.byteLength)
    expect(server.uploads.get('/api/computer/transfers/up?token=t')?.equals(bytes)).toBe(true)
    const request = server.requests.at(-1)!
    expect(request.headers['content-length']).toBe(String(bytes.byteLength))
    expect(request.headers.cookie).toBeUndefined()
    expect(request.headers.authorization).toBeUndefined()
  })

  it('downloads to a temporary name, verifying size and checksum', async () => {
    const bytes = Buffer.from('downloaded bytes')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    server.downloads.set('/api/computer/transfers/down?token=t', bytes)
    const target = path.join(base, 'nested', 'down.txt')
    await expect(downloadFile(transferUrl(server.origin, '/api/computer/transfers/down?token=t', true), target, { sizeBytes: bytes.byteLength, sha256 })).resolves.toBe(sha256)
    expect(await readFile(target, 'utf8')).toBe('downloaded bytes')

    const wrong = path.join(base, 'wrong.txt')
    await expect(downloadFile(transferUrl(server.origin, '/api/computer/transfers/down?token=t', true), wrong, { sizeBytes: bytes.byteLength, sha256: 'f'.repeat(64) })).rejects.toThrow(/checksum/)
    await expect(downloadFile(transferUrl(server.origin, '/api/computer/transfers/down?token=t', true), wrong, { sizeBytes: 3 })).rejects.toThrow(/larger than announced/)
    await expect(downloadFile(transferUrl(server.origin, '/api/computer/transfers/missing', true), wrong, { sizeBytes: 3 })).rejects.toThrow(/HTTP 404/)
    expect((await readdir(base)).filter((name) => name.endsWith('.pulpo-part'))).toEqual([])
    await expect(readFile(wrong)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('writes inline bytes the same way', async () => {
    const target = path.join(base, 'inline.txt')
    await writeInline(Buffer.from('hi').toString('base64'), target, { sizeBytes: 2 })
    expect(await readFile(target, 'utf8')).toBe('hi')
    await expect(writeInline(Buffer.from('hi').toString('base64'), target, { sizeBytes: 5 })).rejects.toThrow(/not the 5 announced/)
  })
})
