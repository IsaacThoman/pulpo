import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  GetObjectLockConfigurationCommand,
  GetObjectRetentionCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3'

const mocks = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-s3')>()
  return { ...actual, S3Client: class { send = mocks.send } }
})

import { B2BackupStore } from './b2-backup-store.js'

const settings = {
  enabled: true,
  endpoint: 'https://s3.us-west-004.backblazeb2.com',
  region: 'us-west-004',
  bucket: 'pulpo-backups',
  prefix: 'pulpo/production',
  keyId: 'key-id',
  encryptedApplicationKey: 'encrypted',
  applicationKey: 'secret',
  recipient: 'age1recipient',
  intervalHours: 24 as const,
  retentionDays: 30,
  nextRunAt: null,
}

describe('Backblaze backup store', () => {
  beforeEach(() => {
    mocks.send.mockReset()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 403 })))
  })

  it('validates Object Lock and removes its capability probe', async () => {
    vi.useFakeTimers()
    mocks.send.mockImplementation(async (command: unknown) => command instanceof GetObjectLockConfigurationCommand
      ? { ObjectLockConfiguration: { ObjectLockEnabled: 'Enabled' } }
      : {})
    const test = new B2BackupStore(settings).testConnection()
    await vi.runAllTimersAsync()
    await test
    expect(mocks.send.mock.calls.map(([command]) => command.constructor)).toEqual([
      GetObjectLockConfigurationCommand, PutObjectCommand, HeadObjectCommand, GetObjectCommand,
      ListObjectsV2Command, GetObjectRetentionCommand, DeleteObjectCommand,
    ])
    const probe = mocks.send.mock.calls[1]![0] as PutObjectCommand
    expect(probe.input).toMatchObject({ ObjectLockMode: 'COMPLIANCE' })
    vi.useRealTimers()
  })

  it('rejects buckets with a default retention rule before creating a probe', async () => {
    mocks.send.mockImplementation(async (command: unknown) => command instanceof GetObjectLockConfigurationCommand
      ? { ObjectLockConfiguration: { ObjectLockEnabled: 'Enabled', Rule: { DefaultRetention: { Mode: 'COMPLIANCE', Days: 30 } } } }
      : {})
    await expect(new B2BackupStore(settings).testConnection()).rejects.toThrow('default retention rule')
    expect(mocks.send).toHaveBeenCalledTimes(1)
  })

  it('rejects a publicly readable bucket and still removes the locked probe', async () => {
    vi.useFakeTimers()
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }))
    mocks.send.mockImplementation(async (command: unknown) => command instanceof GetObjectLockConfigurationCommand
      ? { ObjectLockConfiguration: { ObjectLockEnabled: 'Enabled' } }
      : {})
    const test = expect(new B2BackupStore(settings).testConnection()).rejects.toThrow('must be private')
    await vi.runAllTimersAsync()
    await test
    expect(mocks.send.mock.calls.at(-1)?.[0]).toBeInstanceOf(DeleteObjectCommand)
    vi.useRealTimers()
  })

  it('applies per-object Compliance retention and non-secret recovery metadata', async () => {
    mocks.send.mockResolvedValue({})
    const lockedUntil = new Date('2026-10-02T00:00:00.000Z')
    await new B2BackupStore(settings).putEncrypted('backup.age', Readable.from(['ciphertext']), 10, 'job-1', 'fingerprint', lockedUntil)
    const command = mocks.send.mock.calls[0]![0] as PutObjectCommand
    expect(command.input).toMatchObject({
      Bucket: 'pulpo-backups', Key: 'backup.age', ContentLength: 10,
      ObjectLockMode: 'COMPLIANCE', ObjectLockRetainUntilDate: lockedUntil,
      Metadata: { 'pulpo-job-id': 'job-1', 'pulpo-recipient': 'fingerprint' },
    })
    expect(JSON.stringify(command.input)).not.toContain('secret')
  })

  it('reads idempotency metadata and streams encrypted downloads', async () => {
    mocks.send.mockImplementation(async (command: unknown) => {
      if (command instanceof HeadObjectCommand) return {
        ContentLength: 10,
        Metadata: { 'pulpo-job-id': 'job-1', 'pulpo-recipient': 'fingerprint' },
      }
      if (command instanceof GetObjectCommand) return {
        ContentLength: 10,
        Body: Readable.from(['ciphertext']),
      }
      return {}
    })
    const store = new B2BackupStore(settings)
    await expect(store.head('backup.age')).resolves.toEqual({
      sizeBytes: 10, jobId: 'job-1', recipientFingerprint: 'fingerprint',
    })
    const downloaded = await store.getStream('backup.age')
    const chunks: Buffer[] = []
    for await (const chunk of downloaded.body) chunks.push(Buffer.from(chunk))
    expect(Buffer.concat(chunks).toString()).toBe('ciphertext')
    expect(downloaded.contentLength).toBe(10)
  })
})
