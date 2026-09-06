// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ image: {} as Record<string, unknown>, user: { id: 'user-1', name: 'Isaac Thoman', avatarUrl: '/api/users/user-1/avatar?v=1' as string | null } }))
vi.mock('expo-image', () => ({ Image: (props: Record<string, unknown>) => { mocks.image = props; return createElement('img', { 'data-testid': 'avatar-image' }) } }))
vi.mock('react-native', () => ({
  StyleSheet: { create: (styles: unknown) => styles, absoluteFill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } },
  Text: ({ children }: { children: React.ReactNode }) => createElement('span', null, children),
  View: ({ children, style }: { children: React.ReactNode; style: object[] }) => createElement('div', { style: Object.assign({}, ...style) }, children),
}))
vi.mock('../../../api/client', () => ({ nativeAuthorizationHeaders: () => ({ Authorization: 'Bearer test-token' }) }))
vi.mock('../../../store/session', () => ({ useSessionStore: (select: (state: unknown) => unknown) => select({ user: mocks.user, instanceUrl: 'https://example.test' }) }))
vi.mock('../theme', () => ({ useAppTheme: () => ({ isDark: false }) }))
import { ProfileAvatar } from './ProfileAvatar'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  mocks.user.avatarUrl = '/api/users/user-1/avatar?v=1'
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })

describe('mobile profile avatar', () => {
  it('plays authenticated animations and removes the initials and background on load', async () => {
    await act(async () => root.render(<ProfileAvatar size={48} />))
    expect(container.textContent).toBe('IT')
    expect(mocks.image.source).toEqual({ uri: 'https://example.test/api/users/user-1/avatar?v=1', headers: { Authorization: 'Bearer test-token' } })
    expect(mocks.image).toMatchObject({ autoplay: true, contentFit: 'contain', useAppleWebpCodec: false })
    await act(async () => (mocks.image.onLoad as () => void)())
    expect(container.textContent).toBe('')
    expect(container.querySelector('div')?.style.borderRadius).toBe('')
    expect(container.querySelector('div')?.style.backgroundColor).toBe('')
    expect(container.querySelector('img')).not.toBeNull()
    await act(async () => (mocks.image.onError as () => void)())
    expect(container.textContent).toBe('IT')
    expect(container.querySelector('img')).toBeNull()
  })

  it('resets the fallback when an avatar is replaced or removed', async () => {
    await act(async () => root.render(<ProfileAvatar size={48} />))
    await act(async () => (mocks.image.onLoad as () => void)())
    mocks.user.avatarUrl = '/api/users/user-1/avatar?v=2'
    await act(async () => root.render(<ProfileAvatar size={48} />))
    expect(container.textContent).toBe('IT')
    await act(async () => (mocks.image.onLoad as () => void)())
    mocks.user.avatarUrl = null
    await act(async () => root.render(<ProfileAvatar size={48} />))
    expect(container.textContent).toBe('IT')
    expect(container.querySelector('img')).toBeNull()
  })
})
