import proxyaddr from '@fastify/proxy-addr'
import type { IncomingMessage } from 'node:http'
import { isIP } from 'node:net'

export interface ClientIpConfig {
  PULPO_CLIENT_IP_MODE: 'direct' | 'forwarded' | 'cloudflare'
  PULPO_TRUSTED_PROXY_CIDRS: string
}

export function trustedProxyAddresses(value: string): string[] {
  if (!value.trim()) return []
  const addresses = value.split(',').map((part) => part.trim())
  for (const address of addresses) {
    const [ip, prefix, extra] = address.split('/')
    const version = isIP(ip ?? '')
    if (!version || extra !== undefined || (prefix !== undefined && (!/^\d+$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > (version === 4 ? 32 : 128)))) {
      throw new Error('Use explicit proxy IP addresses or CIDRs with a nonzero prefix')
    }
  }
  proxyaddr.compile(addresses)
  return addresses
}

let cachedAddresses: string | undefined
let cachedTrust: ReturnType<typeof proxyaddr.compile> | undefined
function trustFor(value: string) {
  if (cachedAddresses !== value || !cachedTrust) {
    cachedTrust = proxyaddr.compile(trustedProxyAddresses(value))
    cachedAddresses = value
  }
  return cachedTrust
}

/** Resolve only the client IP. Forwarded host and protocol are not trusted. */
export function resolveClientIp(request: Pick<IncomingMessage, 'headers' | 'socket'>, config: ClientIpConfig): string | null {
  const peer = request.socket.remoteAddress ?? null
  if (!peer || !isIP(peer) || config.PULPO_CLIENT_IP_MODE === 'direct') return peer
  const trust = trustFor(config.PULPO_TRUSTED_PROXY_CIDRS)
  if (!trust(peer, 0)) return peer
  if (config.PULPO_CLIENT_IP_MODE === 'cloudflare') {
    const ip = request.headers['cf-connecting-ip']
    if (typeof ip !== 'string' || !isIP(ip)) return peer
    // Cloudflare's Pseudo IPv4 overwrite uses the reserved 240.0.0.0/4 range.
    const ipv6 = request.headers['cf-connecting-ipv6']
    if (isIP(ip) === 4 && Number(ip.split('.')[0]) >= 240 && typeof ipv6 === 'string' && isIP(ipv6) === 6) return ipv6
    return ip
  }
  const forwarded = request.headers['x-forwarded-for']
  if (typeof forwarded !== 'string' || !forwarded.split(',').every((ip) => isIP(ip.trim()))) return peer
  return proxyaddr(request as IncomingMessage, trust)
}
