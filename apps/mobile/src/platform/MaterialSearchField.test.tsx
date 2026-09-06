// @vitest-environment jsdom
import { act, createRef, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
const native = vi.hoisted(() => ({ dismiss: vi.fn(), blur: vi.fn(), change: (_value: string) => {}, focus: (_value: boolean) => {}, search: () => {}, text: '' }))
vi.mock('react-native', () => ({ Keyboard: { dismiss: native.dismiss } }))
vi.mock('./materialIcons', () => ({ materialIcon: (name: string) => name }))
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: () => null }))
vi.mock('@expo/ui/jetpack-compose/modifiers', () => ({ fillMaxWidth: () => ({}) }))
vi.mock('@expo/ui/jetpack-compose', async () => {
  const { createElement, useImperativeHandle, useState } = await import('react')
  const Container = ({ children }: { children: ReactNode }) => createElement('div', null, children)
  return {
    Host: Container, Text: Container,
    Icon: ({ contentDescription }: { contentDescription?: string }) => createElement('span', null, contentDescription),
    IconButton: ({ children, onClick }: { children: ReactNode; onClick: () => void }) => createElement('button', { onClick }, children),
    TextField: Object.assign(({ ref, onValueChange, onFocusChanged, keyboardActions, children }: {
      ref: React.Ref<{ blur: () => Promise<void> }>; onValueChange: (value: string) => void; onFocusChanged: (focused: boolean) => void;
      keyboardActions: { onSearch: () => void }; children: ReactNode;
    }) => {
      useImperativeHandle(ref, () => ({ blur: native.blur }))
      native.change = (value) => { native.text = value; onValueChange(value) }
      native.focus = onFocusChanged
      native.search = keyboardActions.onSearch
      return createElement('div', null, children)
    }, { Placeholder: Container, LeadingIcon: Container, TrailingIcon: Container }),
    useNativeState: (initial: string) => useState(() => {
      native.text = initial
      return { get: () => native.text, set: (value: string) => { native.text = value } }
    })[0],
  }
})
import { MaterialSearchField } from './MaterialUI.android'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const container = document.createElement('div')
let root = createRoot(container)
afterEach(async () => { await act(async () => root.unmount()); root = createRoot(container); vi.clearAllMocks() })
it('keeps native text and the history filter synchronized when typing, clearing and resetting externally', async () => {
  const onChange = vi.fn(), onFocusChange = vi.fn()
  const render = (value: string) => act(async () => root.render(<MaterialSearchField value={value} onChange={onChange} onFocusChange={onFocusChange} />))
  await render('')
  await act(async () => native.change('cache'))
  expect(onChange).toHaveBeenLastCalledWith('cache')
  await render('cache')
  expect(native.text).toBe('cache')
  await act(async () => container.querySelector('button')!.click())
  expect(native.text).toBe('')
  expect(onChange).toHaveBeenLastCalledWith('')
  await render('')
  expect(container.querySelector('button')).toBeNull()
  await render('restored search')
  expect(native.text).toBe('restored search')
})
it('reports focus and releases the native field on keyboard submit and drawer dismissal', async () => {
  const onFocusChange = vi.fn(), fieldRef = createRef<{ blur: () => Promise<void> }>()
  await act(async () => root.render(<MaterialSearchField value="cache" fieldRef={fieldRef} onChange={vi.fn()} onFocusChange={onFocusChange} />))
  await act(async () => native.focus(true))
  expect(onFocusChange).toHaveBeenLastCalledWith(true)
  await act(async () => native.search())
  expect(native.dismiss).toHaveBeenCalledOnce()
  expect(native.blur).toHaveBeenCalledOnce()
  await act(async () => fieldRef.current!.blur())
  expect(native.blur).toHaveBeenCalledTimes(2)
  await act(async () => native.focus(false))
  expect(onFocusChange).toHaveBeenLastCalledWith(false)
})
