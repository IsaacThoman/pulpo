import { describe, expect, it } from 'vitest'
import { activeLineageChunks, activeLineagePassages, chatTurnChunk, chatTurnPassages, PASSAGE_CHARACTERS } from './chunks.js'

function turn(id: string, parentResponseId: string | null, user: string, assistant: string, status = 'completed') {
  return {
    id, parentResponseId, userMessageId: id,
    status: status as 'completed',
    input: [{ role: 'user', content: [{ type: 'input_text', text: user }, { type: 'input_file', attachment_id: 'raw-file' }] }],
    output: [
      { type: 'reasoning', summary: [{ type: 'summary_text', text: 'private reasoning' }] },
      { type: 'pulpo_tool', output: 'private tool output' },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: assistant }] },
    ],
  }
}

describe('episodic chat chunks', () => {
  it('indexes long-answer tails with bounded overlapping passages and no private content', () => {
    const answer = `${'Performance details and measurements. '.repeat(400)}Final recommendation: benchmark 2000-turn chats.`
    const passages = chatTurnPassages(turn('long', null, 'audit pulpo', answer))
    expect(passages.length).toBeGreaterThan(2)
    expect(passages.every((passage, index) => passage.chunkIndex === index && passage.text.length <= PASSAGE_CHARACTERS)).toBe(true)
    expect(passages.at(-1)?.text).toContain('benchmark 2000-turn chats')
    const text = passages.map((passage) => passage.text).join('\n')
    expect(text).not.toMatch(/private|raw-file/)
    const previous = passages[1]!.text.replace(/^Assistant: /, '')
    const next = passages[2]!.text.replace(/^Assistant: /, '')
    expect(next.startsWith(previous.slice(-300).trim())).toBe(true)
    expect(chatTurnPassages(turn('failed', null, 'question', answer, 'failed'))).toEqual([])
  })

  it('keeps inactive branches out of passage indexing', () => {
    const passages = activeLineagePassages({ activeBranchLeafId: 'active', activeResponseId: 'active' }, [
      turn('root', null, 'root', 'root answer'),
      turn('inactive', 'root', 'inactive secret', 'old answer'),
      turn('active', 'root', 'active branch', 'new answer'),
    ])
    expect([...new Set(passages.map((passage) => passage.responseId))]).toEqual(['root', 'active'])
    expect(passages.map((passage) => passage.text).join('\n')).not.toContain('inactive secret')
  })
  it('contains only user text and visible final assistant text', () => {
    const chunk = chatTurnChunk(turn('one', null, 'inspect the report', 'The visible answer'))
    expect(chunk?.text).toBe('User: inspect the report\n\nAssistant: The visible answer')
    expect(chunk?.text).not.toContain('reasoning')
    expect(chunk?.text).not.toContain('tool output')
    expect(chunk?.text).not.toContain('raw-file')
  })

  it('selects only the active lineage', () => {
    const turns = [
      turn('root', null, 'root', 'root answer'),
      turn('inactive', 'root', 'old branch', 'old answer'),
      turn('active', 'root', 'new branch', 'new answer'),
      turn('leaf', 'active', 'follow up', 'follow-up answer'),
    ]
    const chunks = activeLineageChunks({ activeBranchLeafId: 'leaf', activeResponseId: 'leaf' }, turns)
    expect(chunks.map((chunk) => chunk.responseId)).toEqual(['root', 'active', 'leaf'])
    expect(chunks.map((chunk) => chunk.text).join('\n')).not.toContain('old branch')
  })

  it('skips failed and empty turns', () => {
    expect(chatTurnChunk(turn('failed', null, 'question', 'partial', 'failed'))).toBeNull()
    expect(chatTurnChunk(turn('empty', null, '', ''))).toBeNull()
  })
})
