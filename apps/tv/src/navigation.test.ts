import { beforeEach, expect, it, vi } from 'vitest'
import { canGoBack, useNavigation } from './navigation'

beforeEach(() => useNavigation.getState().reset())

it('pops overlays before screens and stops at home', () => {
  const nav = useNavigation.getState()
  nav.push({ name: 'chat', chatId: 'a' })
  nav.present({ name: 'actions', actions: [{ key: 'x', label: 'X', icon: 'trash', run: vi.fn() }] })
  expect(canGoBack(useNavigation.getState())).toBe(true)
  expect(nav.pop()).toBe(true)
  expect(useNavigation.getState().overlay).toBeNull()
  expect(useNavigation.getState().stack.at(-1)).toEqual({ name: 'chat', chatId: 'a' })
  expect(nav.pop()).toBe(true)
  expect(canGoBack(useNavigation.getState())).toBe(false)
  expect(nav.pop()).toBe(false)
  expect(useNavigation.getState().stack).toEqual([{ name: 'home' }])
})

it('replaces the top route', () => {
  const nav = useNavigation.getState()
  nav.push({ name: 'library' })
  nav.replace({ name: 'chat', chatId: 'b' })
  expect(useNavigation.getState().stack).toEqual([{ name: 'home' }, { name: 'chat', chatId: 'b' }])
})
