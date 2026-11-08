import { describe, expect, it } from 'vitest'
import { wantsContextMenu } from './docx-context'
import { headerFooterName, wordCountLabel } from './docx-names'
import { shortLink } from './link-targets'

describe('status and labels', () => {
  it('counts words as Docs does, with the selection out of the document', () => {
    expect(wordCountLabel(1, null)).toBe('1 word')
    expect(wordCountLabel(1234, null)).toBe('1,234 words')
    expect(wordCountLabel(345, 12)).toBe('12 of 345 words')
    expect(wordCountLabel(345, 0)).toBe('345 words')
  })

  it('names headers and footers by type', () => {
    expect(headerFooterName('header', 'default', false)).toBe('Header')
    expect(headerFooterName('header', 'default', true)).toBe('Odd page header')
    expect(headerFooterName('footer', 'first', false)).toBe('First page footer')
    expect(headerFooterName('footer', 'even', true)).toBe('Even page footer')
  })

  it('shortens links for the link bubble', () => {
    expect(shortLink('https://www.example.com/docs/')).toBe('example.com/docs')
    expect(shortLink('mailto:ada@example.com')).toBe('ada@example.com')
  })

  it('opens its own right-click menu only over tables, pictures, links, and comments', () => {
    const base = { pos: 1, storyId: null, inSelection: false, editable: true, table: false, picture: null, link: null, comments: [], revisions: [] }
    expect(wantsContextMenu(null)).toBe(false)
    expect(wantsContextMenu(base)).toBe(false)
    expect(wantsContextMenu({ ...base, table: true })).toBe(true)
    expect(wantsContextMenu({ ...base, picture: { pos: 3, description: '' } })).toBe(true)
    expect(wantsContextMenu({ ...base, comments: ['1'] })).toBe(true)
    expect(wantsContextMenu({ ...base, link: { from: 1, to: 4, href: 'https://example.com', anchor: null, text: 'abc' } })).toBe(true)
  })
})
