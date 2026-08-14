import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
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
