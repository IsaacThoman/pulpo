import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { automaticProfileColor, PROFILE_COLORS, profileInitials } from '@/lib/profile'
import { configureDesktopRuntime } from '@/lib/runtime'
import { ProfileAvatar } from './ProfileAvatar'

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window')
  Reflect.deleteProperty(globalThis, 'localStorage')
})

describe('profile presentation', () => {
  it('uses stable automatic colors and display-name initials', () => {
    expect(automaticProfileColor('same-user')).toBe(automaticProfileColor('same-user'))
    expect(automaticProfileColor('same-user')).toMatch(/^#[0-9a-f]{6}$/)
    expect(PROFILE_COLORS).toContain(automaticProfileColor('same-user'))
    expect(profileInitials('Isaac Thoman')).toBe('IT')
    expect(profileInitials('')).toBe('?')
  })

  it('keeps the fallback visible while a desktop avatar is fetched securely', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
    })
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { pulpoDesktop: { platform: 'desktop' }, location: { origin: 'https://desktop.pulpo.invalid' } },
    })
    configureDesktopRuntime({ instanceUrl: 'https://one.example', token: 's'.repeat(43) })

    const markup = renderToStaticMarkup(createElement(ProfileAvatar, {
      name: 'Isaac Thoman',
      avatarUrl: '/api/users/user/avatar?v=2',
    }))

    expect(markup).toContain('IT')
    expect(markup).not.toContain('/api/users/user/avatar')
  })
})
