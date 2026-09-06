// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
const native = vi.hoisted(() => ({ dismiss: vi.fn(), done: () => {} }))
vi.mock('react-native', () => ({ Keyboard: { dismiss: native.dismiss } }))
vi.mock('./materialIcons', () => ({ materialIcon: (name: string) => name }))
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: () => null }))
vi.mock('@expo/ui/jetpack-compose/modifiers', () => ({ fillMaxWidth: () => ({}), semantics: () => ({}) }))
vi.mock('@expo/ui/jetpack-compose', async () => {
  const { createElement, useRef } = await import('react')
  const Container = ({ children }: { children: ReactNode }) => createElement('div', null, children)
  return {
    Host: Container, Text: Container,
    OutlinedTextField: Object.assign(({ keyboardActions, children }: { keyboardActions: { onDone: () => void }; children: ReactNode }) => {
      native.done = keyboardActions.onDone
      return createElement('div', null, children)
    }, { Label: Container }),
    useNativeState: (initial: string) => {
      const value = useRef(initial)
      return { get: () => value.current, set: (next: string) => { value.current = next } }
    },
  }
})
import { MaterialField } from './MaterialUI.android'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const container = document.createElement('div')
let root = createRoot(container)
afterEach(async () => { await act(async () => root.unmount()); root = createRoot(container); vi.clearAllMocks() })
it('dismisses the keyboard for a field without a submit action', async () => {
  await act(async () => root.render(<MaterialField label="Name" value="Member" />))
  await act(async () => native.done())
  expect(native.dismiss).toHaveBeenCalledOnce()
})
it('preserves an explicit submit action and passes the field text', async () => {
  const submit = vi.fn()
  await act(async () => root.render(<MaterialField label="Search" value="Terra" onSubmitEditing={submit} />))
  await act(async () => native.done())
  expect(submit).toHaveBeenCalledWith({ nativeEvent: { text: 'Terra' } })
  expect(native.dismiss).not.toHaveBeenCalled()
})
