// @vitest-environment jsdom
import { quizResultsMessage, type Quiz } from '@pulpo/client-core/quiz'
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Platform: { OS: 'ios' },
  Alert: { alert: vi.fn() },
  AccessibilityInfo: { announceForAccessibility: vi.fn() },
  View: ({ children }: { children?: ReactNode }) => createElement('div', null, children),
  ScrollView: ({ children }: { children?: ReactNode }) => createElement('div', null, children),
  Text: ({ children }: { children?: ReactNode }) => createElement('span', null, children),
  ActivityIndicator: () => null,
  Pressable: ({ children, onPress, disabled, accessibilityLabel }: { children?: ReactNode; onPress: () => void; disabled?: boolean; accessibilityLabel?: string }) =>
    createElement('button', { onClick: onPress, disabled, 'aria-label': accessibilityLabel }, children),
}))
vi.mock('react-native-reanimated', async () => {
  const { createElement: h, useRef } = await import('react')
  return {
    default: {
      View: ({ children, style, accessibilityElementsHidden }: { children?: ReactNode; style: unknown; accessibilityElementsHidden?: boolean }) => {
        const flat = (Array.isArray(style) ? style : [style]).reduce<Record<string, unknown>>((acc, part) => Object.assign(acc, part), {})
        return h('div', { 'data-face': '', 'data-style': JSON.stringify(flat), 'aria-hidden': accessibilityElementsHidden }, children)
      },
    },
    // Animations land at once, so a style shows where the card ends up.
    useSharedValue: (initial: number) => {
      const ref = useRef<{ value: number } | null>(null)
      ref.current ??= { value: initial }
      return ref.current
    },
    useAnimatedStyle: (factory: () => unknown) => factory(),
    withTiming: (value: number) => value,
    Easing: { inOut: (easing: unknown) => easing, cubic: 'cubic' },
    ReduceMotion: { System: 'system' },
  }
})
vi.mock('../../components/SafeMarkdown', () => ({ SafeMarkdown: ({ children }: { children: string }) => createElement('p', null, children) }))
vi.mock('../../mockup5/src/components/PrototypeUI', () => ({
  PrimaryButton: ({ label, onPress }: { label: string; onPress: () => void }) => createElement('button', { onClick: onPress }, label),
  Segmented: ({ options, onChange }: { options: { value: string; label: string }[]; onChange: (value: string) => void }) =>
    createElement('div', null, options.map((option) => createElement('button', { key: option.value, onClick: () => onChange(option.value) }, option.label))),
}))
vi.mock('../../platform/SymbolView', () => ({ SymbolView: () => null }))
vi.mock('../../theme', () => ({ useAppTheme: () => ({ text: '#000', secondary: '#666', tertiary: '#999', separator: '#ddd', fill: '#eee', fillStrong: '#ddd', elevated: '#fff', accent: '#000', accentText: '#fff', green: '#0a0', red: '#a00', orange: '#f80' }) }))
vi.mock('../files/availability', () => ({ useFilesEnabled: () => false }))
vi.mock('../files/useFilesNamespace', () => ({ useFilesNamespace: () => '' }))
vi.mock('../files/display', () => ({ filesErrorMessage: () => 'Failed' }))
vi.mock('./export', () => ({ shareQuiz: vi.fn(), saveQuizToFiles: vi.fn() }))
vi.mock('expo-haptics', () => ({ notificationAsync: vi.fn(), NotificationFeedbackType: { Success: 'success', Error: 'error' } }))
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({}) }))

const { QuizCard } = await import('./QuizCard')
const { QuizComposerContext } = await import('./composer')
const { useQuizProgress } = await import('./progress')

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const quiz: Quiz = {
  title: 'Capitals',
  questions: [
    { prompt: 'Capital of France?', options: ['Paris', 'Rome'], answer: 0, explanation: 'Paris has been the capital since 987.' },
    { prompt: 'Capital of Italy?', options: ['Madrid', 'Rome'], answer: 1, hint: 'Think of the Colosseum.' },
  ],
  cards: [],
}
let root: Root
let container: HTMLDivElement
const sendToComposer = vi.fn()

