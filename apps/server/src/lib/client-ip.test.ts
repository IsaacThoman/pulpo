import type { IncomingMessage } from 'node:http'
import Fastify from 'fastify'
import rateLimit from '@fastify/rate-limit'
import { describe, expect, it } from 'vitest'
import { resolveClientIp, trustedProxyAddresses, type ClientIpConfig } from './client-ip.js'
import { parseConfig } from '../config.js'

const config: ClientIpConfig = { PULPO_CLIENT_IP_MODE: 'cloudflare', PULPO_TRUSTED_PROXY_CIDRS: '127.0.0.1/32,::1/128,10.0.0.0/24' }
function request(headers: IncomingMessage['headers'] = {}, peer = '127.0.0.1') {
  return { headers, socket: { remoteAddress: peer } } as IncomingMessage
}

describe('trusted visitor IPs', () => {
  it('defaults to direct mode and validates explicit trust configuration', () => {
    expect(parseConfig({}).PULPO_CLIENT_IP_MODE).toBe('direct')
    expect(() => parseConfig({ PULPO_CLIENT_IP_MODE: 'cloudflare' })).toThrow('PULPO_TRUSTED_PROXY_CIDRS')
    for (const value of ['true', '2', '*', 'loopback', '0.0.0.0/0', '::/0', '10.0.0.0/33', '::1/129', '127.0.0.1,', '127.0.0.1/x']) {
      expect(() => trustedProxyAddresses(value), value).toThrow()
    }
    expect(trustedProxyAddresses('127.0.0.1, ::1/128')).toHaveLength(2)
  })
  it('ignores forwarded headers in direct mode and from untrusted peers', () => {
    const headers = { 'cf-connecting-ip': '198.51.100.4', 'x-forwarded-for': '198.51.100.4' }
    expect(resolveClientIp(request(headers), { ...config, PULPO_CLIENT_IP_MODE: 'direct' })).toBe('127.0.0.1')
    expect(resolveClientIp(request(headers, '192.0.2.1'), config)).toBe('192.0.2.1')
  })
  it.each(['198.51.100.4', '2001:db8::4'])('accepts Cloudflare IP %s through trusted IPv4/IPv6 peers', (ip) => {
    expect(resolveClientIp(request({ 'cf-connecting-ip': ip }), config)).toBe(ip)
    expect(resolveClientIp(request({ 'cf-connecting-ip': ip }, '::1'), config)).toBe(ip)
    expect(resolveClientIp(request({ 'cf-connecting-ip': ip }, '::ffff:127.0.0.1'), config)).toBe(ip)
  })
  it('supports Pseudo IPv4 but does not prefer IPv6 for ordinary IPv4', () => {
    expect(resolveClientIp(request({ 'cf-connecting-ip': '240.1.2.3', 'cf-connecting-ipv6': '2001:db8::1' }), config)).toBe('2001:db8::1')
    expect(resolveClientIp(request({ 'cf-connecting-ip': '198.51.100.2', 'cf-connecting-ipv6': '2001:db8::1' }), config)).toBe('198.51.100.2')
  })
  it.each([undefined, '', 'bad', '198.51.100.4, 192.0.2.1', ['198.51.100.4'], '198.51.100.4:123'])('falls back for invalid Cloudflare header %j', (ip) => {
    expect(resolveClientIp(request({ 'cf-connecting-ip': ip, 'x-forwarded-for': '198.51.100.4' }), config)).toBe('127.0.0.1')
  })
  it('resolves trusted forwarded chains, stopping at the nearest untrusted address', () => {
    const forwarded = { ...config, PULPO_CLIENT_IP_MODE: 'forwarded' as const }
    expect(resolveClientIp(request({ 'x-forwarded-for': '198.51.100.4, 10.0.0.2' }), forwarded)).toBe('198.51.100.4')
    expect(resolveClientIp(request({ 'x-forwarded-for': '198.51.100.4, 192.0.2.2' }), forwarded)).toBe('192.0.2.2')
    expect(resolveClientIp(request({ 'x-forwarded-for': '2001:db8::1, 10.0.0.2' }), forwarded)).toBe('2001:db8::1')
    for (const value of ['', 'bad, 10.0.0.2', ', 10.0.0.2', '198.51.100.4:500']) expect(resolveClientIp(request({ 'x-forwarded-for': value }), forwarded)).toBe('127.0.0.1')
  })
  it('uses visitor IPs for rate limiting without trusting host/protocol', async () => {
    const app = Fastify()
    await app.register(rateLimit, { max: 1, timeWindow: '1 minute', keyGenerator: (req) => resolveClientIp(req.raw, config) ?? req.ip })
    app.get('/', (req) => ({ hostname: req.hostname, protocol: req.protocol }))
    const first = await app.inject({ url: '/', headers: { 'cf-connecting-ip': '198.51.100.1', 'x-forwarded-host': 'evil.test', 'x-forwarded-proto': 'https' } })
    expect(first.json()).toEqual({ hostname: 'localhost', protocol: 'http' })
    expect((await app.inject({ url: '/', headers: { 'cf-connecting-ip': '198.51.100.1' } })).statusCode).toBe(429)
    expect((await app.inject({ url: '/', headers: { 'cf-connecting-ip': '198.51.100.2' } })).statusCode).toBe(200)
    await app.close()
  })
})
