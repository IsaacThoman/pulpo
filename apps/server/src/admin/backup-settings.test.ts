import { generateHybridIdentity, generateIdentity, identityToRecipient } from 'age-encryption'
import { describe, expect, it } from 'vitest'
import { ageRecipientDetails, backupSettingsAuditMetadata, backupSettingsForExport, normalizeBackupPrefix, parseB2Endpoint } from './backup-settings.js'

describe('offsite backup settings', () => {
  it('accepts official Backblaze endpoints and rejects credential-forwarding destinations', () => {
    expect(parseB2Endpoint('https://s3.us-west-004.backblazeb2.com/')).toEqual({
      endpoint: 'https://s3.us-west-004.backblazeb2.com', region: 'us-west-004',
    })
    expect(() => parseB2Endpoint('http://s3.us-west-004.backblazeb2.com')).toThrow('official Backblaze endpoint')
    expect(() => parseB2Endpoint('https://example.com')).toThrow('official Backblaze endpoint')
    expect(() => parseB2Endpoint('https://key:secret@s3.us-west-004.backblazeb2.com')).toThrow('official Backblaze endpoint')
    expect(() => parseB2Endpoint('https://s3.us-west-004.backblazeb2.com.evil.example')).toThrow('official Backblaze endpoint')
    expect(() => parseB2Endpoint('https://s3.us-west-004.backblazeb2.com/path')).toThrow('official Backblaze endpoint')
    expect(() => parseB2Endpoint('not a URL')).toThrow('official Backblaze endpoint')
  })

  it('normalizes an object prefix without allowing an empty prefix', () => {
    expect(normalizeBackupPrefix(' /pulpo//production/ ')).toBe('pulpo/production')
    expect(normalizeBackupPrefix('///')).toBe('pulpo')
  })

  it('accepts classic and post-quantum public recipients with stable fingerprints', async () => {
    const classic = await identityToRecipient(await generateIdentity())
    const hybrid = await identityToRecipient(await generateHybridIdentity())
    expect(ageRecipientDetails(classic)).toMatchObject({ type: 'classic' })
    expect(ageRecipientDetails(hybrid)).toMatchObject({ type: 'post_quantum' })
    expect(ageRecipientDetails(classic).fingerprint).toBe(ageRecipientDetails(classic).fingerprint)
  })

  it('refuses private identities and malformed recipients', () => {
    expect(() => ageRecipientDetails('AGE-SECRET-KEY-1EXAMPLE')).toThrow('never the private identity')
    expect(() => ageRecipientDetails('age1not-valid')).toThrow('valid classic or post-quantum')
  })

  it('redacts encrypted credentials from exports and audit metadata', async () => {
    const recipient = await identityToRecipient(await generateIdentity())
    const settings = {
      enabled: true,
      endpoint: 'https://s3.us-west-004.backblazeb2.com',
      bucket: 'pulpo-backups',
      prefix: 'pulpo',
      keyId: 'key-id',
      encryptedApplicationKey: 'encrypted-application-secret',
      recipient,
      intervalHours: 24 as const,
      retentionDays: 30,
      nextRunAt: null,
    }
    const exported = backupSettingsForExport(settings)
    const audit = backupSettingsAuditMetadata(settings, true)
    expect(exported).not.toHaveProperty('encryptedApplicationKey')
    expect(exported).toMatchObject({ applicationKeyConfigured: true })
    expect(JSON.stringify(audit)).not.toContain('encrypted-application-secret')
    expect(audit).not.toHaveProperty('recipient')
  })
})
