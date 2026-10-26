import { describe, expect, it } from 'vitest'
import { parseQuiz } from '@pulpo/client-core/quiz'
import { BASE_AGENT_PROMPT, buildToolsDisabledSystemPrompt } from '../agent/policy.js'
import { QUIZ_FILE_INSTRUCTIONS, QUIZ_INSTRUCTIONS, quizInstructions } from './quiz-instructions.js'

describe('quiz instructions', () => {
  it('describes a block the apps can render', () => {
    const example = QUIZ_INSTRUCTIONS.split('\n').find((line) => line.startsWith('{'))!
    expect(parseQuiz(example)?.questions).toHaveLength(1)
  })

  it('are only given to conversations shown in Pulpo', () => {
    expect(quizInstructions({ origin: 'web' })).toBe(QUIZ_INSTRUCTIONS)
    expect(quizInstructions({ origin: 'api' })).toBe('')
  })

  it('reach agent runs with and without tools', () => {
    expect(BASE_AGENT_PROMPT).toContain(QUIZ_INSTRUCTIONS)
    expect(BASE_AGENT_PROMPT).toContain(QUIZ_FILE_INSTRUCTIONS)
    const toolsDisabled = buildToolsDisabledSystemPrompt('')
    expect(toolsDisabled).toContain(QUIZ_INSTRUCTIONS)
    expect(toolsDisabled).not.toContain(QUIZ_FILE_INSTRUCTIONS)
  })
})
