// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { LIVE_FORMATS, liveFormatOfName } from '@pulpo/client-core/office'
import { LIVE_WEB_FORMATS, liveWebFormat } from './registry'
import { officeFileActions } from '../office-file'

describe('combined live format wiring', () => {
  it('opens every catalog format in its own editor and creation menu', () => {
    const formats = LIVE_FORMATS.filter((format) => format.id !== 'markdown')
    expect(LIVE_WEB_FORMATS.map((entry) => entry.format.id).sort()).toEqual(formats.map((format) => format.id).sort())
    for (const entry of LIVE_WEB_FORMATS) {
      expect(liveFormatOfName(entry.newName())?.id).toBe(entry.format.id)
      expect(liveWebFormat({ kind: 'doc', format: entry.format.id })).toBe(entry)
      expect(liveWebFormat({ kind: 'blob', format: null })).toBeNull()
    }
  })

  it('keeps PDF export after Office uploads become live', () => {
    for (const name of ['Report.docx', 'Budget.xlsx', 'Deck.pptx']) {
      expect(officeFileActions({ kind: 'blob', name }, true)).toEqual({ target: null, pdf: true })
      expect(officeFileActions({ kind: 'doc', name }, true)).toEqual({ target: null, pdf: true })
      expect(officeFileActions({ kind: 'doc', name }, false)).toEqual({ target: null, pdf: false })
    }
    expect(officeFileActions({ kind: 'doc', name: 'main.py' }, true).pdf).toBe(false)
    expect(officeFileActions({ kind: 'blob', name: 'Report.doc' }, true)).toEqual({ target: 'docx', pdf: true })
  })
})
