import { ui } from '@/i18n/ui'

export type LinkCheck = { ok: true; url: string } | { ok: false; error: string }

/**
 * Lets an editor take its own targets before the web rules apply (a sheet's `Sheet1!A1`): it
 * returns the link to store, or nothing to leave the text to the usual checks.
 */
export type LinkTargetAccept = (value: string) => string | null | undefined

const ALLOWED_SCHEMES = new Set(['http', 'https', 'mailto', 'tel'])
const EMAIL = /^[^\s@/:]+@[^\s@/:]+\.[^\s@/:]+$/
/** A host (with a dot, or localhost, or an IPv6 literal), an optional port, then a path. */
const HOST = /^(localhost|[^\s/?#:@.]+(\.[^\s/?#:@.]+)+|\[[0-9a-f:.]+\])(:\d+)?([/?#]\S*)?$/i

/**
 * What a typed link becomes: web addresses without a scheme get https:// ("example.com" →
 * "https://example.com"), email addresses mailto:, and only http(s), mailto:, and tel: links pass,
 * so a pasted javascript: or file: link is refused rather than stored.
 */
export function normalizeLink(input: string, accept?: LinkTargetAccept): LinkCheck {
  const value = input.trim()
  if (!value) return { ok: false, error: ui("Enter a link.") }
  const custom = accept?.(value)
  if (custom) return { ok: true, url: custom }
  // "localhost:3000" and "example.com:8080/x" are hosts with ports, not schemes.
  const scheme = /^([a-z][a-z\d+.-]*):(?!\d)/i.exec(value)?.[1]?.toLowerCase()
  if (scheme) {
    if (!ALLOWED_SCHEMES.has(scheme)) return { ok: false, error: ui("Links can start with http://, https://, mailto:, or tel:.") }
    if (scheme === 'mailto' || scheme === 'tel') {
      return value.length > scheme.length + 1 && !/\s/.test(value) ? { ok: true, url: value } : { ok: false, error: ui("Enter a valid link.") }
    }
    return validWebAddress(value) ? { ok: true, url: value } : { ok: false, error: ui("Enter a valid link.") }
  }
  if (EMAIL.test(value)) return { ok: true, url: `mailto:${value}` }
  const address = value.startsWith('//') ? `https:${value}` : `https://${value}`
  if ((value.startsWith('//') || HOST.test(value)) && validWebAddress(address)) return { ok: true, url: address }
  return { ok: false, error: ui("Enter a web address, like example.com.") }
}

function validWebAddress(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname) && !/\s/.test(value)
  } catch {
    return false
  }
}
