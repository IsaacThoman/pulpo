import { parseSearchLocation, searchPath } from './navigation'

/**
 * Where this deployment's Pulpo lives. The build value is a fallback: the session response names
 * the right origin, so one Search build serves production, dev and pull request previews.
 */
export let pulpoOrigin = new URL(
  import.meta.env.VITE_PULPO_PUBLIC_URL || (import.meta.env.DEV ? 'http://localhost:5173' : 'https://pulpo.baby'),
).origin

export function setPulpoOrigin(url: string | undefined) {
  if (!url) return
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') pulpoOrigin = parsed.origin
  } catch {
    // Keep the build's origin when the server sends something unusable.
  }
}

const storageKey = 'pulpo-search-sign-in'
const maxAgeMs = 15 * 60_000
const base64urlValue = /^[A-Za-z0-9_-]{32,128}$/

function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

export async function startSignIn() {
  const state = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  const challenge = base64url(new Uint8Array(digest))
  const returnPath = searchPath(parseSearchLocation(new URL(window.location.href)))
  sessionStorage.setItem(storageKey, JSON.stringify({ state, verifier, returnPath, startedAt: Date.now() }))
  const login = new URL('/connect/search', pulpoOrigin)
  login.search = new URLSearchParams({ state, code_challenge: challenge }).toString()
  window.location.assign(login)
}

type Callback =
  | { code: string; codeVerifier: string }
  | { error: string }
  | null

export function consumeCallback(): Callback {
  const url = new URL(window.location.href)
  if (url.pathname !== '/auth/callback') return null
  // Remove one-time credentials before issuing requests or rendering links.
  window.history.replaceState(null, '', '/')
  const error = { error: 'This sign-in link could not be verified. Start again from Pulpo Search.' }
  try {
    const raw = sessionStorage.getItem(storageKey)
    sessionStorage.removeItem(storageKey)
    if (!raw) return error
    const data = JSON.parse(raw)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    if (
      !code || !base64urlValue.test(code) || state !== data.state || typeof data.state !== 'string'
      || !base64urlValue.test(data.state) || typeof data.verifier !== 'string' || !base64urlValue.test(data.verifier)
      || typeof data.startedAt !== 'number' || Date.now() - data.startedAt > maxAgeMs
      || typeof data.returnPath !== 'string'
    ) return error
    const target = new URL(data.returnPath, window.location.origin)
    if (target.origin !== window.location.origin || !['/', '/search'].includes(target.pathname)) return error
    window.history.replaceState(null, '', searchPath(parseSearchLocation(target)))
    return { code, codeVerifier: data.verifier }
  } catch {
    return error
  }
}
