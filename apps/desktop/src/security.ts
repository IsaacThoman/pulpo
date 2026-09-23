export const DESKTOP_ORIGIN = 'https://desktop.pulpo.invalid'

export const RENDERER_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob: https:; connect-src 'self' https: wss:; worker-src 'self' blob:; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-src 'self'; form-action 'self' https:"

/** Code previews run here, in an iframe without allow-same-origin. Keep in sync with apps/web/sandbox.html. */
export const SANDBOX_PATH = '/sandbox.html'
export const SANDBOX_CSP = "sandbox allow-scripts allow-modals allow-popups allow-forms allow-downloads; default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; font-src data: https:; media-src data: blob: https:; connect-src 'self' https:; worker-src blob:; frame-src 'none'; base-uri 'none'; form-action 'none'"

export function isSandboxUrl(value: string): boolean {
  try {
    return new URL(value).pathname === SANDBOX_PATH
  } catch {
    return false
  }
}

export function rendererCsp(pathname: string): string {
  return pathname === SANDBOX_PATH ? SANDBOX_CSP : RENDERER_CSP
}

/** Extra headers the renderer protocol adds to bundled files; the CSP is applied separately. */
export function rendererAssetHeaders(pathname: string): Record<string, string> {
  if (pathname === SANDBOX_PATH) return { 'Cache-Control': 'no-cache' }
  // The sandbox's opaque origin fetches module chunks in CORS mode.
  if (pathname.startsWith('/assets/')) return { 'Access-Control-Allow-Origin': '*' }
  return {}
}

export function desktopDevelopmentRequestHeaders(
  headers: Record<string, string>,
  developmentOrigin: string,
): Record<string, string> {
  const originKey = Object.keys(headers).find((key) => key.toLowerCase() === 'origin')
  if (!originKey || headers[originKey] !== new URL(developmentOrigin).origin) return headers
  return { ...headers, [originKey]: DESKTOP_ORIGIN }
}

export function desktopDevelopmentResponseHeaders(
  headers: Record<string, string[]>,
  developmentOrigin: string,
): Record<string, string[]> {
  const originKey = Object.keys(headers).find((key) => key.toLowerCase() === 'access-control-allow-origin')
  if (!originKey || !headers[originKey]?.includes(DESKTOP_ORIGIN)) return headers
  return {
    ...headers,
    [originKey]: headers[originKey].map((value) => value === DESKTOP_ORIGIN
      ? new URL(developmentOrigin).origin
      : value),
  }
}

export function isTrustedRendererUrl(value: string, developmentOrigin?: string): boolean {
  try {
    const origin = new URL(value).origin
    return origin === DESKTOP_ORIGIN || Boolean(developmentOrigin && origin === new URL(developmentOrigin).origin)
  } catch {
    return false
  }
}

export function desktopPermissionAllowed(
  rendererUrl: string,
  permission: string,
  mediaTypes?: readonly string[],
  developmentOrigin?: string,
): boolean {
  if (!isTrustedRendererUrl(rendererUrl, developmentOrigin) || isSandboxUrl(rendererUrl)) return false
  if (permission === 'clipboard-sanitized-write') return true
  return permission === 'media' && (!mediaTypes || mediaTypes.every((type) => type === 'audio'))
}

export function validatedExternalUrl(value: string, allowLocalhost: boolean): string {
  const url = new URL(value)
  const localhost = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.username || url.password || (url.protocol !== 'https:' && !(allowLocalhost && localhost && url.protocol === 'http:'))) {
    throw new Error('Pulpo can only open secure web addresses.')
  }
  return url.toString()
}

export function validatedProtocolUrl(value: string): string {
  const url = new URL(value)
  const pathAllowed = url.pathname === '/passkey' || url.pathname === '/passkey-enrollment'
  if (url.protocol !== 'pulpo:' || url.host !== 'auth' || !pathAllowed) {
    throw new Error('Invalid Pulpo callback URL.')
  }
  return url.toString()
}

export function rendererAssetPath(pathname: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  const segments = decoded.split('/').filter(Boolean)
  if (segments.some((part) => part === '.' || part === '..' || part.includes('\\') || part.includes('\0'))) return null
  return segments.join('/')
}
