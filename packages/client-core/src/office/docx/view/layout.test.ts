import { describe, expect, it } from 'vitest'
import { PAGE_GAP, layoutPages, pageSetup, type LayoutUnit, type PageSetup } from './layout.js'

// A page with a 100px text area: 200px tall with 50px margins.
const setup: PageSetup = { ...pageSetup(undefined), height: 200, top: 50, bottom: 50 }
const pitch = 100 + 50 + PAGE_GAP + 50

/** Paragraphs of `lines` lines, 20px each, laid out one after another. */
function paragraphs(...lines: number[]): LayoutUnit[] {
  const units: LayoutUnit[] = []
  let top = 0
  lines.forEach((count, block) => {
    for (let line = 0; line < count; line++) {
      units.push({ top, bottom: top + 20, block, kind: 'line', line, lines: count, widowControl: true, section: 0 })
      top += 20
    }
  })
  return units
}

describe('layoutPages', () => {
  it('keeps content that fits on one page', () => {
    const result = layoutPages(paragraphs(2, 3), { sections: [setup] })
    expect(result.pages).toHaveLength(1)
    expect(result.breaks).toEqual([])
  })

  it('breaks between lines and moves the rest to the next text area', () => {
    const result = layoutPages(paragraphs(8), { sections: [setup] })
    expect(result.pages).toHaveLength(2)
    expect(result.breaks).toEqual([{ unit: 5, height: pitch - 100, page: 1 }])
    expect(result.pages[1]!.contentTop).toBe(pitch)
  })

  it('avoids orphans and widows', () => {
    // 4 lines fill 80px; a 3-line paragraph would leave its first line alone.
    const orphan = layoutPages(paragraphs(4, 3), { sections: [setup] })
    expect(orphan.breaks[0]!.unit).toBe(4)
    // A 6-line paragraph would leave its last line alone on the next page.
    const widow = layoutPages(paragraphs(6), { sections: [setup] })
    expect(widow.breaks[0]!.unit).toBe(4)
  })

  it('keeps headings with the next paragraph and honors page breaks', () => {
    const units = paragraphs(4, 1, 2)
    units[4]!.keepNext = true
    const result = layoutPages(units, { sections: [setup] })
    expect(result.breaks[0]!.unit).toBe(4)
    const forced = paragraphs(1, 1)
    forced[1]!.breakBefore = true
    expect(layoutPages(forced, { sections: [setup] }).pages).toHaveLength(2)
  })

  it('starts sections on new pages, with their own setup and numbering', () => {
    const units = paragraphs(1, 1)
    units[1]!.section = 1
    const landscape: PageSetup = { ...setup, width: 300, numberStart: 1, start: 'oddPage' }
    const result = layoutPages(units, { sections: [setup, landscape] })
    // Page 1, then a blank even page 2? No: the new section restarts at 1, which is odd.
    expect(result.pages.map((page) => [page.section, page.number])).toEqual([[0, 1], [1, 1]])
    const even = layoutPages(units, { sections: [setup, { ...landscape, start: 'evenPage' }] })
    expect(even.pages.map((page) => page.number)).toEqual([1, 1, 2])
    const continuous = layoutPages(units, { sections: [setup, { ...landscape, start: 'continuous' }] })
    expect(continuous.pages).toHaveLength(1)
  })

  it('makes room for footnotes on the page that references them', () => {
    const units = paragraphs(4, 1)
    units[1]!.notes = ['footnote:1']
    const result = layoutPages(units, { sections: [setup], noteHeight: () => 30, noteSeparator: 10 })
    expect(result.pages[0]!.notes).toEqual(['footnote:1'])
    // 40px of notes leave room for three lines; the paragraph's last two move on together.
    expect(result.breaks[0]!.unit).toBe(2)
    expect(result.pages[1]!.notes).toEqual([])
  })

  it('terminates on units taller than a page', () => {
    const units: LayoutUnit[] = [{ top: 0, bottom: 500, block: 0, kind: 'block', section: 0 }, { top: 500, bottom: 520, block: 1, kind: 'block', section: 0 }]
    const result = layoutPages(units, { sections: [setup] })
    expect(result.pages).toHaveLength(2)
  })

  it('lays out a hundred pages quickly', () => {
    const units = paragraphs(...Array.from({ length: 3000 }, () => 3))
    const started = performance.now()
    const result = layoutPages(units, { sections: [setup] })
    expect(result.pages.length).toBeGreaterThan(100)
    expect(performance.now() - started).toBeLessThan(200)
  })
})
