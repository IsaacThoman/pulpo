// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useQuizStore } from '@/stores/quiz'
import { registerComposerInsert } from './composer-focus'
import { Markdown } from './Markdown'

vi.hoisted(() => {
  window.matchMedia = (() => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined })) as never
})

const quiz = {
  title: 'Crypto basics',
  questions: [
    { prompt: 'Which cipher is unconditionally secure?', options: ['AES', 'One-time pad'], answer: 1, hint: 'Key as long as the message', explanation: 'Every plaintext is equally likely.' },
    { prompt: 'Is RSA symmetric?', options: ['Yes', 'No'], answer: 1 },
  ],
}
const block = (json: string) => `Here is a quiz.\n\n\`\`\`quiz\n${json}\n\`\`\``

function renderMarkdown(content: string, streaming = false) {
  const wrap = (children: ReactNode) => (
    <QueryClientProvider client={new QueryClient()}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>
  )
  const view = render(wrap(<Markdown content={content} streaming={streaming} />))
  return { ...view, rerender: (next: string, nextStreaming = false) => view.rerender(wrap(<Markdown content={next} streaming={nextStreaming} />)) }
}

afterEach(() => {
  cleanup()
  useQuizStore.setState({ progress: {} })
})

describe('quiz blocks', () => {
  it('runs a quiz and sends the missed questions to the composer', async () => {
    const insert = vi.fn()
    const unregister = registerComposerInsert(insert)
    renderMarkdown(block(JSON.stringify(quiz)))

    expect(await screen.findByText('Which cipher is unconditionally secure?')).toBeTruthy()
    fireEvent.click(screen.getByText('Show hint'))
    expect(screen.getByText('Key as long as the message')).toBeTruthy()

    fireEvent.click(screen.getByText('AES'))
    expect(screen.getByText('Not quite')).toBeTruthy()
    expect(screen.getByText('Every plaintext is equally likely.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Question 1' }).className).toContain('destructive')

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByText('No'))
    expect(screen.getByText('Correct')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'See results' }))

    expect(screen.getByTestId('quiz-results').textContent).toContain('1 / 2')
    fireEvent.click(screen.getByRole('button', { name: /Send results/ }))
    expect(insert).toHaveBeenCalledWith(expect.stringContaining('1/2 correct'))
    expect(insert.mock.calls[0]![0]).toContain('My answer: AES')

    fireEvent.click(screen.getByRole('button', { name: /Retake/ }))
    expect(screen.getByText('Which cipher is unconditionally secure?')).toBeTruthy()
    expect(screen.queryByText('Not quite')).toBeNull()
    unregister()
  })

  it('hides sending results when no composer is mounted', async () => {
    renderMarkdown(block(JSON.stringify({ questions: [quiz.questions[1]] })))
    fireEvent.click(await screen.findByText('Yes'))
    fireEvent.click(screen.getByRole('button', { name: 'See results' }))
    expect(screen.queryByRole('button', { name: /Send results/ })).toBeNull()
  })

  it('flips through flashcards built from the questions', async () => {
    renderMarkdown(block(JSON.stringify(quiz)))
    fireEvent.click(await screen.findByRole('button', { name: 'Flashcards' }))
    const card = screen.getByTestId('quiz-flashcard')
    expect(card.textContent).toContain('Which cipher is unconditionally secure?')
    fireEvent.click(card)
    expect(card.textContent).toContain('One-time pad')
    fireEvent.click(screen.getByRole('button', { name: 'Next card' }))
    expect(screen.getByTestId('quiz-flashcard').textContent).toContain('Is RSA symmetric?')
    expect(screen.getByText('2 / 2')).toBeTruthy()
  })

  it('waits for a streaming quiz, then falls back to code if it never parses', async () => {
    const view = renderMarkdown('```quiz\n{"questions": [', true)
    expect(screen.getByTestId('quiz-pending').textContent).toContain('Building quiz…')
    view.rerender(block(JSON.stringify(quiz)), true)
    expect(await screen.findByTestId('quiz-card', {}, { timeout: 2000 })).toBeTruthy()
    view.rerender('```quiz\n{"questions": []}\n```')
    expect(screen.queryByTestId('quiz-card')).toBeNull()
    expect(screen.getByText('{"questions": []}')).toBeTruthy()
  })
})
