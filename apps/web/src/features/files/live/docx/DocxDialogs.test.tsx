// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ParagraphFormat } from '@pulpo/client-core/office/docx/view'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PageSetupDialog, type PageSetupState } from './PageSetupDialog'
import { ParagraphDialog } from './ParagraphDialog'
import { WordCountDialog } from './WordCountDialog'

afterEach(cleanup)

const LETTER: PageSetupState = {
  width: 612, height: 792, orientation: 'portrait',
  margins: { top: 72, bottom: 72, left: 72, right: 72, header: 36, footer: 36, gutter: 0 },
  section: 0, sections: 1,
}

const FORMAT: ParagraphFormat = {
  alignment: 'left',
  indent: { left: 0, right: 0, firstLine: 0, hanging: 0 },
  spacing: { before: 0, after: 8, beforeAuto: false, afterAuto: false, line: { multiple: 1.15 } },
  keepNext: false, keepLines: false, pageBreakBefore: false, widowControl: true, border: 'none',
}

describe('PageSetupDialog', () => {
  it('applies orientation and margins in points, then hands focus back', async () => {
    const onApply = vi.fn(() => true)
    const returnFocus = vi.fn()
    function Host() {
      const [open, setOpen] = useState(true)
      return <PageSetupDialog open={open} onOpenChange={setOpen} setup={LETTER} unit="in" suggesting={false} onApply={onApply} returnFocus={returnFocus} />
    }
    render(<Host />)
    expect(screen.getByRole('dialog', { name: 'Page setup' })).toBeTruthy()
    // One section: nothing to choose between.
    expect(screen.queryByText('Apply to')).toBeNull()
    expect((screen.getByLabelText('Top margin') as HTMLInputElement).value).toBe('1')
    fireEvent.click(screen.getByRole('radio', { name: 'Landscape' }))
    fireEvent.change(screen.getByLabelText('Left margin'), { target: { value: '1.27 cm' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onApply).toHaveBeenCalledWith({ orientation: 'landscape', margins: { top: 72, bottom: 72, left: 36, right: 72 } }, 'document')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(returnFocus).toHaveBeenCalled())
  })

  it('applies only what changed, so other sections keep their own paper and margins', () => {
    const onApply = vi.fn(() => true)
    const onOpenChange = vi.fn()
    const { rerender } = render(<PageSetupDialog open onOpenChange={onOpenChange} setup={{ ...LETTER, sections: 3 }} unit="in" suggesting={false} onApply={onApply} />)
    // Nothing changed: the dialog closes without an undo step.
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onApply).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
    rerender(<PageSetupDialog open onOpenChange={onOpenChange} setup={{ ...LETTER, sections: 3 }} unit="in" suggesting={false} onApply={onApply} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Landscape' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onApply).toHaveBeenLastCalledWith({ orientation: 'landscape' }, 'document')
  })

  it('says why margins are refused and stays open', () => {
    const onApply = vi.fn(() => false)
    render(<PageSetupDialog open onOpenChange={() => {}} setup={LETTER} unit="in" suggesting={false} onApply={onApply} />)
    fireEvent.change(screen.getByLabelText('Bottom margin'), { target: { value: 'deep' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onApply).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toBe('Enter a margin of 0 or more.')
    expect(screen.getByLabelText('Bottom margin').getAttribute('aria-invalid')).toBe('true')
    fireEvent.change(screen.getByLabelText('Bottom margin'), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(screen.getByRole('alert').textContent).toBe('These margins leave no room for text on this paper size.')
  })

  it('explains that suggestions cannot change the page, and changes nothing', () => {
    render(<PageSetupDialog open onOpenChange={() => {}} setup={{ ...LETTER, sections: 2 }} unit="cm" suggesting onApply={vi.fn()} />)
    expect(screen.getByText("Page setup can't be suggested. Switch to Editing to change it.")).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull()
    // The fieldset disables every field.
    expect(screen.getByLabelText('Top margin').matches(':disabled')).toBe(true)
    expect((screen.getByLabelText('Top margin') as HTMLInputElement).value).toBe('2.54')
    expect(screen.getByText('Apply to')).toBeTruthy()
  })
})

describe('ParagraphDialog', () => {
  it('starts in the left indent and applies only what changed', async () => {
    const onApply = vi.fn()
    render(<ParagraphDialog open onOpenChange={() => {}} format={FORMAT} unit="in" onApply={onApply} />)
    expect(screen.getByRole('dialog', { name: 'Paragraph' })).toBeTruthy()
    const left = screen.getByLabelText('Left indent (in)')
    expect(document.activeElement).toBe(left)
    fireEvent.change(left, { target: { value: '0.5' } })
    fireEvent.change(screen.getByLabelText('Before (pt)'), { target: { value: '6' } })
    fireEvent.submit(left.closest('form')!)
    expect(onApply).toHaveBeenCalledWith({ indent: { left: 36 }, spacing: { before: 6 } })
  })

  it('shows an error by the field it refuses', () => {
    const onApply = vi.fn()
    render(<ParagraphDialog open onOpenChange={() => {}} format={FORMAT} unit="in" focus="spacing" onApply={onApply} />)
    expect(document.activeElement).toBe(screen.getByLabelText('Before (pt)'))
    fireEvent.change(screen.getByLabelText('After (pt)'), { target: { value: 'lots' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onApply).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toBe('Enter a number of points from 0 to 1584.')
    expect(screen.getByLabelText('After (pt)').getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id)
  })
})

describe('WordCountDialog', () => {
  it('counts the document and the selection, and switches the live count', () => {
    const onShow = vi.fn()
    render(
      <WordCountDialog
        open
        onOpenChange={() => {}}
        counts={{ document: { words: 1234, characters: 5000, charactersWithSpaces: 6200, paragraphs: 40 }, selection: { words: 12, characters: 50, charactersWithSpaces: 61, paragraphs: 1 }, pages: 4 }}
        showWhileTyping
        onShowWhileTypingChange={onShow}
      />,
    )
    const dialog = screen.getByRole('dialog', { name: 'Word count' })
    const cell = (row: string, column: string) => dialog.querySelector(`[data-count="${row}"] [data-column="${column}"]`)?.textContent
    expect(cell('words', 'document')).toBe('1,234')
    expect(cell('words', 'selection')).toBe('12')
    expect(cell('pages', 'document')).toBe('4')
    expect(cell('pages', 'selection')).toBe('—')
    expect(cell('characters-no-spaces', 'document')).toBe('5,000')
    expect(screen.getByRole('columnheader', { name: 'Selection' })).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Display word count while typing' }))
    expect(onShow).toHaveBeenCalledWith(false)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'OK' }))
  })

  it('leaves out the selection column and pages it does not have', () => {
    render(<WordCountDialog open onOpenChange={() => {}} counts={{ document: { words: 1, characters: 4, charactersWithSpaces: 4, paragraphs: 1 }, selection: null }} showWhileTyping={false} onShowWhileTypingChange={() => {}} />)
    expect(document.querySelector('[data-column="selection"]')).toBeNull()
    expect(document.querySelector('[data-count="pages"]')).toBeNull()
  })
})
