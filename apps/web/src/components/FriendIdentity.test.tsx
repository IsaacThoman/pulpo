// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { FriendProfile } from '@pulpo/contracts'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MutualFriends, ProfileIdentity } from './FriendIdentity'

vi.mock('@/lib/runtime-resource', () => ({ useRuntimeImageUrl: () => ({ url: null }) }))
vi.stubGlobal('ResizeObserver', class {
  observe() {}
  unobserve() {}
  disconnect() {}
})

const profile = (displayName: string): FriendProfile => ({
  id: displayName,
  displayName,
  username: displayName.toLowerCase().replaceAll(' ', '_'),
  avatarUrl: null,
  profileColor: null,
})

afterEach(cleanup)

async function expectProfileCard(trigger: HTMLElement, displayName: string, username: string, interaction: 'focus' | 'hover') {
  if (interaction === 'focus') fireEvent.focus(trigger)
  else fireEvent.pointerMove(trigger, { pointerType: 'mouse' })
  const card = await screen.findByRole('tooltip')
  expect(within(card).queryByText('Profile')).toBeNull()
  expect(card.querySelector('[data-slot="tooltip-arrow"]')).toBeNull()
  expect(within(card).getByText(displayName)).toBeTruthy()
  expect(within(card).getByText(`@${username}`)).toBeTruthy()
  expect(within(card).getByRole('link', { name: displayName }).getAttribute('href')).toBe(`/${username}`)
  if (interaction === 'focus') fireEvent.blur(trigger)
}

describe('friend profile hover cards', () => {
  it('shows a mini profile card for a full person entry', async () => {
    render(<MemoryRouter><ProfileIdentity profile={profile('Avery Chen')} href="/avery_chen" /></MemoryRouter>)
    await expectProfileCard(screen.getByRole('link', { name: 'Avery Chen' }), 'Avery Chen', 'avery_chen', 'hover')
  })

  it('shows a mini profile card for each mutual avatar', async () => {
    render(<MemoryRouter><MutualFriends friends={[profile('Maya Ortiz')]} /></MemoryRouter>)
    await expectProfileCard(screen.getByRole('link', { name: 'Maya Ortiz' }), 'Maya Ortiz', 'maya_ortiz', 'focus')
  })
})
