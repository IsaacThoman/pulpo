import { expect, it } from 'vitest'
import { hasLargeInitialMessage, transcriptListMessages, usesBottomAnchoredTranscript } from './transcriptWindow'

const rows = Array.from({ length: 2000 }, (_, index) => ({ id: String(index), text: `Message ${index}` }))

it('starts long transcripts at the tail without changing document order or message identity', () => {
  const list = transcriptListMessages(rows)
  expect(list[0]).toBe(rows[1999])
  expect(list[1999]).toBe(rows[0])
  expect(rows[0]!.id).toBe('0')
  expect(transcriptListMessages(rows)).toBe(list)
})

it('keeps short conversations in their existing order and layout', () => {
  const short = rows.slice(0, 8)
  expect(usesBottomAnchoredTranscript(short)).toBe(false)
  expect(transcriptListMessages(short)).toBe(short)
  expect(usesBottomAnchoredTranscript(rows.slice(0, 9))).toBe(true)
  expect(transcriptListMessages([])).toEqual([])
})

it('keeps existing list indices stable as older history becomes available', () => {
  const recent = rows.slice(-20)
  const before = transcriptListMessages(recent)
  const after = transcriptListMessages(rows)
  for (let i = 0; i < before.length; i++) expect(after[i]).toBe(before[i])
})

it('refreshes edits, deletions and branches without retaining stale messages', () => {
  const edited = [...rows.slice(0, -1), { ...rows.at(-1)!, text: 'Edited branch' }]
  expect(transcriptListMessages(edited)[0]!.text).toBe('Edited branch')
  expect(transcriptListMessages(edited)[1]).toBe(transcriptListMessages(rows)[1])
  const removed = rows.slice(0, -1)
  expect(transcriptListMessages(removed)[0]).toBe(rows[1998])
  const branch = rows.slice(0, 10)
  expect(transcriptListMessages(branch)[0]).toBe(rows[9])
})

it('isolates exceptionally large initial messages without delaying ordinary long histories', () => {
  expect(hasLargeInitialMessage(rows)).toBe(false)
  expect(hasLargeInitialMessage([])).toBe(false)
  expect(hasLargeInitialMessage([{ text: 'x'.repeat(24_000) }])).toBe(false)
  expect(hasLargeInitialMessage([{ text: 'x'.repeat(24_001) }])).toBe(true)
  expect(hasLargeInitialMessage([{ text: 'x'.repeat(90_000) }, { text: 'Latest short reply' }])).toBe(false)
})
