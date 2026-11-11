// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { sentMessageParts, sentMessageReadableText } from './messageReferences'

const PLAN = '11111111-1111-4111-8111-111111111111'
const WORK = '22222222-2222-4222-8222-222222222222'
const plan = { id: PLAN, name: 'Plan.md', folder: false }
const work = { id: WORK, name: 'Work', folder: true }

describe('sentMessageParts', () => {
  it('shows the last paragraph of links as references and the rest in the bubble', () => {
    expect(sentMessageParts('user', `Summarize these\n\n[Plan.md](/files/d/${PLAN}) [Work](/files/f/${WORK})`)).toEqual({ text: 'Summarize these', references: [plan, work] })
  })

  it('leaves a message that only mentions items with no text', () => {
    expect(sentMessageParts('user', `[Plan.md](/files/d/${PLAN})`)).toEqual({ text: '', references: [plan] })
  })

  it('keeps links written within a sentence inline', () => {
    const content = `Compare [Plan.md](/files/d/${PLAN}) with last year’s`
    expect(sentMessageParts('user', content)).toEqual({ text: content, references: [] })
    const mixed = `Notes\n\nSee [Plan.md](/files/d/${PLAN}) first`
    expect(sentMessageParts('user', mixed)).toEqual({ text: mixed, references: [] })
  })

  it('shows replies as written', () => {
    const content = `Done\n\n[Plan.md](/files/d/${PLAN})`
    expect(sentMessageParts('assistant', content)).toEqual({ text: content, references: [] })
  })
})

describe('sentMessageReadableText', () => {
  it('leaves out the reference links, or names the items when that is all there is', () => {
    expect(sentMessageReadableText('user', `Summarize these\n\n[Plan.md](/files/d/${PLAN}) [Work](/files/f/${WORK})`)).toBe('Summarize these')
    expect(sentMessageReadableText('user', `[Plan.md](/files/d/${PLAN}) [Work](/files/f/${WORK})`)).toBe('Plan.md, Work')
  })
})
