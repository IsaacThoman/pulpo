import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { getConfig } from '../config.js'
import { AppError } from './errors.js'

function privateIp(address: string): boolean {
  if (address === '::1' || address === '0:0:0:0:0:0:0:1' || address.startsWith('fc') || address.startsWith('fd') || address.startsWith('fe80:')) return true
  if (isIP(address) !== 4) return false
  const [a, b] = address.split('.').map(Number)
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168)
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