beforeEach(() => {
  useQuizProgress.setState({ progress: {} })
  sendToComposer.mockReset()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

async function render(composer: ((text: string) => void) | null = sendToComposer) {
  await act(async () => root.render(createElement(QuizComposerContext.Provider, { value: composer }, createElement(QuizCard, { quiz, progressKey: 'source' }))))
}
const button = (label: string) => Array.from(container.querySelectorAll('button')).find((item) => item.getAttribute('aria-label') === label || item.textContent === label)
async function press(label: string) {
  const target = button(label)
  if (!target) throw new Error(`No button “${label}” in: ${container.textContent}`)
  await act(async () => target.click())
}

describe('mobile quiz card', () => {
  it('locks an answer, explains it, and moves on', async () => {
    await render()
    expect(container.textContent).toContain('Question 1 of 2')
    await press('Rome')
    expect(container.textContent).toContain('Not quite')
    expect(container.textContent).toContain('Paris has been the capital since 987.')
    expect(button('Paris, correct answer')!.disabled).toBe(true)
    expect(button('Rome, incorrect')!.disabled).toBe(true)
    expect(button('Question 1, incorrect')).toBeDefined()
    await press('Next')
    expect(container.textContent).toContain('Capital of Italy?')
  })

  it('shows a hint only before answering', async () => {
    useQuizProgress.getState().update('source', { question: 1 })
    await render()
    expect(container.textContent).not.toContain('Colosseum')
    await press('Show hint')
    expect(container.textContent).toContain('Think of the Colosseum.')
    await press('Rome')
    expect(container.textContent).toContain('Correct')
    expect(container.textContent).not.toContain('Show hint')
  })

  it('scores the quiz, puts the results in the composer, and retakes it', async () => {
    await render()
    await press('Rome')
    await press('Next')
    await press('Rome')
    await press('See results')
    expect(container.textContent).toContain('1/2')
    await press('Send results')
    expect(sendToComposer).toHaveBeenCalledWith(quizResultsMessage(quiz, { 0: 1, 1: 1 }))
    await press('Retake')
    expect(container.textContent).toContain('Question 1 of 2')
    expect(useQuizProgress.getState().progress.source!.answers).toEqual({})
  })

  it('offers no Send results outside a chat', async () => {
    useQuizProgress.getState().update('source', { finished: true })
    await render(null)
    expect(container.textContent).toContain('0/2')
    expect(button('Send results')).toBeUndefined()
  })

  it('keeps its place when remounted', async () => {
    await render()
    await press('Paris')
    await act(async () => root.render(null))
    await render()
    expect(container.textContent).toContain('Correct')
  })

  it('flips flashcards made from the questions', async () => {
    await render()
    await press('Flashcards')
    expect(container.textContent).toContain('1 / 2')
    expect(container.textContent).toContain('Capital of France?')
    await press('Next card')
    expect(container.textContent).toContain('Capital of Italy?')
    const faces = () => Array.from(container.querySelectorAll<HTMLElement>('[data-face]'))
    const shown = () => faces().find((face) => face.getAttribute('aria-hidden') !== 'true')!
    const style = (face: HTMLElement) => JSON.parse(face.dataset.style!) as { opacity: number; transform: Record<string, unknown>[] }
    expect(shown().textContent).toContain('Front')
    const card = Array.from(container.querySelectorAll('button')).find((item) => item.textContent?.includes('Tap to flip'))!
    await act(async () => card.click())
    expect(shown().textContent).toContain('Back')
    expect(shown().textContent).toContain('Rome')
    const [front, back] = faces()
    expect(style(front!)).toMatchObject({ opacity: 0, transform: [{ perspective: 1000 }, { rotateY: '180deg' }] })
    expect(style(back!)).toMatchObject({ opacity: 1, transform: [{ perspective: 1000 }, { rotateY: '360deg' }] })
    // Another card starts on its front.
    await press('Previous card')
    expect(shown().textContent).toContain('Front')
    expect(style(faces()[0]!).opacity).toBe(1)
  })
})
