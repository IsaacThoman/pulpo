import { describe, expect, it } from 'vitest'
import { backupSettingsPayload, type BackupForm } from './backup-settings-form'

const configured: BackupForm = {
  enabled: true,
  endpoint: 'https://s3.us-west-004.backblazeb2.com',
  bucket: 'pulpo-backups',
  prefix: 'pulpo/production',
  keyId: 'application-key-id',
  applicationKey: '',
  recipient: 'age1example',
  intervalHours: 24,
  retentionDays: 30,
}

describe('offsite backup settings form', () => {
  it('never submits the masked placeholder as an application key', () => {
    expect(backupSettingsPayload(configured)).not.toHaveProperty('applicationKey')
  })

  it('submits an application key only when an administrator replaces it', () => {
    expect(backupSettingsPayload({ ...configured, applicationKey: 'replacement-secret' })).toMatchObject({
      applicationKey: 'replacement-secret',
    })
  })
})
