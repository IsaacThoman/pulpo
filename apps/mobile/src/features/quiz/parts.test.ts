import { describe, expect, it } from 'vitest'
import { appendDraftText } from './composer'
import { assistantMarkdownParts } from './parts'

const quizJson = JSON.stringify({ title: 'Capitals', questions: [{ prompt: 'Capital of France?', options: ['Paris', 'Rome'], answer: 0 }] })

describe('assistant reply parts', () => {
  it('leaves a reply without quizzes as one Markdown part', () => {
    const text = 'Intro\n\n```js\nconsole.log(1)\n```'
    expect(assistantMarkdownParts(text, false)).toEqual([{ kind: 'markdown', text }])
  })

  it('renders a complete quiz block as a quiz between the Markdown around it', () => {
    const parts = assistantMarkdownParts(`Here you go:\n\n\`\`\`quiz\n${quizJson}\n\`\`\`\n\nGood luck!`, true)
    expect(parts.map((part) => part.kind)).toEqual(['markdown', 'quiz', 'markdown'])
    expect(parts[1]).toMatchObject({ kind: 'quiz', source: quizJson, quiz: { title: 'Capitals' } })
  })

  it('shows a placeholder for a quiz still streaming in', () => {
    expect(assistantMarkdownParts('Here you go:\n\n```quiz\n{"questions": [', true)).toEqual([
      { kind: 'markdown', text: 'Here you go:\n' },
      { kind: 'building' },
    ])
  })

  it('shows a quiz whose closing fence never arrived once the reply finished', () => {
    expect(assistantMarkdownParts(`\`\`\`quiz\n${quizJson}`, false)).toMatchObject([{ kind: 'quiz', source: quizJson }])
  })

  it('keeps a quiz that cannot be shown as a code block in the surrounding Markdown', () => {
    expect(assistantMarkdownParts('Before\n```quiz\n{"questions": []}\n```\nAfter', true)).toEqual([
      { kind: 'markdown', text: 'Before\n```quiz\n{"questions": []}\n```\nAfter' },
    ])
    expect(assistantMarkdownParts('```quiz\n{"questions": [', false)).toEqual([
      { kind: 'markdown', text: '```quiz\n{"questions": [\n```' },
    ])
  })

  it('fences a broken quiz past any backticks inside it', () => {
    expect(assistantMarkdownParts('```quiz\nnot ```json\n```', false)).toEqual([
      { kind: 'markdown', text: '````quiz\nnot ```json\n````' },
    ])
  })
})

describe('appending to the composer draft', () => {
  it('fills an empty draft, or adds after a blank line', () => {
    expect(appendDraftText('', 'Results')).toBe('Results')
    expect(appendDraftText('  \n', 'Results')).toBe('Results')
    expect(appendDraftText('Thanks!\n', 'Results')).toBe('Thanks!\n\nResults')
  })
})
