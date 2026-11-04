// @vitest-environment jsdom
import type { FileNode } from '@pulpo/contracts'
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../theme', () => ({ useAppTheme: () => ({ text: '#111', background: '#fff', elevated: '#fff', elevated2: '#eee', separator: '#ddd', secondary: '#666', blue: '#00f', fillStrong: '#eee', isDark: false }) }))
vi.mock('../../../api/client', () => ({ ApiError: class extends Error {}, isNetworkError: () => false }))
vi.mock('expo-haptics', () => ({ selectionAsync: vi.fn() }))
vi.mock('../../../platform/SymbolView', () => ({ SymbolView: ({ name }: { name: string }) => createElement('i', { 'data-symbol': name }) }))
vi.mock('../../../platform/MaterialUI', () => ({ MaterialDialog: () => null }))
vi.mock('react-native', () => {
  const container = ({ children }: { children?: ReactNode }) => createElement('div', null, children)
  return {
    Platform: { OS: 'ios' },
    Modal: container, ScrollView: container, View: container, Text: container,
    StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
    Pressable: ({ children, onPress, accessibilityLabel, accessibilityState }: { children: ReactNode; onPress: () => void; accessibilityLabel?: string; accessibilityState?: { selected?: boolean } }) => (
      createElement('button', { onClick: onPress, 'aria-label': accessibilityLabel, 'aria-pressed': accessibilityState?.selected }, children)
    ),
  }
})
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: { children: ReactNode }) => createElement('div', null, children) }))

const { FileAppearanceSheet } = await import('./FileAppearanceSheet')
const { trashFolderNode } = await import('../../trash/folder')

const folder: FileNode = {
  id: 'f1', parentId: null, kind: 'folder', name: 'Projects', status: 'ready', mimeType: null, sizeBytes: 0, revision: 0,
  trashedAt: null, createdAt: '', updatedAt: '', systemRole: null, color: 'blue', icon: null,
}

let root: Root
let host: HTMLDivElement
const onChange = vi.fn()
const onClose = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const render = (nodes: FileNode[]) => act(() => root.render(<FileAppearanceSheet nodes={nodes} onChange={onChange} onClose={onClose} />))
const buttons = (label: string) => [...host.querySelectorAll<HTMLButtonElement>(`button[aria-label="${label}"]`)]
const click = (label: string, index = 0) => {
  const button = buttons(label)[index]
  expect(button).toBeDefined()
  act(() => button!.click())
}
const pressed = () => [...host.querySelectorAll('button[aria-pressed="true"]')].map((button) => button.getAttribute('aria-label'))

describe('FileAppearanceSheet', () => {
  it('applies each color and icon as it is chosen, as the web dialog does', () => {
    render([folder])
    expect(host.textContent).toContain('Choose a color and icon.')
    // Blue, and the default icon.
    expect(pressed()).toEqual(['Blue', 'Default'])

    click('Teal')
    expect(onChange).toHaveBeenLastCalledWith({ color: 'teal' })
    expect(pressed()).toEqual(['Teal', 'Default'])
    // Icons show in the chosen color's swatch, the default keeps the folder's own glyph.
    expect(host.querySelector('[data-symbol="folder.fill"]')).not.toBeNull()

    click('Rocket')
    expect(onChange).toHaveBeenLastCalledWith({ icon: 'rocket' })
    click('Default', 0)
    expect(onChange).toHaveBeenLastCalledWith({ color: null })

    const done = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Done')
    act(() => done!.click())
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('changes several items at once, starting from what they share', () => {
    render([{ ...folder, icon: 'star' }, { ...folder, id: 'd1', kind: 'doc', name: 'Notes.md', color: 'red', icon: 'star' }])
    expect(host.textContent).toContain('2 items')
    // The colors differ, so none is chosen; the icon is shared.
    expect(pressed()).toEqual(['Star'])
  })

  it('offers only a color for built-in folders', () => {
    render([trashFolderNode('red'), { ...folder, systemRole: 'archive' }])
    expect(host.textContent).toContain('Choose a color.')
    expect(buttons('Rocket')).toEqual([])
    expect(buttons('Default')).toHaveLength(1)
    click('Purple')
    expect(onChange).toHaveBeenLastCalledWith({ color: 'purple' })
  })
})
