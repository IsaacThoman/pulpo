// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { AgentMenu } from './AgentMenu'

afterEach(cleanup)

it.each([true, false])('opens without changing mode and explicitly selects the other option (enabled: %s)', async (initial) => {
  const onSelect = vi.fn()
  function ComposerControl() {
    const [enabled, setEnabled] = useState(initial)
    return <AgentMenu enabled={enabled} disabled={false} onSelect={(next) => { setEnabled(next); onSelect(next) }} />
  }
  render(<ComposerControl />)
  const trigger = screen.getByRole('button', { name: `Agent options, ${initial ? 'Pulpo Agent' : 'Disabled'}` })
  expect(trigger.querySelector(initial ? '.lucide-bot' : '.lucide-bot-off')).not.toBeNull()
  fireEvent.keyDown(trigger, { key: 'Enter' })
  const selected = await screen.findByRole('menuitemradio', { name: initial ? 'Pulpo Agent' : 'Disabled', checked: true })
  expect(selected.querySelector('.lucide-check')).not.toBeNull()
  expect(onSelect).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('menuitemradio', { name: initial ? 'Disabled' : 'Pulpo Agent', checked: false }))
  expect(onSelect).toHaveBeenCalledExactlyOnceWith(!initial)
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  expect(screen.getByRole('button', { name: `Agent options, ${initial ? 'Disabled' : 'Pulpo Agent'}` }).querySelector(initial ? '.lucide-bot-off' : '.lucide-bot')).not.toBeNull()
})

it('closes when reselecting the current option without changing mode', async () => {
  const onSelect = vi.fn()
  render(<AgentMenu enabled disabled={false} onSelect={onSelect} />)
  fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' })
  fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Pulpo Agent' }))
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  expect(onSelect).not.toHaveBeenCalled()
})

it('supports keyboard navigation and Escape without changing mode', async () => {
  const onSelect = vi.fn()
  render(<AgentMenu enabled disabled={false} onSelect={onSelect} />)
  const trigger = screen.getByRole('button')
  fireEvent.keyDown(trigger, { key: 'ArrowDown' })
  const first = await screen.findByRole('menuitemradio', { name: 'Pulpo Agent' })
  await waitFor(() => expect(document.activeElement).toBe(first))
  fireEvent.keyDown(first, { key: 'ArrowDown' })
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Disabled' })))
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  expect(onSelect).not.toHaveBeenCalled()
  await waitFor(() => expect(document.activeElement).toBe(trigger))
})

it('shows Disabled and cannot open when agent mode is unavailable', () => {
  const onSelect = vi.fn()
  render(<AgentMenu enabled disabled onSelect={onSelect} />)
  const trigger = screen.getByRole('button', { name: 'Agent options, Disabled' }) as HTMLButtonElement
  expect(trigger.disabled).toBe(true)
  fireEvent.click(trigger)
  expect(screen.queryByRole('menu')).toBeNull()
  expect(onSelect).not.toHaveBeenCalled()
})

it.each(['mouse', 'touch'])('restores focus without a ring after a %s selection, then allows keyboard focus', async (pointerType) => {
  render(<AgentMenu enabled disabled={false} onSelect={vi.fn()} />)
  const trigger = screen.getByRole('button')
  // Switch input methods while the menu is open.
  fireEvent.keyDown(trigger, { key: 'Enter' })
  const choice = await screen.findByRole('menuitemradio', { name: 'Disabled' })
  fireEvent.pointerDown(choice, { pointerType })
  fireEvent.click(choice)
  await waitFor(() => expect(document.activeElement).toBe(trigger))
  expect(trigger.dataset.pointerFocus).toBe('true')

  fireEvent.keyDown(trigger, { key: 'Enter' })
  const first = await screen.findByRole('menuitemradio', { name: 'Pulpo Agent' })
  fireEvent.keyDown(first, { key: 'Escape' })
  await waitFor(() => expect(document.activeElement).toBe(trigger))
  expect(trigger.dataset.pointerFocus).toBeUndefined()
})

it('clears pointer focus suppression when leaving the trigger', async () => {
  render(<AgentMenu enabled disabled={false} onSelect={vi.fn()} />)
  const trigger = screen.getByRole('button')
  fireEvent.keyDown(trigger, { key: 'Enter' })
  const choice = await screen.findByRole('menuitemradio', { name: 'Disabled' })
  fireEvent.pointerDown(choice)
  fireEvent.click(choice)
  await waitFor(() => expect(document.activeElement).toBe(trigger))
  expect(trigger.dataset.pointerFocus).toBe('true')
  fireEvent.blur(trigger)
  expect(trigger.dataset.pointerFocus).toBeUndefined()
})
