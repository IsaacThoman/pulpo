import { describe, expect, it } from 'vitest'
import { LEGACY_SUMMARY_PREFIXES, SUMMARIZATION_PROMPT, SUMMARY_PREFIX, isSummaryText, summaryMessageText } from './prompt.js'

describe('compaction prompts', () => {
  it('keeps the Codex prompt and summary prefix', () => {
    expect(SUMMARIZATION_PROMPT.startsWith('You are performing a CONTEXT CHECKPOINT COMPACTION.')).toBe(true)
    expect(SUMMARIZATION_PROMPT).toContain('do not call any tools')
    expect(SUMMARY_PREFIX.startsWith('Another language model started to solve this problem')).toBe(true)
    expect(SUMMARY_PREFIX.endsWith('to assist with your own analysis:')).toBe(true)
  })

  it('puts the trimmed summary on the line after the prefix', () => {
    expect(summaryMessageText('  done \n')).toBe(`${SUMMARY_PREFIX}\ndone`)
  })

  it('recognizes new and legacy summaries', () => {
    expect(isSummaryText(summaryMessageText('x'))).toBe(true)
    expect(isSummaryText(`\n  ${summaryMessageText('x')}`)).toBe(true)
    expect(LEGACY_SUMMARY_PREFIXES).toEqual(['[Compacted context]', 'Earlier conversation summary:', 'Summary of earlier conversation:'])
    for (const prefix of LEGACY_SUMMARY_PREFIXES) expect(isSummaryText(`${prefix}\nold`)).toBe(true)
  })

  it('does not treat ordinary user text as a summary', () => {
    expect(isSummaryText('Can you summarize the earlier conversation?')).toBe(false)
    expect(isSummaryText('Another language model said hi')).toBe(false)
    expect(isSummaryText('')).toBe(false)
  })
})
