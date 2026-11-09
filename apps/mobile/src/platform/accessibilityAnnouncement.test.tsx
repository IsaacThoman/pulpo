// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  os: 'ios',
  announceForAccessibility: vi.fn(),
  announceForAccessibilityWithOptions: vi.fn(),
}))
vi.mock('react-native', () => ({
  Platform: { get OS() { return native.os } },
  AccessibilityInfo: {
    announceForAccessibility: native.announceForAccessibility,
    announceForAccessibilityWithOptions: native.announceForAccessibilityWithOptions,
  },
}))

import { announce, useAccessibilityAnnouncement } from './accessibilityAnnouncement'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root
function Announcer({ message }: { message?: string | null | false }) {
  useAccessibilityAnnouncement(message)
  return null
}
const render = (message?: string | null | false) => act(async () => root.render(<Announcer message={message} />))
const spoken = () => native.announceForAccessibilityWithOptions.mock.calls.map(([message]) => message)

beforeEach(() => {
  native.os = 'ios'
  native.announceForAccessibility.mockClear()
  native.announceForAccessibilityWithOptions.mockClear()
  root = createRoot(document.createElement('div'))
})
afterEach(async () => { await act(async () => root.unmount()) })

it('queues announcements on iOS so they follow the activated control', () => {
  announce('Upload failed')
  expect(native.announceForAccessibilityWithOptions).toHaveBeenCalledWith('Upload failed', { queue: true })
  expect(native.announceForAccessibility).not.toHaveBeenCalled()
})

it('uses the plain announcement elsewhere and ignores empty text', () => {
  native.os = 'android'
  announce('')
  announce('Offline')
  expect(native.announceForAccessibility.mock.calls).toEqual([['Offline']])
})

it('announces a message once when it appears or changes', async () => {
  await render(null)
  expect(spoken()).toEqual([])
  await render('Wrong password')
  await render('Wrong password')
  await render('Account locked')
  expect(spoken()).toEqual(['Wrong password', 'Account locked'])
})

it('announces the same message again after it was cleared', async () => {
  await render('Offline')
  await render(false)
  await render('')
  await render('Offline')
  expect(spoken()).toEqual(['Offline', 'Offline'])
})
