import { lookup } from 'node:dns/promises'
import * as ipaddr from 'ipaddr.js'
import { getConfig } from '../config.js'
import { AppError } from './errors.js'

export function privateIp(address: string): boolean {
  try {
    let parsed: ipaddr.IPv4 | ipaddr.IPv6 = ipaddr.parse(address)
    if (parsed instanceof ipaddr.IPv6 && parsed.isIPv4MappedAddress()) parsed = parsed.toIPv4Address()
    return parsed.range() !== 'unicast'
  } catch {
    return true
  }
}

export async function assertSafePublicHttpUrl(value: string): Promise<URL> {
  let url: URL
  try { url = new URL(value) } catch { throw new AppError(400, 'url_invalid', 'Enter a valid HTTP or HTTPS URL') }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new AppError(400, 'url_protocol', 'URL must use HTTP or HTTPS')
  if (url.username || url.password) throw new AppError(400, 'url_credentials', 'URLs containing credentials are not allowed')
  if (url.hostname === 'localhost' || url.hostname.endsWith('.localhost') || url.hostname.endsWith('.local')) throw new AppError(400, 'url_private', 'Private URLs are not allowed')
  let addresses: Array<{ address: string; family: number }>
  try { addresses = await lookup(url.hostname, { all: true }) } catch { throw new AppError(400, 'url_unreachable', 'URL host could not be resolved') }
  if (!addresses.length || addresses.some(({ address }) => privateIp(address))) throw new AppError(400, 'url_private', 'Private URLs are not allowed')
  return url
}

export async function assertSafeProviderUrl(value: string): Promise<void> {
  const url = new URL(value)
  if (!['https:', 'http:'].includes(url.protocol)) throw new AppError(400, 'provider_url_protocol', 'Provider URL must use HTTP or HTTPS')
  if (getConfig().ALLOW_PRIVATE_PROVIDER_URLS) return
  if (url.protocol !== 'https:') throw new AppError(400, 'provider_url_https_required', 'Provider URL must use HTTPS')
  if (url.hostname === 'localhost' || url.hostname.endsWith('.local')) throw new AppError(400, 'provider_url_private', 'Private provider URLs are disabled')
  const addresses = await lookup(url.hostname, { all: true })
  if (addresses.some(({ address }) => privateIp(address))) throw new AppError(400, 'provider_url_private', 'Private provider URLs are disabled')
}
