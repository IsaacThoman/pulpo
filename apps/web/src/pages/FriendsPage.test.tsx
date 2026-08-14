import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { automaticProfileColor } from '@/lib/profile'
import { FriendsProfileSummary } from './FriendsPage'

describe('FriendsProfileSummary', () => {
  const user = {
    id: 'profile-summary-user',
    name: 'Preview Admin',
    username: 'preview_admin',
    avatarUrl: null,
    profileColor: '#ec4899',
  }

  it('shows the signed-in profile and selected friends chart color', () => {
    const html = renderToStaticMarkup(<FriendsProfileSummary user={user} onEdit={vi.fn()} />)

    expect(html).toContain('Your profile')
    expect(html).toContain('Preview Admin')
    expect(html).toContain('@preview_admin')
    expect(html).toContain('Friends chart color')
    expect(html).toContain('background-color:#ec4899')
    expect(html).toContain('Edit profile')
  })

  it('uses the effective automatic chart color when no custom color is saved', () => {
    const html = renderToStaticMarkup(
      <FriendsProfileSummary user={{ ...user, profileColor: null }} onEdit={vi.fn()} />,
    )

    expect(html).toContain(`background-color:${automaticProfileColor(user.id)}`)
  })
})
