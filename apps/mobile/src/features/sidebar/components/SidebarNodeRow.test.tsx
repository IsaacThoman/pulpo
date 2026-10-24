// @vitest-environment jsdom
import type { FileNode } from '@pulpo/contracts'
import { act, createElement, type ReactNode, useEffect, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'

const screen = vi.hoisted(() => ({ scale: 1, listeners: new Set<() => void>(), mounts: 0 }))
vi.mock('react-native', () => {
  const box = ({ children }: { children?: ReactNode }) => createElement('div', null, children)
  return {
    Platform: { OS: 'ios' }, View: box, Text: box, Pressable: box,
    StyleSheet: { create: (styles: unknown) => styles },
    useWindowDimensions: () => ({ fontScale: useSyncExternalStore((listener) => {
      screen.listeners.add(listener)
      return () => { screen.listeners.delete(listener) }
    }, () => screen.scale) }),
  }
})
vi.mock('../../../theme', () => ({ useAppTheme: () => ({ secondary: '#888', tertiary: '#aaa' }) }))
vi.mock('../../../platform/SymbolView', () => ({ SymbolView: () => null }))
vi.mock('../../files/display', () => ({
  fileIcon: () => ({ symbol: 'folder' }), fileKindLabel: () => 'Folder', fileSubtitle: () => 'Folder',
}))
vi.mock('../../../native/ItemContextMenuView', () => ({
  itemContextMenuAvailable: true,
  ItemContextMenuView: ({ children, onPress, accessibilityLabel, accessibilityState }: {
    children?: ReactNode; onPress: () => void; accessibilityLabel: string; accessibilityState: { expanded: boolean }
  }) => {
    useEffect(() => { screen.mounts += 1 }, [])
    return createElement('button', { onClick: onPress, 'aria-label': accessibilityLabel, 'aria-expanded': accessibilityState.expanded }, children)
  },
}))

import { SidebarNodeRow } from './SidebarNodeRow'

it('remeasures the native row on live text-size changes without losing its folder state or action', () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement('div')
  const root = createRoot(host)
  const onPress = vi.fn()
  const node: FileNode = {
    id: 'work', parentId: null, kind: 'folder', name: 'Work', status: 'ready', mimeType: null,
    sizeBytes: 0, revision: 0, trashedAt: null, createdAt: '', updatedAt: '',
  }
  try {
    act(() => root.render(<SidebarNodeRow node={node} depth={23}
      styles={{ row: {}, active: {}, pressed: {}, title: {}, count: {}, menuHost: {} }}
      actions={[]} folder={{ expanded: true, chatCount: 1 }} onPress={onPress}
      onAction={() => undefined} onLongPress={() => undefined} />))
    expect(screen.mounts).toBe(1)
    for (const scale of [3.1, 1]) {
      act(() => { screen.scale = scale; screen.listeners.forEach((listener) => listener()) })
      const button = host.querySelector('button')!
      expect(button.getAttribute('aria-label')).toBe('Work, folder, 1 chat')
      expect(button.getAttribute('aria-expanded')).toBe('true')
      act(() => button.click())
      expect(onPress).toHaveBeenLastCalledWith(node)
    }
    // Each new text size needs a fresh native measurement, even though memoized row props stay put.
    expect(screen.mounts).toBe(3)
  } finally {
    act(() => root.unmount())
  }
})
