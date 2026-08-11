import {
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  startAuthentication,
  startRegistration,
  WebAuthnError,
  WebAuthnAbortService,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/browser'
import type { PasskeyCeremony } from '@pulpo/contracts'

export { browserSupportsWebAuthn, browserSupportsWebAuthnAutofill }

export function cancelPasskeyCeremony(): void {
  WebAuthnAbortService.cancelCeremony()
}

export function isPasskeyCancellation(error: unknown): boolean {
  return error instanceof WebAuthnError
    ? error.name === 'NotAllowedError' || error.code === 'ERROR_CEREMONY_ABORTED'
    : error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'AbortError')
}

export function passkeyErrorMessage(error: unknown, fallback: string): string {
  if (isPasskeyCancellation(error)) return ''
  if (error instanceof WebAuthnError && error.name === 'SecurityError') {
    return 'Passkeys are not configured for this Pulpo domain.'
  }
  return error instanceof Error ? error.message : fallback
}

export function authenticateWithPasskey(
  ceremony: PasskeyCeremony,
  useBrowserAutofill = false,
): Promise<AuthenticationResponseJSON> {
  return startAuthentication({
    optionsJSON: ceremony.options as unknown as PublicKeyCredentialRequestOptionsJSON,
    useBrowserAutofill,
  })
}

export function registerPasskey(ceremony: PasskeyCeremony): Promise<RegistrationResponseJSON> {
  return startRegistration({
    optionsJSON: ceremony.options as unknown as PublicKeyCredentialCreationOptionsJSON,
  })
}
