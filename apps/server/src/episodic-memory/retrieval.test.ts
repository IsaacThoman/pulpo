import { describe, expect, it } from 'vitest'
import fixtures from './retrieval-fixtures.json' with { type: 'json' }
import { automaticRecallQueryHasSignal, explicitSearchTerms, fuseRankedCandidates } from './retrieval.js'
import type { EpisodicMemoryProfile, EpisodicMemoryRecallMode } from '@pulpo/contracts'

describe('episodic retrieval calibration', () => {
  it('returns plausible semantic candidates only for explicit searches', () => {
    const now = new Date()
    const candidates = [
      { key: 'performance-audit', semanticRank: 1, semanticSimilarity: 0.59, updatedAt: now },
      { key: 'noise', semanticRank: 2, semanticSimilarity: 0.2, updatedAt: now },
    ]
    expect(fuseRankedCandidates(candidates, 'embeddinggemma', 'balanced', now)).toEqual([])
    expect(fuseRankedCandidates(candidates, 'embeddinggemma', 'balanced', now, 'explicit').map((row) => row.key)).toEqual(['performance-audit'])
  })

  it('removes conversational filler, deduplicates terms, and treats operators as text', () => {
    expect(explicitSearchTerms('Can you find a previous chat about my web app performance testing?'))
      .toEqual(['web', 'app', 'performance', 'testing'])
    expect(explicitSearchTerms('Pulpo pulpo OR "audit" -latency')).toEqual(['pulpo', 'audit', 'latency'])
    expect(explicitSearchTerms('¿Recuerdas mi café favorito?')).toEqual(['café', 'favorito'])
    expect(explicitSearchTerms('find my previous chats')).toEqual([])
  })
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
