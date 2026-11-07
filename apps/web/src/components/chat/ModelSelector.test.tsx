// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { Model } from '@/lib/types'
import { useCatalog } from '@/stores/catalog'
import { useModels } from '@/stores/models'
import { DEFAULT_SETTINGS, useSettings } from '@/stores/settings'
import { ModelSelector } from './ModelSelector'

vi.hoisted(() => {
  const data = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) }, configurable: true })
  Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), configurable: true })
})
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
Element.prototype.scrollIntoView = () => {}

const NORTHWIND = '01a1b83f-ae13-77db-a21a-840cba6b44a4'
const ACME = '01a1b83f-ae18-77ff-abf9-8d8bb193a049'
const base = {
  description: '', contextWindow: 32_000, tags: [], iconLight: '#000', iconDark: '#fff', inputPrice: 0, outputPrice: 0,
  perMessagePrice: 0, enabled: true, presets: [], inferenceProvider: 'Local', labLogo: 'pulpo', modelLogo: 'pulpo',
} satisfies Partial<Model>
const model = (id: string, name: string, providerGroupId: string, provider: string): Model => ({ ...base, id, name, providerGroupId, provider })
const models = [
  model('nw-swift', 'Northwind Swift', NORTHWIND, 'Northwind AI'),
  model('nw-deep', 'Northwind Deep', NORTHWIND, 'Northwind AI'),
  model('acme-mini', 'Acme Mini', ACME, 'Acme Labs'),
  model('acme-pro', 'Acme Pro', ACME, 'Acme Labs'),
]

function renderSelector(value = 'nw-swift') {
  const onChange = vi.fn()
  const view = render(<TooltipProvider><ModelSelector value={value} onChange={onChange} /></TooltipProvider>)
  return { onChange, ...view }
}

function open() {
  fireEvent.click(screen.getByRole('button', { name: /^Model: / }))
  const input = screen.getByRole('combobox', { name: 'Search models…' })
  return { input, listbox: screen.getByRole('listbox') }
}

const activeOption = (input: HTMLElement) => document.getElementById(input.getAttribute('aria-activedescendant') ?? '')
const optionNames = () => screen.getAllByRole('option').map((option) => option.getAttribute('aria-label'))

beforeEach(() => {
  useCatalog.setState({ models, codexEnabled: false })
  useSettings.setState({ ...DEFAULT_SETTINGS, defaultModelId: 'nw-swift' })
  useModels.setState({ favoriteModelIds: ['acme-pro', 'nw-deep'], providerOrder: [], favoritesFollowDefaults: false, newAccountFavoritesLoaded: false })
})
afterEach(cleanup)

