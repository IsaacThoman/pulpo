// @vitest-environment jsdom
import type { FileReference } from '@pulpo/contracts'
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type PickerProps = { limit: number; pickedIds: string[]; onConfirm: (items: Array<{ id: string; name: string; kind: string }>, folder: { id: string | null; name: string }) => void }
const picker = vi.hoisted(() => ({ props: null as PickerProps | null }))
vi.mock('../../../theme', () => ({ useAppTheme: () => ({ text: '#111', secondary: '#666', tertiary: '#999', blue: '#00f', orange: '#f80', fillStrong: '#eee' }) }))
vi.mock('expo-haptics', () => ({ selectionAsync: vi.fn(), notificationAsync: vi.fn(), NotificationFeedbackType: { Success: 'success' } }))
vi.mock('../../../platform/SymbolView', () => ({ SymbolView: ({ name }: { name: string }) => createElement('i', { 'data-symbol': name }) }))
vi.mock('@tanstack/react-query', () => ({ useQueries: ({ queries }: { queries: unknown[] }) => queries.map(() => ({ data: undefined, isError: false })) }))
vi.mock('../queries', () => ({ fileNodeQuery: (namespace: string, id: string) => ({ queryKey: [namespace, id] }) }))
vi.mock('./FolderPickerSheet', () => ({ FolderPickerSheet: (props: PickerProps) => { picker.props = props; return null } }))
vi.mock('react-native', () => {
  const container = ({ children }: { children?: ReactNode }) => createElement('div', null, children)
  return {
    Platform: { OS: 'ios' },
    ScrollView: container, View: container, Text: container,
    StyleSheet: { create: (value: unknown) => value },
    Pressable: ({ children, onPress, accessibilityLabel }: { children: ReactNode; onPress: () => void; accessibilityLabel?: string }) => (
      createElement('button', { onClick: onPress, 'aria-label': accessibilityLabel }, children)
    ),
  }
})

const { FileReferenceBar } = await import('./FileReferenceBar')
const { useFileReferencePicker } = await import('../scopePicker')

const plan: FileReference = { id: 'plan-id', name: 'Plan.md', folder: false }
const onAdd = vi.fn()
const onRemove = vi.fn()
const onOpen = vi.fn()
const onTurnOnAgent = vi.fn()
let root: Root
let host: HTMLDivElement
beforeEach(() => {
  vi.clearAllMocks()
  picker.props = null
  useFileReferencePicker.getState().hide()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const render = (references: FileReference[], options: { available?: boolean; agentActive?: boolean } = {}) => act(() => root.render(
  <FileReferenceBar
    namespace="account" references={references} available={options.available ?? true} agentActive={options.agentActive ?? false} canUseAgent
    onTurnOnAgent={onTurnOnAgent} onAdd={onAdd} onRemove={onRemove} onOpen={onOpen}
  />,
))
const click = (label: string) => act(() => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click())

describe('FileReferenceBar', () => {
  it('shows each reference as a chip that opens its item or leaves the message', () => {
    render([plan], { agentActive: true })
    expect(host.textContent).toContain('Plan.md')
    click('Open Plan.md')
    expect(onOpen).toHaveBeenCalledWith(plan)
    click('Remove Plan.md')
    expect(onRemove).toHaveBeenCalledWith('plan-id')
  })

  it('asks for agent mode while it is off', () => {
    render([plan])
    expect(host.textContent).toContain('Turn on agent mode so the agent can use these files.')
  })

  it('shows nothing where Files can’t be used', () => {
    render([plan], { available: false })
    expect(host.textContent).toBe('')
  })

  it('adds picked items, or the open folder, and turns agent mode on', () => {
    render([plan])
    act(() => useFileReferencePicker.getState().show())
    expect(picker.props).toMatchObject({ limit: 50, pickedIds: ['plan-id'] })
    act(() => picker.props!.onConfirm([{ id: 'doc', name: 'Notes', kind: 'doc' }, { id: 'dir', name: 'Projects', kind: 'folder' }], { id: null, name: 'My files' }))
    expect(onAdd).toHaveBeenLastCalledWith([{ id: 'doc', name: 'Notes', folder: false }, { id: 'dir', name: 'Projects', folder: true }])
    expect(onTurnOnAgent).toHaveBeenCalledTimes(1)
    expect(useFileReferencePicker.getState().open).toBe(false)

    act(() => useFileReferencePicker.getState().show())
    act(() => picker.props!.onConfirm([], { id: 'dir', name: 'Projects' }))
    expect(onAdd).toHaveBeenLastCalledWith([{ id: 'dir', name: 'Projects', folder: true }])
  })

  it('does not offer all of My files', () => {
    render([])
    act(() => useFileReferencePicker.getState().show())
    act(() => picker.props!.onConfirm([], { id: null, name: 'My files' }))
    expect(onAdd).not.toHaveBeenCalled()
  })
})
