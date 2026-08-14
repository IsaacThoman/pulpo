import { describe, expect, it, vi } from 'vitest'
import {
  attachmentValidationError,
  hydrateEmbeddedResponseSnapshot,
  lineageFromLeaf,
  mergeRevisionInvalidation,
  normalizeInstanceUrl,
  ManagementApiError,
  PulpoManagementClient,
  reconcileResponseEvents,
  resolvePresetActions,
} from './index.js'

describe('client core', () => {
  it('hydrates compact embedded snapshots from the canonical response output', () => {
    const marker = {
      responseId: '00000000-0000-4000-8000-000000000001', status: 'completed' as const,
      sequence: 4, usage: null, error: null, updatedAt: '2026-08-01T00:00:00.000Z',
    }
    const output = [{ type: 'message', content: 'answer' }]
    expect(hydrateEmbeddedResponseSnapshot(marker, output)).toEqual({ ...marker, output })
    const full = { ...marker, output: [] }
    expect(hydrateEmbeddedResponseSnapshot(full, output)).toBe(full)
  })

  it('selects a branch lineage without looping malformed trees', () => {
    const nodes = [
      { id: 'root', parentResponseId: null },
      { id: 'left', parentResponseId: 'root' },
      { id: 'right', parentResponseId: 'root' },
      { id: 'leaf', parentResponseId: 'right' },
    ]
    expect(lineageFromLeaf(nodes, 'leaf').map((node) => node.id)).toEqual(['root', 'right', 'leaf'])
  })

  it('normalizes HTTPS instances and only permits local development HTTP', () => {
    expect(normalizeInstanceUrl('pulpo.baby/')).toBe('https://pulpo.baby')
    expect(normalizeInstanceUrl('http://localhost:3000/', true)).toBe('http://localhost:3000')
    expect(() => normalizeInstanceUrl('http://example.com')).toThrow('HTTPS')
    expect(() => normalizeInstanceUrl('https://pulpo.baby/?token=nope')).toThrow('origin')
  })

  it('reconciles unordered streaming events monotonically', () => {
    const responseId = '00000000-0000-4000-8000-000000000001'
    const snapshot = { responseId, status: 'in_progress' as const, sequence: 0, output: [], usage: null, error: null, updatedAt: '2026-08-01T00:00:00.000Z' }
    const result = reconcileResponseEvents(snapshot, [
      { responseId, sequence: 2, type: 'response.output_text.delta', payload: { delta: 'two' }, emittedAt: '2026-08-01T00:00:02.000Z' },
      { responseId, sequence: 1, type: 'response.output_text.delta', payload: { delta: 'one ' }, emittedAt: '2026-08-01T00:00:01.000Z' },
    ])
    expect(result.output).toMatchObject([{ content: [{ text: 'one two' }] }])
  })

  it('coalesces paired account and chat revisions without hiding account-only changes', () => {
    const account = mergeRevisionInvalidation(undefined, { revision: 10 })
    const paired = mergeRevisionInvalidation(account, { revision: 10, chatId: 'chat-1' })
    const combined = mergeRevisionInvalidation(paired, { revision: 11 })
    expect(combined).toEqual({
      revision: 11,
      chatIds: ['chat-1'],
      scopes: [],
      accountOnlyRevisions: [11],
    })
  })

  it('coalesces scoped revisions without treating them as generic account changes', () => {
    const friends = mergeRevisionInvalidation(undefined, { revision: 12, scopes: ['friends'] })
    const combined = mergeRevisionInvalidation(friends, { revision: 13, scopes: ['usage', 'friends'] })
    expect(combined).toEqual({
      revision: 13,
      chatIds: [],
      scopes: ['friends', 'usage'],
      accountOnlyRevisions: [],
    })
  })

  it('resolves preset defaults and filters parameters', async () => {
    const result = await resolvePresetActions('model', {}, async () => ({
      id: 'model', enabled: true, allowedParameters: ['reasoning_effort'],
      presets: [{ id: 'reasoning', name: 'Reasoning', icon: 'brain', defaultChoiceId: 'high', choices: [
        { id: 'high', displayName: 'High', action: { type: 'params', params: { reasoning_effort: 'high', model: 'forbidden' } } },
      ] }],
    }))
    expect(result).toMatchObject({ effectiveModelId: 'model', parameters: { reasoning_effort: 'high' } })
  })

  it('validates native attachments', () => {
    expect(attachmentValidationError({ name: 'notes.md', mimeType: 'text/markdown', sizeBytes: 10 })).toBeNull()
    expect(attachmentValidationError({ name: 'page.html', mimeType: 'text/html', sizeBytes: 10 })).toBeNull()
    expect(attachmentValidationError({ name: 'drawing.svg', mimeType: 'image/svg+xml', sizeBytes: 10 })).toBeNull()
    expect(attachmentValidationError({ name: 'archive.custom', mimeType: 'application/octet-stream', sizeBytes: 10 })).toBeNull()
    expect(attachmentValidationError({ name: 'LICENSE', mimeType: 'application/octet-stream', sizeBytes: 10 })).toBeNull()
    expect(attachmentValidationError({ name: ' ', mimeType: 'text/plain', sizeBytes: 10 })).toBe('Attachment name is required')
    expect(attachmentValidationError({ name: 'empty.txt', mimeType: 'text/plain', sizeBytes: 0 })).toBe('Attachment is empty')
    expect(attachmentValidationError({ name: 'large.bin', mimeType: 'application/octet-stream', sizeBytes: 25 * 1024 * 1024 + 1 })).toBe('Attachment exceeds the 25 MB limit')
    expect(attachmentValidationError(
      { name: 'larger.bin', mimeType: 'application/octet-stream', sizeBytes: 40 * 1024 * 1024 },
      50 * 1024 * 1024,
    )).toBeNull()
    expect(attachmentValidationError(
      { name: 'disabled.bin', mimeType: 'application/octet-stream', sizeBytes: 1 },
      0,
    )).toBe('Attachment exceeds the 0 MB limit')
  })

  it('sends management bearer tokens and parses API errors', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        managementApiVersion: 1,
        instance: { name: 'Pulpo', version: '1.0.0', publicUrl: 'https://pulpo.example.com' },
        deployment: {
          storageDriver: 's3', databaseConfigured: true, redisConfigured: true, s3Configured: true,
          encryptionConfigured: true, cookieSecure: true, smtpConfigured: false, workspaceControllerConfigured: false,
        },
        capabilities: ['settings'],
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'forbidden', message: 'No access' } }), {
        status: 403, headers: { 'content-type': 'application/json' },
      }))
    const client = new PulpoManagementClient('https://pulpo.example.com', 'mt-pulpo-prefix.secret', fetcher)
    expect((await client.info()).managementApiVersion).toBe(1)
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('authorization')).toBe('Bearer mt-pulpo-prefix.secret')
    await expect(client.me()).rejects.toEqual(expect.objectContaining<Partial<ManagementApiError>>({ status: 403, code: 'forbidden' }))
  })

  it('uploads catalog icon files as authenticated multipart data', async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const form = init?.body as FormData
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer token')
      expect(form.get('name')).toBe('Acme')
      expect(form.get('mode')).toBe('monochrome')
      expect((form.get('file') as File).type).toBe('image/png')
      return new Response(JSON.stringify({ id: 'icon-id' }), { status: 201 })
    })
    const client = new PulpoManagementClient('https://pulpo.example.com', 'token', fetcher as typeof fetch)

    await expect(client.upload('/api/management/v1/catalog-icons', {
      bytes: new Uint8Array([1, 2, 3]), filename: 'acme.png', contentType: 'image/png',
      fields: { name: 'Acme', mode: 'monochrome' },
    })).resolves.toEqual({ id: 'icon-id' })
  })

  it('uses the shared account endpoints for full two-factor management', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(input instanceof Request ? input.url : String(input)).pathname
      if (path.endsWith('/two-factor/enrollment/confirm') || path.endsWith('/two-factor/recovery-codes')) {
        return new Response(JSON.stringify({ recoveryCodes: Array.from({ length: 10 }, (_, index) => `CODE-${index}`) }), { status: 200 })
      }
      if (path.endsWith('/two-factor/enrollment')) {
        return new Response(JSON.stringify({
          manualKey: 'ABCDEFGHIJKLMNOP', otpauthUri: 'otpauth://totp/Pulpo:test',
          qrCodeDataUrl: 'data:image/png;base64,abc', expiresAt: '2026-08-09T12:00:00.000Z',
        }), { status: 201 })
      }
      if (init?.method === 'DELETE') return new Response(null, { status: 204 })
      return new Response(JSON.stringify({ enabled: true, recoveryCodesRemaining: 10 }), { status: 200 })
    })
    const client = new PulpoManagementClient('https://pulpo.example.com', 'session-token', fetcher as typeof fetch)

    expect(await client.twoFactorStatus()).toEqual({ enabled: true, recoveryCodesRemaining: 10 })
    await client.beginTwoFactorEnrollment({ currentPassword: 'password', verificationCode: '123456' })
    await client.confirmTwoFactorEnrollment('654321')
    await client.regenerateTwoFactorRecoveryCodes({ currentPassword: 'password', verificationCode: '123456' })
    await client.disableTwoFactor({ currentPassword: 'password', verificationCode: '123456' })

    expect(fetcher.mock.calls.map(([input]) => new URL(String(input)).pathname)).toEqual([
      '/api/me/two-factor', '/api/me/two-factor/enrollment', '/api/me/two-factor/enrollment/confirm',
      '/api/me/two-factor/recovery-codes', '/api/me/two-factor',
    ])
    expect(fetcher.mock.calls.at(-1)?.[1]?.method).toBe('DELETE')
  })
})
