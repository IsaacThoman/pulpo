import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { FriendsProfileSummary } from './FriendsPage'

describe('FriendsProfileSummary', () => {
  const user = {
    name: 'Preview Admin',
    username: 'preview_admin',
    avatarUrl: null,
  }

  it('shows the signed-in profile without account settings metadata', () => {
    const html = renderToStaticMarkup(<FriendsProfileSummary user={user} onEdit={vi.fn()} />)

    expect(html).toContain('Preview Admin')
    expect(html).toContain('@preview_admin')
    expect(html).toContain('Edit profile')
    expect(html).not.toContain('Friends chart color')
  })
})
