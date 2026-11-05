// @vitest-environment jsdom
import { act, createRef, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { splitHighlightedLines } from '@pulpo/client-core/highlight'
import { afterEach, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({ scroll: vi.fn(), row: vi.fn(), width: 0, layout: (_event: unknown) => {} }))
vi.mock('../../../theme', () => ({ useAppTheme: () => ({ isDark: false, text: '#000', tertiary: '#777' }) }))
vi.mock('react-native', async () => {
  const { createElement, useImperativeHandle } = await import('react')
  return {
    Platform: { select: (options: { default: unknown }) => options.default },
    StyleSheet: { create: (styles: unknown) => styles },
    View: ({ children }: { children: ReactNode }) => createElement('div', null, children),
    Text: ({ children }: { children: ReactNode }) => createElement('span', null, children),
    ScrollView: ({ ref, children, onLayout }: any) => {
      useImperativeHandle(ref, () => ({ scrollTo: native.scroll }))
      native.layout = onLayout
      return createElement('div', null, children)
    },
    FlatList: ({ ref, renderItem, data, style }: any) => {
      useImperativeHandle(ref, () => ({ scrollToIndex: native.row }))
      native.width = style.width
      return createElement('div', null, data.slice(0, 2).map((item: number) => createElement('div', { key: item }, renderItem({ item }))))
    },
  }
})
import { CodeView, type CodeViewHandle } from './CodeView'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const container = document.createElement('div')
let root = createRoot(container)
afterEach(async () => { await act(async () => root.unmount()); root = createRoot(container); vi.clearAllMocks() })

it('shows tabs as aligned spaces in native text while retaining original search ranges', async () => {
  const plain = ['a\tneedle\tvalue']
  await act(async () => root.render(<CodeView lines={splitHighlightedLines(plain[0]!, null)} plain={plain} wrap={false} matches={[{ line: 0, start: 2, end: 8 }]} current={0} bottomInset={0} />))
  expect(container.textContent).toBe('1a   needle  value')
})

it('reveals matches after tabs using their displayed column', async () => {
  const plain = ['\t'.repeat(100) + 'needle']
  const ref = createRef<CodeViewHandle>()
  await act(async () => root.render(<CodeView ref={ref} lines={splitHighlightedLines(plain[0]!, null)} plain={plain} wrap={false} matches={[]} current={0} bottomInset={0} />))
  native.layout({ nativeEvent: { layout: { width: 200 } } })
  ref.current!.scrollToMatch({ line: 0, start: 100, end: 106 })
  expect(native.row).toHaveBeenCalledWith(expect.objectContaining({ index: 0 }))
  expect(native.width).toBeGreaterThan(3000)
  expect(native.scroll.mock.lastCall![0].x).toBeGreaterThan(2500)
})
