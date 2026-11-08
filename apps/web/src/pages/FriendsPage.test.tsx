import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { MyProfileLink } from './FriendsPage'

describe('MyProfileLink', () => {
  it('links to the signed-in user profile', () => {
    const html = renderToStaticMarkup(<MemoryRouter><MyProfileLink username="preview_admin" /></MemoryRouter>)

    expect(html).toContain('My profile')
    expect(html).toContain('href="/preview_admin"')
    expect(html).not.toContain('Your handle is')
  })
})

// These page tests do not exercise the authenticated composer lifecycle.
vi.mock('@/lib/local-first/composer-sync', () => ({ clearWebComposerSync: vi.fn() }))
