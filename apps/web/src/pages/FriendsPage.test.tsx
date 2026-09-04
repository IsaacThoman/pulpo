import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { FriendsHandle } from './FriendsPage'

describe('FriendsHandle', () => {
  it('shows the signed-in handle as a copy control', () => {
    const html = renderToStaticMarkup(<FriendsHandle username="preview_admin" />)

    expect(html).toContain('Your handle is')
    expect(html).toContain('@preview_admin')
    expect(html).toContain('Copy @preview_admin')
    expect(html).not.toContain('Edit profile')
  })
})

// These page tests do not exercise the authenticated composer lifecycle.
vi.mock('@/lib/local-first/composer-sync', () => ({ clearWebComposerSync: vi.fn() }))
