// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('react-native', () => ({ useWindowDimensions: () => ({ width: 412 }) }))
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: () => null }))
vi.mock('./materialIcons', () => ({ materialIcon: (name: string) => name }))
vi.mock('@expo/ui/jetpack-compose/modifiers', () => Object.fromEntries(['clickable', 'defaultMinSize', 'fillMaxWidth', 'height', 'padding', 'semantics', 'size', 'verticalScroll', 'weight', 'width'].map(name => [name, () => ({})])))
vi.mock('@expo/ui/jetpack-compose', async () => {
  const { createElement, createContext, useContext } = await import('react')
  const Expanded = createContext(false)
  const Container = ({ children }: { children: ReactNode }) => createElement('div', null, children)
  const Button = ({ children, onClick, enabled = true }: { children: ReactNode; onClick: () => void; enabled?: boolean }) => createElement('button', { onClick, disabled: !enabled }, children)
  const Dropdown = Object.assign(({ children, expanded }: { children: ReactNode; expanded: boolean }) => createElement(Expanded.Provider, { value: expanded }, children), {
    Trigger: Container,
    Items: ({ children }: { children: ReactNode }) => useContext(Expanded) ? createElement('div', { role: 'menu' }, children) : null,
  })
  return {
    Host: Container, Column: Container, Text: ({ children }: { children: ReactNode }) => createElement('span', null, children),
    Icon: ({ contentDescription }: { contentDescription?: string }) => createElement('span', null, contentDescription),
    Spacer: () => null, HorizontalDivider: () => createElement('hr'), TextButton: Button, IconButton: Button,
    DropdownMenu: Dropdown, DropdownMenuItem: Object.assign(Button, { Text: Container, LeadingIcon: Container, TrailingIcon: Container }),
    useMaterialColors: () => ({}),
  }
})
import { MaterialMenu } from './MaterialUI.android'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root, container: HTMLDivElement
beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container) })
afterEach(async () => { await act(async () => root.unmount()); container.remove() })
async function click(label: string) {
  const target = [...container.querySelectorAll('button')].find(button => button.textContent === label)
  expect(target, label).toBeDefined()
  await act(async () => target!.click())
}
describe('native Android menu interactions', () => {
  it('preserves preset sections and dispatches identical choice labels to their own preset', async () => {
    const reasoning = vi.fn(), verbosity = vi.fn()
    await act(async () => root.render(<MaterialMenu label="Options" icon="chevron.down" sections={[
      { id: 'reasoning', title: 'Reasoning', actions: [{ id: 'high', label: 'High', onPress: reasoning }] },
      { id: 'verbosity', title: 'Verbosity', actions: [{ id: 'high', label: 'High', onPress: verbosity }] },
    ]} />))
    await click('Options')
    const menu = container.querySelector('[role=menu]')!
    expect(menu.textContent).toBe('ReasoningHighVerbosityHigh')
    const choices = menu.querySelectorAll('button')
    await act(async () => choices[1]!.click())
    expect(verbosity).toHaveBeenCalledOnce(); expect(reasoning).not.toHaveBeenCalled()
    expect(container.querySelector('[role=menu]')).toBeNull()
  })
  it('keeps the selector open when changing labs and supports returning without selecting a model', async () => {
    const selectLab = vi.fn()
    await act(async () => root.render(<MaterialMenu label="Model" icon="chevron.down" actions={[
      { label: 'Labs', onPress: () => {}, submenu: { title: 'Labs', actions: [{ label: 'OpenAI', keepOpen: true, onPress: selectLab }] } },
    ]} />))
    await click('Model'); await click('Labs'); await click('Back')
    expect(selectLab).not.toHaveBeenCalled()
    await click('Labs'); await click('OpenAI')
    expect(selectLab).toHaveBeenCalledOnce()
    expect(container.querySelector('[role=menu]')).not.toBeNull()
    expect(container.querySelector('[role=menu]')!.textContent).toBe('Labs')
  })
})
