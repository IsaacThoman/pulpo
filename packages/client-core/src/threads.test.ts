import { describe, expect, it } from 'vitest'
import { isLongThreadReport, markdownPreviewText, matchingComposerCommands, parseComposerCommand, parseThreadUpdate } from './threads.js'

const first = '11111111-1111-4111-8111-111111111111'
const second = '22222222-2222-4222-8222-222222222222'

describe('parseThreadUpdate', () => {
  it('reads one report with its title, thread, outcome, and reply', () => {
    const text = `Thread update — sent automatically when a thread you started stops working.\n\n### Thread “Compare CRM pricing” finished\nThread id: ${first}\n\nHubSpot is cheapest.\n\n- Salesforce: $25`
    expect(parseThreadUpdate(text)).toEqual({ heading: 'Thread update', reports: [{
      threadId: first,
      title: 'Compare CRM pricing',
      outcome: 'finished',
      outcomeText: 'finished',
      body: 'HubSpot is cheapest.\n\n- Salesforce: $25',
    }] })
  })

  it('splits several reports and keeps headings inside a reply in its body', () => {
    const text = [
      'Thread updates (2) — sent automatically when a thread you started stops working.',
      '',
      '### Thread “Research” was stopped',
      `Thread id: ${first}`,
      '',
      '### Findings',
      'Partial notes.',
      '',
      '### Thread “Draft “the” email” stopped before finishing',
      `Thread id: ${second}`,
      '',
      'Error: Context window exceeded',
    ].join('\n')
    const { heading, reports } = parseThreadUpdate(text)
    expect(heading).toBe('Thread updates (2)')
    expect(reports.map((report) => [report.threadId, report.title, report.outcome])).toEqual([
      [first, 'Research', 'stopped'],
      [second, 'Draft “the” email', 'incomplete'],
    ])
    expect(reports[0]!.body).toBe('### Findings\nPartial notes.')
    expect(reports[1]!.body).toBe('Error: Context window exceeded')
  })

  it('keeps an outcome it does not know as written', () => {
    const [report] = parseThreadUpdate(`### Thread “X” failed\nThread id: ${first}\n\n(No reply text.)\n\n### Thread “Y” paused\nThread id: ${second}\n`).reports
    expect(report!.outcome).toBe('failed')
    expect(parseThreadUpdate(`### Thread “Y” paused\nThread id: ${second}\n`).reports[0]).toMatchObject({ outcome: 'other', outcomeText: 'paused', body: '' })
  })

  it('finds nothing in an ordinary message', () => {
    expect(parseThreadUpdate('### Thread “X” finished\nno id here').reports).toEqual([])
    expect(parseThreadUpdate('Hello')).toEqual({ heading: 'Hello', reports: [] })
    expect(parseThreadUpdate('')).toEqual({ heading: 'Thread update', reports: [] })
  })
})

describe('isLongThreadReport', () => {
  it('collapses long or many-line reports', () => {
    expect(isLongThreadReport('short')).toBe(false)
    expect(isLongThreadReport('x'.repeat(601))).toBe(true)
    expect(isLongThreadReport(Array.from({ length: 12 }, () => 'line').join('\n'))).toBe(true)
  })
})

describe('parseComposerCommand', () => {
  it('reads /btw and its question', () => {
    expect(parseComposerCommand('/btw what does this regex do?')).toEqual({ kind: 'btw', question: 'what does this regex do?' })
    expect(parseComposerCommand('  /BTW\nline one\nline two  ')).toEqual({ kind: 'btw', question: 'line one\nline two' })
    expect(parseComposerCommand('/btw')).toEqual({ kind: 'btw', question: '' })
  })

  it('reads /fork only on its own', () => {
    expect(parseComposerCommand('/fork')).toEqual({ kind: 'fork' })
    expect(parseComposerCommand(' /fork \n')).toEqual({ kind: 'fork' })
    expect(parseComposerCommand('/fork this please')).toBeNull()
  })

  it('leaves other messages that start with a slash alone', () => {
    expect(parseComposerCommand('/btwx hello')).toBeNull()
    expect(parseComposerCommand('/usr/bin/env node')).toBeNull()
    expect(parseComposerCommand('/help')).toBeNull()
    expect(parseComposerCommand('see /btw later')).toBeNull()
  })

  it('takes only the commands available in the chat', () => {
    expect(parseComposerCommand('/btw hi', ['fork'])).toBeNull()
    expect(parseComposerCommand('/fork', [])).toBeNull()
  })
})

describe('matchingComposerCommands', () => {
  it('suggests commands while their name is typed', () => {
    expect(matchingComposerCommands('/')).toEqual(['btw', 'fork'])
    expect(matchingComposerCommands('/f')).toEqual(['fork'])
    expect(matchingComposerCommands('/btw')).toEqual(['btw'])
    expect(matchingComposerCommands('/x')).toEqual([])
    expect(matchingComposerCommands('/', ['fork'])).toEqual(['fork'])
  })

  it('keeps /btw while its question is typed, and nothing after other text', () => {
    expect(matchingComposerCommands('/btw why')).toEqual(['btw'])
    expect(matchingComposerCommands('/fork now')).toEqual([])
    expect(matchingComposerCommands('hello /btw')).toEqual([])
    expect(matchingComposerCommands('/usr/bin')).toEqual([])
  })
})

describe('markdownPreviewText', () => {
  it('drops Markdown marks, links, and table rules', () => {
    expect(markdownPreviewText('## Result\n**Porto** wins — see [the table](https://x.test) and `notes.md`.'))
      .toBe('Result\nPorto wins — see the table and notes.md.')
    expect(markdownPreviewText('| | A |\n|---|---|\n| x | 1 |')).toBe('A\nx 1')
    expect(markdownPreviewText('- *one* item\n- snake_case_name stays')).toBe('one item\nsnake_case_name stays')
  })

  it('drops marks a reply still streaming has not closed', () => {
    expect(markdownPreviewText('**Kyoto in Ap')).toBe('Kyoto in Ap')
    expect(markdownPreviewText('Use `npm')).toBe('Use npm')
  })
})
