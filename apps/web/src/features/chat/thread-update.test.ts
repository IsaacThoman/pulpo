import { describe, expect, it } from 'vitest'
import { isLongReport, parseThreadUpdate } from './thread-update'

const first = '11111111-1111-4111-8111-111111111111'
const second = '22222222-2222-4222-8222-222222222222'

describe('parseThreadUpdate', () => {
  it('reads one report with its title, thread, outcome, and reply', () => {
    const text = `Thread update — sent automatically when a thread you started stops working.\n\n### Thread “Compare CRM pricing” finished\nThread id: ${first}\n\nHubSpot is cheapest.\n\n- Salesforce: $25`
    expect(parseThreadUpdate(text)).toEqual([{
      threadId: first,
      title: 'Compare CRM pricing',
      outcome: 'finished',
      outcomeText: 'finished',
      body: 'HubSpot is cheapest.\n\n- Salesforce: $25',
    }])
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
    const reports = parseThreadUpdate(text)
    expect(reports.map((report) => [report.threadId, report.title, report.outcome])).toEqual([
      [first, 'Research', 'stopped'],
      [second, 'Draft “the” email', 'incomplete'],
    ])
    expect(reports[0]!.body).toBe('### Findings\nPartial notes.')
    expect(reports[1]!.body).toBe('Error: Context window exceeded')
  })

  it('keeps an outcome it does not know as written', () => {
    const [report] = parseThreadUpdate(`### Thread “X” failed\nThread id: ${first}\n\n(No reply text.)\n\n### Thread “Y” paused\nThread id: ${second}\n`)
    expect(report!.outcome).toBe('failed')
    expect(parseThreadUpdate(`### Thread “Y” paused\nThread id: ${second}\n`)[0]).toMatchObject({ outcome: 'other', outcomeText: 'paused', body: '' })
  })

  it('finds nothing in an ordinary message', () => {
    expect(parseThreadUpdate('### Thread “X” finished\nno id here')).toEqual([])
    expect(parseThreadUpdate('Hello')).toEqual([])
  })
})

describe('isLongReport', () => {
  it('collapses long or many-line reports', () => {
    expect(isLongReport('short')).toBe(false)
    expect(isLongReport('x'.repeat(601))).toBe(true)
    expect(isLongReport(Array.from({ length: 12 }, () => 'line').join('\n'))).toBe(true)
  })
})
