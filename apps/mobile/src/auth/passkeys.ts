import Constants from 'expo-constants'
import * as Crypto from 'expo-crypto'
import * as WebBrowser from 'expo-web-browser'
import * as Passkeys from 'react-native-passkeys'
import { Platform } from 'react-native'
import type { PasskeyAuthenticationResponse, PasskeyCeremony, PasskeyRegistrationResponse } from '@pulpo/contracts'

export const PASSKEY_AUTH_CALLBACK = 'pulpo://auth/passkey'
export const PASSKEY_ENROLLMENT_CALLBACK = 'pulpo://auth/passkey-enrollment'

export class PasskeyCancelledError extends Error {
  constructor() {
    super('Passkey request cancelled.')
    this.name = 'PasskeyCancelledError'
  }
}

export class NativePasskeyError extends Error {
  readonly canRetryInSafari = true

  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : 'Native passkeys are not configured for this domain.')
    this.name = 'NativePasskeyError'
  }
}

function base64Url(value: string): string {
  return value.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function bytesToBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let output = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0
    const second = bytes[index + 1] ?? 0
    const third = bytes[index + 2] ?? 0
    const combined = (first << 16) | (second << 8) | third
    output += alphabet[(combined >> 18) & 63]
    output += alphabet[(combined >> 12) & 63]
    output += index + 1 < bytes.length ? alphabet[(combined >> 6) & 63] : '='
    output += index + 2 < bytes.length ? alphabet[combined & 63] : '='
  }
  return output
}

export function passkeyDomainAllowList(): string[] {
  const domains = Platform.OS === 'android' ? Constants.expoConfig?.extra?.androidPasskeyDomains : Constants.expoConfig?.extra?.passkeyDomains
  return Array.isArray(domains)
    ? domains.filter((value): value is string => typeof value === 'string').map((value) => value.toLowerCase())
    : Platform.OS === 'android' ? [] : ['pulpo.baby']
}

export function canUseNativePasskeys(instanceUrl: string): boolean {
  try {
    const url = new URL(instanceUrl)
    return (Platform.OS === 'ios' || Platform.OS === 'android')
      && url.protocol === 'https:'
      && (!url.port || url.port === '443')
      && passkeyDomainAllowList().includes(url.hostname.toLowerCase())
      && Passkeys.isSupported()
  } catch {
    return false
  }
}

export async function nativeAuthenticate(ceremony: PasskeyCeremony): Promise<PasskeyAuthenticationResponse> {
  const response = await Passkeys.get(ceremony.options as never)
  if (!response) throw new PasskeyCancelledError()
  return response as unknown as PasskeyAuthenticationResponse
}

export async function nativeRegister(ceremony: PasskeyCeremony): Promise<PasskeyRegistrationResponse> {
  const response = await Passkeys.create(ceremony.options as never)
  if (!response) throw new PasskeyCancelledError()
  return response as unknown as PasskeyRegistrationResponse
}

export async function createPkceRequest(): Promise<{ codeVerifier: string; codeChallenge: string; state: string }> {
  const [verifierBytes, stateBytes] = await Promise.all([
    Crypto.getRandomBytesAsync(32),
    Crypto.getRandomBytesAsync(32),
  ])
  const codeVerifier = base64Url(bytesToBase64(verifierBytes))
  const state = base64Url(bytesToBase64(stateBytes))
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, codeVerifier, {
    encoding: Crypto.CryptoEncoding.BASE64,
  })
  return { codeVerifier, codeChallenge: base64Url(digest), state }
}

export function validatePasskeyCallback(
  value: string,
  expectedPath: '/passkey' | '/passkey-enrollment',
  expectedState: string,
): URLSearchParams {
  const callback = new URL(value)
  if (callback.protocol !== 'pulpo:' || callback.host !== 'auth' || callback.pathname !== expectedPath) {
    throw new Error('The passkey callback did not come from Pulpo.')
  }
  if (callback.searchParams.get('state') !== expectedState) throw new Error('The passkey callback state did not match.')
  if (callback.searchParams.get('error')) throw new PasskeyCancelledError()
  return callback.searchParams
}

export async function runSafariPasskeyAuthentication(instanceUrl: string): Promise<{
  code: string
  codeVerifier: string
}> {
  const origin = new URL(instanceUrl).origin
  const pkce = await createPkceRequest()
  const authorization = new URL('/mobile/passkey', origin)
  authorization.searchParams.set('client_id', 'pulpo-ios')
  authorization.searchParams.set('response_type', 'code')
  authorization.searchParams.set('redirect_uri', PASSKEY_AUTH_CALLBACK)
  authorization.searchParams.set('state', pkce.state)
  authorization.searchParams.set('code_challenge', pkce.codeChallenge)
  authorization.searchParams.set('code_challenge_method', 'S256')
  if (authorization.origin !== origin) throw new Error('The passkey authorization origin did not match this instance.')

  const result = await WebBrowser.openAuthSessionAsync(authorization.toString(), PASSKEY_AUTH_CALLBACK)
  if (result.type !== 'success') throw new PasskeyCancelledError()
  const parameters = validatePasskeyCallback(result.url, '/passkey', pkce.state)
  const code = parameters.get('code')
  if (!code || code.length < 32) throw new Error('The passkey authorization code was missing.')
  return { code, codeVerifier: pkce.codeVerifier }
}

export async function openPasskeyEnrollment(url: string, expectedState: string, instanceUrl: string): Promise<void> {
  const enrollmentUrl = new URL(url)
  if (enrollmentUrl.origin !== new URL(instanceUrl).origin || enrollmentUrl.pathname !== '/mobile/passkey/enroll') {
    throw new Error('The passkey enrollment link did not match this instance.')
  }
  const result = await WebBrowser.openAuthSessionAsync(enrollmentUrl.toString(), PASSKEY_ENROLLMENT_CALLBACK)
  if (result.type !== 'success') throw new PasskeyCancelledError()
  const parameters = validatePasskeyCallback(result.url, '/passkey-enrollment', expectedState)
  if (parameters.get('status') !== 'success') throw new Error('Passkey enrollment was not completed.')
}
