import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { MyProfileLink } from './FriendsPage'

describe('MyProfileLink', () => {
  it('shows and links the signed-in user profile', () => {
    const html = renderToStaticMarkup(<MemoryRouter><MyProfileLink profile={{
      id: 'me',
      displayName: 'Jordan Lee',
      username: 'jordan_lee',
      avatarUrl: null,
      profileColor: null,
    }} /></MemoryRouter>)

    expect(html).toContain('Jordan Lee')
    expect(html).toContain('@jordan_lee')
    expect(html).toContain('href="/jordan_lee"')
    expect(html).toContain('rounded-full')
    expect(html).not.toContain('My profile')
    expect(html).not.toContain('Your handle is')
  })
})

// These page tests do not exercise the authenticated composer lifecycle.
vi.mock('@/lib/local-first/composer-sync', () => ({ clearWebComposerSync: vi.fn() }))
