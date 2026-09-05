import { describe, expect, it } from 'vitest'
import { accountDeletionRequirementsSchema, accountDeletionInputSchema, authSettingsSchema, mobileConfigSchema } from './index.js'

describe('account deletion contracts', () => {
  it('enables deletion by default for new and existing instance settings', () => {
    expect(authSettingsSchema.parse({}).accountDeletionEnabled).toBe(true)
    expect(authSettingsSchema.parse({ accountDeletionEnabled: false }).accountDeletionEnabled).toBe(false)
  })
  it('requires a password and trims an optional second factor', () => {
    expect(accountDeletionInputSchema.safeParse({}).success).toBe(false)
    expect(accountDeletionInputSchema.parse({ currentPassword: ' secret ', verificationCode: ' 123456 ' })).toEqual({ currentPassword: ' secret ', verificationCode: '123456' })
  })
  it('treats older mobile servers as unsupported', () => {
    const auth = { signupEnabled: true, pendingDetails: false, adminEmail: '', pendingMessage: '' }
    const config = { mobileApiVersion: 1, instance: { name: 'Test', version: '1', publicUrl: 'https://example.test' }, setupRequired: false, auth, capabilities: { bearerSessions: true, realtime: true, chatDuplication: true, publicSharing: true, attachments: true, folders: true } }
    expect(mobileConfigSchema.parse(config).auth.accountDeletionEnabled).toBe(false)
    expect(mobileConfigSchema.parse({ ...config, auth: { ...auth, accountDeletionEnabled: true } }).auth.accountDeletionEnabled).toBe(true)
  })
  it('does not interpret missing second-factor status as disabled', () => {
    expect(accountDeletionRequirementsSchema.safeParse({}).success).toBe(false)
    expect(accountDeletionRequirementsSchema.safeParse({ twoFactorEnabled: null }).success).toBe(false)
    expect(accountDeletionRequirementsSchema.parse({ twoFactorEnabled: false })).toEqual({ twoFactorEnabled: false })
  })

})
