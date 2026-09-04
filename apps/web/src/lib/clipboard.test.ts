// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { writeClipboardText } from './clipboard'

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard')
})

describe('writeClipboardText', () => {
  it('reports a successful clipboard write', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })

    await expect(writeClipboardText('copied text')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('copied text')
  })

  it('reports rejected and unavailable clipboard writes', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError')) },
    })
    await expect(writeClipboardText('blocked text')).resolves.toBe(false)

    Reflect.deleteProperty(navigator, 'clipboard')
    await expect(writeClipboardText('missing clipboard')).resolves.toBe(false)
  })
})
