import { apiRequest } from './api'
import { onDesktopProtocolUrl, openExternalUrl, runtimeInstanceUrl } from './runtime'
import type { NativeAuthResponse } from '@pulpo/contracts'
import { ui } from '@/i18n/ui'

export class DesktopPasskeyCancelledError extends Error {
  constructor() {
    super('Passkey request cancelled.')
    this.name = 'DesktopPasskeyCancelledError'
  }
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

async function pkce(): Promise<{ verifier: string; challenge: string; state: string }> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)))
  const state = base64Url(crypto.getRandomValues(new Uint8Array(32)))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, state, challenge: base64Url(new Uint8Array(digest)) }
}

export function waitForDesktopPasskeyCallback(path: '/passkey' | '/passkey-enrollment', state: string): Promise<URLSearchParams> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      unsubscribe()
      reject(new Error(ui("The passkey request expired.")))
    }, 5 * 60_000)
    const unsubscribe = onDesktopProtocolUrl((value) => {
      try {
        const callback = new URL(value)
        if (callback.protocol !== 'pulpo:' || callback.host !== 'auth' || callback.pathname !== path || callback.searchParams.get('state') !== state) return
        unsubscribe()
        window.clearTimeout(timeout)
        if (callback.searchParams.get('error')) reject(new DesktopPasskeyCancelledError())
        else resolve(callback.searchParams)
      } catch {
        // The main process already filters callback shapes; ignore malformed input defensively.
      }
    })
  })
}

export async function authenticateDesktopPasskey(): Promise<NativeAuthResponse> {
  const request = await pkce()
  const authorization = new URL('/mobile/passkey', runtimeInstanceUrl())
  authorization.searchParams.set('client_id', 'pulpo-desktop')
  authorization.searchParams.set('response_type', 'code')
  authorization.searchParams.set('redirect_uri', 'pulpo://auth/passkey')
  authorization.searchParams.set('state', request.state)
  authorization.searchParams.set('code_challenge', request.challenge)
  authorization.searchParams.set('code_challenge_method', 'S256')
  const callbackPromise = waitForDesktopPasskeyCallback('/passkey', request.state)
  await openExternalUrl(authorization.toString())
  const parameters = await callbackPromise
  const code = parameters.get('code')
  if (!code || code.length < 32) throw new Error(ui("The passkey authorization code was missing."))
  return apiRequest<NativeAuthResponse>('/api/mobile/auth/passkey/browser/exchange', {
    method: 'POST', body: { code, codeVerifier: request.verifier, deviceLabel: 'Pulpo for Mac' },
  })
}

export async function enrollDesktopPasskey(input: {
  name: string
  currentPassword: string
  verificationCode?: string
}): Promise<void> {
  const state = base64Url(crypto.getRandomValues(new Uint8Array(32)))
  const result = await apiRequest<{ url: string }>('/api/me/passkeys/browser-registration', {
    method: 'POST', body: { ...input, state },
  })
  const enrollment = new URL(result.url)
  if (enrollment.origin !== new URL(runtimeInstanceUrl()).origin || enrollment.pathname !== '/mobile/passkey/enroll') {
    throw new Error(ui("The passkey enrollment URL did not match this instance."))
  }
  const callbackPromise = waitForDesktopPasskeyCallback('/passkey-enrollment', state)
  await openExternalUrl(enrollment.toString())
  const parameters = await callbackPromise
  if (parameters.get('status') !== 'success') throw new Error(ui("Passkey enrollment was not completed."))
}
