import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let protocolListener: ((url: string) => void) | undefined
let scheduledTimeout: (() => void) | undefined
const unsubscribe = vi.fn()

beforeEach(() => {
  protocolListener = undefined
  scheduledTimeout = undefined
  unsubscribe.mockClear()
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      pulpoDesktop: {
        platform: 'desktop',
        onProtocolUrl: (listener: (url: string) => void) => {
          protocolListener = listener
          return unsubscribe
        },
      },
      setTimeout: (handler: () => void) => {
        scheduledTimeout = handler
        return 1
      },
      clearTimeout: vi.fn(),
      location: { origin: 'https://desktop.pulpo.invalid' },
    },
  })
})

afterEach(() => {
  vi.useRealTimers()
  Reflect.deleteProperty(globalThis, 'window')
})

describe('desktop passkey callbacks', () => {
  it('ignores malformed, unexpected, and state-mismatched callbacks', async () => {
    const { waitForDesktopPasskeyCallback } = await import('./desktop-passkeys')
    const result = waitForDesktopPasskeyCallback('/passkey', 'expected-state')

    protocolListener?.('not a URL')
    protocolListener?.('pulpo://auth/passkey-enrollment?state=expected-state&code=wrong-path')
    protocolListener?.('pulpo://auth/passkey?state=stale-state&code=wrong-state')
    protocolListener?.('pulpo://auth/passkey?state=expected-state&code=accepted')

    const parameters = await result
    expect(parameters.get('state')).toBe('expected-state')
    expect(parameters.get('code')).toBe('accepted')
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('reports an explicit cancellation from the matching callback', async () => {
    const { DesktopPasskeyCancelledError, waitForDesktopPasskeyCallback } = await import('./desktop-passkeys')
    const result = waitForDesktopPasskeyCallback('/passkey', 'expected-state')
    protocolListener?.('pulpo://auth/passkey?state=expected-state&error=cancelled')
    await expect(result).rejects.toBeInstanceOf(DesktopPasskeyCancelledError)
  })

  it('expires stale pending callbacks', async () => {
    const { waitForDesktopPasskeyCallback } = await import('./desktop-passkeys')
    const result = waitForDesktopPasskeyCallback('/passkey', 'expected-state')
    const expectation = expect(result).rejects.toThrow('expired')
    scheduledTimeout?.()
    await expectation
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
