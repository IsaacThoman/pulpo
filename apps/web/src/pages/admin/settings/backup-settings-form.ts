export interface BackupForm {
  enabled: boolean
  endpoint: string
  bucket: string
  prefix: string
  keyId: string
  applicationKey: string
  recipient: string
  intervalHours: 6 | 12 | 24
  retentionDays: number
}

export function backupSettingsPayload(form: BackupForm): Omit<BackupForm, 'applicationKey'> & { applicationKey?: string } {
  const { applicationKey, ...settings } = form
  return applicationKey ? { ...settings, applicationKey } : settings
}
