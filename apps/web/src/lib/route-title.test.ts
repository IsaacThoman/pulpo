import { describe, expect, it } from 'vitest'
import { routeTitle } from './route-title'

describe('routeTitle', () => {
  it.each([
    ['/c/123', 'Chat – Pulpo'],
    ['/files', 'Files – Pulpo'],
    ['/files/f/abc', 'Files – Pulpo'],
    ['/files/trash', 'Trash – Files – Pulpo'],
    ['/usage', 'Usage – Pulpo'],
    ['/friends', 'Friends – Pulpo'],
    ['/friends/leaderboard', 'Leaderboard – Friends – Pulpo'],
    ['/api-keys', 'API keys – Pulpo'],
    ['/admin/users', 'Users – Admin panel – Pulpo'],
    ['/admin/chats/abc', 'Chat – Admin panel – Pulpo'],
    ['/admin/usage', 'Leaderboard – Usage – Admin panel – Pulpo'],
    ['/admin/usage/requests', 'Requests – Usage – Admin panel – Pulpo'],
    ['/login', 'Sign in – Pulpo'],
    ['/signup', 'Sign up – Pulpo'],
    ['/forgot-password', 'Forgot password – Pulpo'],
    ['/share/token', 'Shared chat – Pulpo'],
  ])('names %s "%s"', (path, title) => {
    expect(routeTitle(path)).toBe(title)
  })

  it('leaves the new chat page and unknown routes to the default title', () => {
    expect(routeTitle('/')).toBeNull()
    expect(routeTitle('/nowhere')).toBeNull()
  })
})
