import { describe, expect, it, vi } from 'vitest'

vi.mock('../database/client.js', () => ({ db: {} }))
vi.mock('../responses/events.js', () => ({ publishStateChange: vi.fn(), requestCancellation: vi.fn() }))
vi.mock('../responses/service.js', () => ({ createResponse: vi.fn() }))
vi.mock('./message-queue.js', () => ({ createQueuedMessage: vi.fn() }))

const { consecutiveThreadUpdates, conversationTranscript, deriveThreadStatus, threadReportText, threadSummary } = await import('./threads.js')
const { projectContext } = await import('./projects.js')

const reply = (text: string) => [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }]

describe('thread status', () => {
  it('is working while a reply runs or follow-ups wait', () => {
    expect(deriveThreadStatus({ resolvedAt: null, latestStatus: 'in_progress', hasQueuedMessages: false })).toBe('working')
    expect(deriveThreadStatus({ resolvedAt: null, latestStatus: 'queued', hasQueuedMessages: false })).toBe('working')
    expect(deriveThreadStatus({ resolvedAt: null, latestStatus: 'completed', hasQueuedMessages: true })).toBe('working')
    expect(deriveThreadStatus({ resolvedAt: null, latestStatus: null, hasQueuedMessages: false })).toBe('working')
  })

  it('is done after a completed reply and needs attention after any other ending', () => {
    expect(deriveThreadStatus({ resolvedAt: null, latestStatus: 'completed', hasQueuedMessages: false })).toBe('done')
    for (const status of ['failed', 'cancelled', 'incomplete']) {
      expect(deriveThreadStatus({ resolvedAt: null, latestStatus: status, hasQueuedMessages: false })).toBe('attention')
    }
  })

  it('stays resolved whatever its replies did', () => {
    expect(deriveThreadStatus({ resolvedAt: new Date(), latestStatus: 'in_progress', hasQueuedMessages: true })).toBe('resolved')
  })
})

describe('thread summaries and reports', () => {
  it('summarizes the latest reply on one line', () => {
    expect(threadSummary(reply('Found   three\noptions.'))).toBe('Found three options.')
    expect(threadSummary([])).toBeNull()
    const long = threadSummary(reply('x'.repeat(500)))!
    expect(long).toHaveLength(280)
    expect(long.endsWith('…')).toBe(true)
  })

  it('reads as plain text with each thread named, its id, and how it ended', () => {
    const text = threadReportText([
      { threadId: 'a', title: 'Compare CRMs', status: 'completed', reply: 'HubSpot wins.' },
      { threadId: 'b', title: 'Draft email', status: 'failed', reply: '', error: 'Provider unavailable' },
    ])
    expect(text).toMatch(/^Thread updates \(2\)/)
    expect(text).toContain('### Thread “Compare CRMs” finished\nThread id: a\n\nHubSpot wins.')
    expect(text).toContain('### Thread “Draft email” failed\nThread id: b\n\nError: Provider unavailable')
  })

  it('counts the thread updates at the end of the active branch', () => {
    const turns = [
      { id: '1', parentResponseId: null, branchReason: 'message' },
      { id: '2', parentResponseId: '1', branchReason: 'thread_update' },
      { id: '3', parentResponseId: '2', branchReason: 'thread_update' },
      { id: '4', parentResponseId: '1', branchReason: 'regenerate' },
    ]
    expect(consecutiveThreadUpdates(turns, '3')).toBe(2)
    expect(consecutiveThreadUpdates(turns, '4')).toBe(0)
    expect(consecutiveThreadUpdates(turns, null)).toBe(0)
  })
})

describe('side chat transcripts', () => {
  it('alternates user and assistant text and keeps the newest when it runs long', () => {
    const turns = [
      { input: [{ role: 'user', content: 'First question' }], output: reply('First answer') },
      { input: [{ role: 'user', content: [{ type: 'input_text', text: 'Second question' }] }], output: reply('Second answer') },
    ]
    expect(conversationTranscript(turns)).toBe('User: First question\n\nAssistant: First answer\n\nUser: Second question\n\nAssistant: Second answer')
    const clipped = conversationTranscript(turns, 20)
    expect(clipped.startsWith('[Earlier messages omitted]')).toBe(true)
    expect(clipped.endsWith('Second answer')).toBe(true)
  })
})

describe('project context', () => {
  it('names the project, its instructions and memory', () => {
    const text = projectContext({ name: 'Launch', instructions: 'Use metric units.', memory: 'Budget is $5k.', memoryRevision: 3 }, { canEditMemory: true })
    expect(text).toContain('“Launch”')
    expect(text).toContain('Use metric units.')
    expect(text).toContain('Project memory (revision 3)')
    expect(text).toContain('update_project_memory')
  })

  it('says when memory is empty and only mentions the tool where it exists', () => {
    const text = projectContext({ name: 'Launch', instructions: '', memory: '', memoryRevision: 0 }, { canEditMemory: false })
    expect(text).toContain("The project's memory is empty.")
    expect(text).not.toContain('update_project_memory')
    expect(text).not.toContain('Project instructions')
  })
})
