// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { QuestionItem } from '@pulpo/contracts'

const f = vi.hoisted(() => ({ request: vi.fn(), apply: vi.fn() }))
vi.mock('@/lib/api', () => ({ apiRequest: f.request }))
vi.mock('@/stores/chat', () => ({ useChat: { getState: () => ({ applyResponseSnapshot: f.apply }) } }))
vi.mock('@/i18n/ui', () => ({ ui: (text: string) => text }))
import { QuestionCard, type QuestionCardControl } from './QuestionCard'

const item: QuestionItem = { type: 'pulpo_question', id: 'set', toolCallId: 'call', responseId: 'response', status: 'pending', answers: {}, questions: [
  { id: 'game', prompt: 'What kind of game?', options: [{ label: 'Puzzle', recommended: true }, { label: 'Arcade', description: 'Fast reflexes' }] },
  { id: 'theme', prompt: 'What theme?' },
] }
beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); f.request.mockResolvedValue({ responseId: 'response', output: [] }) })
afterEach(cleanup)

it('navigates options and direct composer replies, waits for Submit, and sends a complete set', async () => {
  const control = createRef<QuestionCardControl>()
  const view = render(<QuestionCard item={item} namespace="user" controlRef={control} onTextChange={vi.fn()} />)
  expect(view.getByRole('button', { name: 'Submit' }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(view.getByRole('button', { name: /Arcade/ }))
  expect(view.getByRole('heading').textContent).toBe('What theme?')
  act(() => control.current!.answerText('Space'))
  expect(f.request).not.toHaveBeenCalled()
  fireEvent.click(view.getByRole('button', { name: 'Previous question' }))
  expect(view.getByRole('button', { name: /Arcade/ }).getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(view.getByRole('button', { name: 'Submit' }))
  await waitFor(() => expect(f.apply).toHaveBeenCalledOnce())
  expect(f.request).toHaveBeenCalledWith('/api/responses/response/questions/set/answer', { method: 'POST', body: { action: 'submit', answers: { game: { kind: 'option', index: 1 }, theme: { kind: 'text', text: 'Space' } } } })
})

it('restores drafts after remount and retains them when submission fails', async () => {
  const control = createRef<QuestionCardControl>()
  const props = { item, namespace: 'user', controlRef: control, onTextChange: vi.fn() }
  const first = render(<QuestionCard {...props} />)
  act(() => control.current!.answerText('Word game'))
  first.unmount()
  const view = render(<QuestionCard {...props} />)
  expect(view.getByRole('heading').textContent).toBe('What theme?')
  act(() => control.current!.setText('Underwater'))
  f.request.mockRejectedValue(new Error('Offline'))
  fireEvent.click(view.getByRole('button', { name: 'Submit' }))
  await waitFor(() => expect(view.getByRole('alert').textContent).toBe('Offline'))
  expect((view.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Underwater')
})

it('the close button skips the complete set even with unsent answers', async () => {
  const view = render(<QuestionCard item={item} namespace="user" onTextChange={vi.fn()} />)
  fireEvent.click(view.getByRole('button', { name: /Puzzle/ }))
  fireEvent.click(view.getByRole('button', { name: 'Skip all questions' }))
  await waitFor(() => expect(f.request).toHaveBeenCalledWith(expect.any(String), { method: 'POST', body: { action: 'skip_all' } }))
})
