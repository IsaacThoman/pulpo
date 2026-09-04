import { describe, expect, it } from 'vitest'
import { privateIp } from './url-security.js'

describe('privateIp', () => {
  it.each(['127.0.0.1', '10.0.0.1', '172.16.1.1', '192.168.1.1', '169.254.1.1', '100.64.0.1', '198.51.100.2', '::1', 'fd00::1', 'fe80::1', '2001:db8::1', '::ffff:127.0.0.1', '::ffff:7f00:1'])(
    'blocks private or special address %s',
    (address) => expect(privateIp(address)).toBe(true),
  )

  it.each(['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111'])(
    'allows public address %s',
    (address) => expect(privateIp(address)).toBe(false),
  )
})
