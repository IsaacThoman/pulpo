// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  // The menu stays open and shows the choice taking.
  expect(await screen.findByRole('menuitemradio', { name: initial ? 'Disabled' : 'Pulpo Agent', checked: true })).not.toBeNull()
  expect(screen.getByRole('button', { name: `Agent options, ${initial ? 'Disabled' : 'Pulpo Agent'}`, hidden: true }).querySelector(initial ? '.lucide-bot-off' : '.lucide-bot')).not.toBeNull()
})

it('stays open after a choice until the user clicks away', async () => {
  const onSelect = vi.fn()
  render(<AgentMenu enabled disabled={false} onSelect={onSelect} />)
  fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' })
  // Choosing what is already chosen changes nothing, and closes nothing either.
  fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Pulpo Agent' }))
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Disabled' }))
  expect(onSelect).toHaveBeenCalledExactlyOnceWith(false)
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(screen.getByRole('menu')).not.toBeNull()
  fireEvent.pointerDown(document.body)
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
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

it.each(['mouse', 'touch'])('restores focus without a ring after a %s selection and click away, then allows keyboard focus', async (pointerType) => {
  render(<AgentMenu enabled disabled={false} onSelect={vi.fn()} />)
  const trigger = screen.getByRole('button')
  // Switch input methods while the menu is open.
  fireEvent.keyDown(trigger, { key: 'Enter' })
  const choice = await screen.findByRole('menuitemradio', { name: 'Disabled' })
  fireEvent.pointerDown(choice, { pointerType })
  fireEvent.click(choice)
  fireEvent.pointerDown(document.body, { pointerType })
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
  fireEvent.pointerDown(document.body)
  await waitFor(() => expect(document.activeElement).toBe(trigger))
  expect(trigger.dataset.pointerFocus).toBe('true')
  fireEvent.blur(trigger)
  expect(trigger.dataset.pointerFocus).toBeUndefined()
})

it('keeps Files behind the Access section, where the agent’s reach and what it may change are chosen', async () => {
  const onModeChange = vi.fn()
  const onOpenAccess = vi.fn()
  function Control() {
    const [mode, setMode] = useState<'read' | 'suggest' | 'write'>('suggest')
    return <AgentMenu enabled disabled={false} onSelect={vi.fn()} files={{ mode, onModeChange: (next) => { setMode(next); onModeChange(next) }, onOpenAccess }} />
  }
  render(<Control />)
  fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' })
  // The menu itself holds only the agent choice and one row for Files.
  expect((await screen.findAllByRole('menuitemradio')).map((option) => option.textContent)).toEqual(['Pulpo Agent', 'Disabled'])
  const access = screen.getByRole('group', { name: 'Access' })
  const row = within(access).getByRole('menuitem')
  expect(row.textContent).toBe('Pulpo FilesItems you mention · Suggest changes')

  fireEvent.keyDown(row, { key: 'ArrowRight' })
  const modes = await screen.findByRole('group', { name: 'Changes to Files' })
  expect(within(modes).getAllByRole('menuitemradio').map((option) => option.textContent)).toEqual([
    'Read only',
    'Suggest changes',
    'Edit directly',
  ])
  fireEvent.click(within(modes).getByRole('menuitemradio', { name: /Edit directly/ }))
  expect(onModeChange).toHaveBeenCalledExactlyOnceWith('write')
  // Still open, with the new choice checked and the row saying so.
  expect(within(modes).getByRole('menuitemradio', { name: /Edit directly/ }).getAttribute('aria-checked')).toBe('true')
  expect(row.textContent).toBe('Pulpo FilesItems you mention · Edit directly')

  // Files access opens a dialog, so that one does close the menu.
  fireEvent.click(screen.getByRole('menuitem', { name: 'Files access…' }))
  expect(onOpenAccess).toHaveBeenCalledOnce()
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
})
