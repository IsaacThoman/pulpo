export const ANDROID_PACKAGE_NAME = 'com.isaacthoman.pulpo'

export function androidCertificateFingerprints(value: string): string[] {
  return [...new Set(value.split(',').map((item) => item.trim().replace(/:/g, '').toUpperCase()).filter(Boolean))].map((hex) => {
    if (!/^[A-F0-9]{64}$/.test(hex)) throw new Error('Android signing certificates must be SHA-256 fingerprints (64 hex digits).')
    return hex.match(/.{2}/g)!.join(':')
  })
}

export function androidPasskeyOrigins(value: string): string[] {
  return androidCertificateFingerprints(value).map((fingerprint) => `android:apk-key-hash:${Buffer.from(fingerprint.replace(/:/g, ''), 'hex').toString('base64url')}`)
}

export function androidAssetLinks(value: string) {
  const fingerprints = androidCertificateFingerprints(value)
  return fingerprints.length ? [{
    relation: ['delegate_permission/common.handle_all_urls', 'delegate_permission/common.get_login_creds'],
    target: { namespace: 'android_app', package_name: ANDROID_PACKAGE_NAME, sha256_cert_fingerprints: fingerprints },
  }] : []
}

export function passkeyVerificationOrigins(flow: string, expectedOrigin: string, fingerprints: string): string | string[] {
  return flow === 'native-authentication' || flow === 'native-registration'
    ? [expectedOrigin, ...androidPasskeyOrigins(fingerprints)]
    : expectedOrigin
}
