const RECOVERY_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{12}$/

export function normalizeAuthenticatorCode(value: string): string {
  return value.replace(/\D/g, '').slice(0, 6)
}

export function normalizeRecoveryCodeInput(value: string): string {
  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
  return compact.match(/.{1,4}/g)?.join('-') ?? ''
}

export function normalizeSecondFactorCode(value: string): string {
  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (/^\d{0,6}$/.test(compact)) return compact
  return normalizeRecoveryCodeInput(compact)
}

export function isValidAuthenticatorCode(value: string): boolean {
  return /^\d{6}$/.test(value)
}

export function isValidRecoveryCode(value: string): boolean {
  return RECOVERY_CODE_PATTERN.test(value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
}

export function isValidSecondFactorCode(value: string): boolean {
  return isValidAuthenticatorCode(value) || isValidRecoveryCode(value)
}