describe('ModelSelector keyboard and screen reader support', () => {
  it('names the trigger with the visible model name and focuses a combobox that controls the model listbox', () => {
    renderSelector()
    expect(screen.getByRole('button', { name: 'Model: Northwind Swift' }).textContent).toContain('Northwind Swift')
    const { input, listbox } = open()
    expect(document.activeElement).toBe(input)
    expect(input.getAttribute('aria-controls')).toBe(listbox.id)
    expect(input.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('dialog', { name: 'Choose a model' })).toBeTruthy()
    expect(optionNames()).toEqual(['Acme Pro, favorite', 'Northwind Deep, favorite'])
    expect(activeOption(input)?.getAttribute('aria-label')).toBe('Acme Pro, favorite')
  })

  it('selects a model by typing, arrowing and pressing Enter', () => {
    const { onChange } = renderSelector()
    const { input } = open()
    fireEvent.change(input, { target: { value: 'north' } })
    expect(optionNames()).toEqual(['Northwind Swift', 'Northwind Deep, favorite'])
    expect(activeOption(input)?.getAttribute('aria-label')).toBe('Northwind Swift')
    expect(screen.getByRole('status').textContent).toBe('2 models')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(activeOption(input)?.getAttribute('aria-label')).toBe('Northwind Deep, favorite')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(activeOption(input)?.getAttribute('aria-label')).toBe('Northwind Deep, favorite')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('nw-deep')
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('marks the current model as selected and starts the cursor on it', () => {
    renderSelector('acme-mini')
    const { input } = open()
    fireEvent.click(screen.getByRole('tab', { name: 'Acme Labs' }))
    const current = screen.getByRole('option', { name: 'Acme Mini' })
    expect(current.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('option', { name: 'Acme Pro, favorite' }).getAttribute('aria-selected')).toBe('false')
    expect(activeOption(input)).toBe(current)
  })

  it('toggles a favorite with Shift+Enter and announces it', () => {
    renderSelector()
    const { input } = open()
    fireEvent.change(input, { target: { value: 'acme mini' } })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(useModels.getState().favoriteModelIds).toEqual(['acme-pro', 'nw-deep', 'acme-mini'])
    expect(screen.getByRole('status').textContent).toBe('Added Acme Mini to favorites')
    expect(screen.getByRole('option', { name: 'Acme Mini, favorite' })).toBeTruthy()
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(useModels.getState().favoriteModelIds).toEqual(['acme-pro', 'nw-deep'])
  })

  it('keeps the cursor on a neighbouring favorite when the active one is removed', () => {
    renderSelector()
    const { input } = open()
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(optionNames()).toEqual(['Northwind Deep, favorite'])
    expect(activeOption(input)?.getAttribute('aria-label')).toBe('Northwind Deep, favorite')
  })

  it('reorders favorites with Alt+Arrow keys as an alternative to dragging', () => {
    renderSelector()
    const { input } = open()
    expect(input.getAttribute('aria-keyshortcuts')).toContain('Alt+ArrowDown')
    fireEvent.keyDown(input, { key: 'ArrowDown', altKey: true })
    expect(useModels.getState().favoriteModelIds).toEqual(['nw-deep', 'acme-pro'])
    expect(activeOption(input)?.getAttribute('aria-label')).toBe('Acme Pro, favorite')
    expect(screen.getByRole('status').textContent).toBe('Moved Acme Pro to position 2 of 2')
    fireEvent.keyDown(input, { key: 'ArrowUp', altKey: true })
    expect(useModels.getState().favoriteModelIds).toEqual(['acme-pro', 'nw-deep'])
  })

  it('exposes providers as a tablist named by lab, with roving focus and keyboard reordering', () => {
    renderSelector()
    open()
    const tablist = screen.getByRole('tablist', { name: 'Model providers' })
    const tabs = within(tablist).getAllByRole('tab')
    expect(tabs.map((tab) => tab.getAttribute('aria-label'))).toEqual(['Favorites', 'Northwind AI', 'Acme Labs'])
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1])
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')

    act(() => tabs[0].focus())
    fireEvent.keyDown(tabs[0], { key: 'ArrowDown' })
    const northwind = screen.getByRole('tab', { name: 'Northwind AI' })
    expect(document.activeElement).toBe(northwind)
    expect(northwind.getAttribute('aria-selected')).toBe('true')
    expect(northwind.tabIndex).toBe(0)
    expect(screen.getByRole('listbox', { name: 'Northwind AI' })).toBeTruthy()
    expect(optionNames()).toEqual(['Northwind Swift', 'Northwind Deep, favorite'])

    fireEvent.keyDown(northwind, { key: 'ArrowDown', altKey: true })
    expect(within(tablist).getAllByRole('tab').map((tab) => tab.getAttribute('aria-label'))).toEqual(['Favorites', 'Acme Labs', 'Northwind AI'])
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Northwind AI' }))

    fireEvent.keyDown(document.activeElement!, { key: 'Home' })
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Favorites' }))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Northwind AI' }))
  })

  it('does not focus the search field (and open the on-screen keyboard) when opened by touch', () => {
    renderSelector()
    const trigger = screen.getByRole('button', { name: 'Model: Northwind Swift' })
    // jsdom has no PointerEvent; React reads pointerType from a mouse event of the same name.
    const press = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })
    Object.defineProperty(press, 'pointerType', { value: 'touch' })
    fireEvent(trigger, press)
    fireEvent.click(trigger)
    expect(screen.getByRole('combobox')).not.toBe(document.activeElement)
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    renderSelector()
    const { input } = open()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('combobox')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Model: Northwind Swift' })))
  })

  it('moves focus into the reset confirmation and back when it is cancelled', () => {
    useModels.setState({ newAccountFavoritesLoaded: true, newAccountFavoriteModelIds: ['nw-swift'] })
    renderSelector()
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Reset favorites' }))
    const confirmation = screen.getByRole('group', { name: 'Reset favorites' })
    expect(document.activeElement).toBe(within(confirmation).getByRole('button', { name: 'Reset favorites' }))
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Cancel' }))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Reset favorites' }))
  })
})
