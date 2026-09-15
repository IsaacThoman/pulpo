// @vitest-environment jsdom
import { createElement, createRef, type ReactNode } from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { QuestionItem } from '@pulpo/contracts'

const f = vi.hoisted(() => ({ request: vi.fn(), apply: vi.fn(), data: new Map<string, string>() }))
vi.mock('../../api/client', () => ({ apiRequest: f.request }))
vi.mock('../../providers/realtimeStore', () => ({ useRealtimeStore: { getState: () => ({ receiveSnapshot: f.apply }) } }))
vi.mock('../../mockup5/src/theme', () => ({ useAppTheme: () => ({ text: '#111', secondary: '#666', separator: '#ddd', elevated: '#fff', accent: '#111', accentText: '#fff' }) }))
vi.mock('../../data/database', () => ({
  getValue: async (_namespace: string, key: string) => JSON.parse(f.data.get(key) ?? 'null'),
  setValue: async (_namespace: string, key: string, value: unknown) => { f.data.set(key, JSON.stringify(value)) },
}))
vi.mock('react-native', () => {
  const container = ({ children }: { children?: ReactNode }) => createElement('div', null, children)
  return {
    View: container, Text: container, ScrollView: container,
    Keyboard: { metrics: () => undefined, addListener: () => ({ remove() {} }) },
    useWindowDimensions: () => ({ width: 390, height: 844 }),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    Pressable: ({ children, onPress, disabled, accessibilityLabel }: { children: ReactNode; onPress: () => void; disabled?: boolean; accessibilityLabel?: string }) => createElement('button', { onClick: onPress, disabled, 'aria-label': accessibilityLabel }, children),
    TextInput: ({ value, onChangeText, accessibilityLabel }: { value: string; onChangeText: (text: string) => void; accessibilityLabel: string }) => createElement('textarea', { value, onChange: (event: { target: { value: string } }) => onChangeText(event.target.value), 'aria-label': accessibilityLabel }),
  }
})
import { QuestionCard, type QuestionCardControl } from './QuestionCard'

const item: QuestionItem = { type: 'pulpo_question', id: 'set', responseId: 'response', toolCallId: 'call', status: 'pending', answers: {}, questions: [
  { id: 'game', prompt: 'What kind?', options: [{ label: 'Puzzle' }, { label: 'Arcade' }] }, { id: 'theme', prompt: 'What theme?' },
] }
beforeEach(() => { vi.resetAllMocks(); f.data.clear(); f.request.mockResolvedValue({ responseId: 'response', output: [] }) })
afterEach(cleanup)

it('supports options, direct replies, navigation and one final submission on mobile', async () => {
  const control = createRef<QuestionCardControl>()
  const view = render(<QuestionCard item={item} namespace="user" controlRef={control} onTextChange={vi.fn()} />)
  await waitFor(() => expect(view.getByRole('button', { name: /Puzzle/ }).hasAttribute('disabled')).toBe(false))
  fireEvent.click(view.getByRole('button', { name: /Puzzle/ }))
  expect(view.getByText('What theme?')).toBeTruthy()
  act(() => control.current!.answerText('Space'))
  expect(f.request).not.toHaveBeenCalled()
  fireEvent.click(view.getByRole('button', { name: 'Previous question' }))
  expect(view.getByText('What kind?')).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: 'Submit' }))
  await waitFor(() => expect(f.apply).toHaveBeenCalledOnce())
  expect(f.request).toHaveBeenCalledWith('/api/responses/response/questions/set/answer', { method: 'POST', body: { action: 'submit', answers: { game: { kind: 'option', index: 0 }, theme: { kind: 'text', text: 'Space' } } } })
})

it('hydrates answers after remount and closes by skipping all questions', async () => {
  const control = createRef<QuestionCardControl>()
  const props = { item, namespace: 'user', controlRef: control, onTextChange: vi.fn() }
  const first = render(<QuestionCard {...props} />)
  await waitFor(() => expect(first.getByRole('button', { name: /Puzzle/ }).hasAttribute('disabled')).toBe(false))
  await act(async () => control.current!.answerText('Word game'))
  first.unmount()
  const view = render(<QuestionCard {...props} />)
  await waitFor(() => expect(view.getByText('What theme?')).toBeTruthy())
  fireEvent.click(view.getByRole('button', { name: 'Skip all questions' }))
  await waitFor(() => expect(f.request).toHaveBeenCalledWith(expect.any(String), { method: 'POST', body: { action: 'skip_all' } }))
})
