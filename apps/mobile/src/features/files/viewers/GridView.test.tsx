// @vitest-environment jsdom
import { act, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { indexDelimited } from '@pulpo/client-core/office/delimited'

const native = vi.hoisted(() => ({ scroll: vi.fn(), row: vi.fn(), layout: (_event: unknown) => {}, list: {} as { getItemLayout?: (data: unknown, index: number) => { offset: number } } }))
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }))
vi.mock('../../../theme', () => ({ useAppTheme: () => ({}) }))
vi.mock('react-native', async () => {
  const { createElement, useImperativeHandle } = await import('react')
  return {
    Alert: { alert: vi.fn() },
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    View: () => null, Text: () => null, Pressable: () => null,
    ScrollView: ({ ref, children, onLayout }: any) => {
      useImperativeHandle(ref, () => ({ scrollTo: native.scroll }))
      native.layout = onLayout
      return createElement('div', null, children)
    },
    FlatList: ({ ref, ...props }: any) => {
      useImperativeHandle(ref, () => ({ scrollToIndex: native.row }))
      native.list = props
      return null
    },
  }
})
import { GridView, type GridViewHandle } from './GridView'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const container = document.createElement('div')
let root = createRoot(container)
afterEach(async () => { await act(async () => root.unmount()); root = createRoot(container); vi.clearAllMocks() })

it('reveals an off-screen matching column and scrolls back to a header match', async () => {
  const table = indexDelimited('first,second,third,fourth,fifth,sixth\nleft,2,3,4,5,needle')
  const ref = createRef<GridViewHandle>()
  await act(async () => root.render(<GridView ref={ref} table={table} matchRows={new Set([1])} currentRow={1} query="needle" bottomInset={0} />))
  native.layout({ nativeEvent: { layout: { width: 200 } } })
  ref.current!.scrollToRow(1)
  expect(native.row).toHaveBeenLastCalledWith(expect.objectContaining({ index: 0 }))
  expect(native.scroll).toHaveBeenLastCalledWith({ x: expect.any(Number), animated: true })
  expect(native.scroll.mock.lastCall![0].x).toBeGreaterThan(150)
  await act(async () => root.render(<GridView ref={ref} table={table} matchRows={new Set([0])} currentRow={0} query="first" bottomInset={0} />))
  ref.current!.scrollToRow(0)
  expect(native.scroll).toHaveBeenLastCalledWith({ x: 0, animated: true })
})

it('includes the sticky header height in row positions', async () => {
  const table = indexDelimited('a,b\n1,2\n3,4')
  await act(async () => root.render(<GridView table={table} matchRows={new Set()} query="" currentRow={undefined} bottomInset={0} />))
  expect(native.list.getItemLayout!(null, 0).offset).toBe(60)
  expect(native.list.getItemLayout!(null, 1).offset).toBe(94)
})
