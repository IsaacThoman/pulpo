import { describe, expect, it, vi } from 'vitest'
import { redirectFileIntent } from './fileIntent'

describe('document open routing', () => {
  it.each(['file:///Inbox/photo.heic', 'file:///Inbox/a%20%23%25.pdf', 'file:///Inbox/LICENSE'])('queues %s and opens the native app root', (uri) => {
    const enqueue = vi.fn()
    expect(redirectFileIntent(uri, enqueue)).toBe('/')
    expect(enqueue).toHaveBeenCalledExactlyOnceWith(uri)
  })
  it.each(['pulpo://auth/callback?code=abc', 'https://pulpo.baby/share/token', '/share/token', 'invalid%url', 'https://example.com/photo.jpg'])('preserves %s', (path) => {
    const enqueue = vi.fn()
    expect(redirectFileIntent(path, enqueue)).toBe(path)
    expect(enqueue).not.toHaveBeenCalled()
  })
})
