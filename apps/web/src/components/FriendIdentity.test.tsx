// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { FriendProfile } from '@pulpo/contracts'
import { MemoryRouter, useLocation, type InitialEntry } from 'react-router-dom'
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

let location: ReturnType<typeof useLocation>
function LocationProbe() {
  location = useLocation()
  return null
}

async function expectProfileCard(trigger: HTMLElement, displayName: string, username: string, interaction: 'focus' | 'hover') {
  if (interaction === 'focus') fireEvent.focus(trigger)
  else fireEvent.pointerMove(trigger, { pointerType: 'mouse' })
  const card = await screen.findByRole('tooltip', {}, { timeout: 1_500 })
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

  it('bounds the avatar stack while counting and labeling every mutual friend', () => {
    const friends = ['Ada', 'Ben', 'Cy', 'Dee', 'Eve'].map(profile)
    render(<MemoryRouter><MutualFriends friends={friends} /></MemoryRouter>)
    const group = screen.getByRole('group', { name: 'Mutual friends: Ada, Ben, Cy, Dee, Eve' })
    expect(within(group).getAllByRole('link')).toHaveLength(3)
    expect(within(group).getByText('5 mutuals')).toBeTruthy()
  })
})

describe('profile links', () => {
  const mount = (entry: InitialEntry) => render(<MemoryRouter initialEntries={[entry]}>
    <ProfileIdentity profile={profile('Avery Chen')} href="/avery_chen" />
    <MutualFriends friends={[profile('Maya Ortiz')]} />
    <LocationProbe />
  </MemoryRouter>)

  it('carry the People tab they were opened from, for the breadcrumb back', async () => {
    mount('/friends')
    fireEvent.click(screen.getByRole('link', { name: 'Avery Chen' }))
    expect(location.pathname).toBe('/avery_chen')
    expect(location.state).toEqual({ peopleOrigin: '/friends' })

    cleanup()
    mount('/friends')
    fireEvent.click(screen.getByRole('link', { name: 'Maya Ortiz' }))
    expect(location.pathname).toBe('/maya_ortiz')
    expect(location.state).toEqual({ peopleOrigin: '/friends' })

    cleanup()
    mount('/friends/leaderboard?scope=pool')
    fireEvent.focus(screen.getByRole('link', { name: 'Avery Chen' }))
    fireEvent.click(within(await screen.findByRole('tooltip', {}, { timeout: 1_500 })).getByRole('link', { name: 'Avery Chen' }))
    expect(location.pathname).toBe('/avery_chen')
    expect(location.state).toEqual({ peopleOrigin: '/friends/leaderboard?scope=pool' })
  })

  it("pass a profile's origin on to the profiles it links, and add none elsewhere", () => {
    mount({ pathname: '/jordan', state: { peopleOrigin: '/friends/leaderboard' } })
    fireEvent.click(screen.getByRole('link', { name: 'Maya Ortiz' }))
    expect(location.state).toEqual({ peopleOrigin: '/friends/leaderboard' })

    cleanup()
    mount('/c/chat-1')
    fireEvent.click(screen.getByRole('link', { name: 'Avery Chen' }))
    expect(location.pathname).toBe('/avery_chen')
    expect(location.state).toBeNull()
  })
})
