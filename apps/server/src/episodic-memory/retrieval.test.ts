import { describe, expect, it } from 'vitest'
import fixtures from './retrieval-fixtures.json' with { type: 'json' }
import { automaticRecallQueryHasSignal, fitMemoryBudget, fuseRankedCandidates } from './retrieval.js'
import type { EpisodicMemoryProfile, EpisodicMemoryRecallMode } from '@pulpo/contracts'

describe('episodic retrieval calibration', () => {
  it.each(fixtures)('$name', (fixture) => {
    const now = new Date('2026-08-27T00:00:00.000Z')
    const candidates = fixture.candidates.map((candidate) => ({
      ...candidate,
      updatedAt: new Date(now.getTime() - candidate.ageDays * 86_400_000),
    }))
    const ranked = fuseRankedCandidates(
      candidates,
      fixture.profile as EpisodicMemoryProfile,
      fixture.mode as EpisodicMemoryRecallMode,
      now,
    )
    expect(ranked.map((candidate) => candidate.key)).toEqual(fixture.expected)
  })

  it('caps durable facts by count and approximate token budget', () => {
    const selected = fitMemoryBudget(Array.from({ length: 12 }, (_, index) => `${index} ${'x'.repeat(300)}`))
    expect(selected).toHaveLength(7)
    expect(selected.join('').length).toBeLessThanOrEqual(2_000)
  })

  it.each([
    'who am I',
    'what do you know about me?',
    'do you remember me',
    '¿quién soy?',
  ])('abstains from automatic chat recall for low-information identity query: %s', (query) => {
    expect(automaticRecallQueryHasSignal(query)).toBe(false)
  })

  it.each([
    'what was the Quartz Otter token?',
    'deployment decision',
    'spaghetti',
    'Isaac',
    'audit 2041',
  ])('allows automatic recall for a distinctive query: %s', (query) => {
    expect(automaticRecallQueryHasSignal(query)).toBe(true)
  })
})
