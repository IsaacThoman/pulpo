import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { FriendsHandle, MyProfileHeader } from './FriendsPage'

describe('FriendsHandle', () => {
  it('shows the signed-in handle as a copy control', () => {
    const html = renderToStaticMarkup(<FriendsHandle username="preview_admin" />)

    expect(html).toContain('Your handle is')
    expect(html).toContain('@preview_admin')
    expect(html).toContain('Copy @preview_admin')
    expect(html).not.toContain('Edit profile')
  })
})

describe('MyProfileHeader', () => {
  const profile = { id: 'user-1', displayName: 'Preview Admin', username: 'preview_admin', avatarUrl: null, profileColor: null }

  it('shows the viewer as friends see them, linked to their profile', () => {
    const html = renderToStaticMarkup(<MemoryRouter><MyProfileHeader profile={profile} friendCount={4} /></MemoryRouter>)

    expect(html).toContain('Preview Admin')
    expect(html).toContain('Copy @preview_admin')
    expect(html).toContain('4 friends')
    expect(html).toContain('href="/preview_admin"')
    expect(html).toContain('View profile')
  })

  it('waits for the friends list before counting friends', () => {
    expect(renderToStaticMarkup(<MemoryRouter><MyProfileHeader profile={profile} friendCount={1} /></MemoryRouter>)).toContain('1 friend<')
    expect(renderToStaticMarkup(<MemoryRouter><MyProfileHeader profile={profile} /></MemoryRouter>)).not.toContain('friends<')
  })
})

// These page tests do not exercise the authenticated composer lifecycle.
vi.mock('@/lib/local-first/composer-sync', () => ({ clearWebComposerSync: vi.fn() }))
