// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import type { LiveAssetStore } from '@pulpo/client-core/office'
import { blankPresentation, presentationCodec, presentationCommands } from '@pulpo/client-core/office/presentation'
import { PresentationController } from '@pulpo/client-core/office/presentation/view'
import { PresentationContextMenu, type ContextMenuRequest } from './PresentationContextMenu'
import { PresentationFindBar } from './PresentationFindBar'
import { PresentationStatusBar } from './PresentationStatusBar'
import { SectionDialog } from './SectionDialog'

const controllers: PresentationController[] = []
afterEach(() => {
  cleanup()
  for (const controller of controllers.splice(0)) controller.destroy()
})

function memoryAssets(): LiveAssetStore {
  const store = new Map<string, Uint8Array>()
  return {
    async put(bytes, mimeType) {
      const hash = `asset-${store.size}`
      store.set(hash, bytes)
      return { hash, mimeType, sizeBytes: bytes.byteLength }
    },
    async get(hash) {
      return store.get(hash)!
    },
  }
}

/** A deck of `texts.length` slides, each with a text box holding that text. */
async function deck(texts: string[]) {
  const doc = new Y.Doc()
  const assets = memoryAssets()
  await presentationCodec.importFile(doc, blankPresentation(), { name: 'deck.pptx', assets })
  const controller = new PresentationController({ doc, assets, readOnly: false, user: { name: 'Ada', color: '#2f6fed' } })
  controllers.push(controller)
  texts.forEach((text, index) => {
    if (index > 0) controller.addSlide()
    presentationCommands.insertShapes(doc, controller.state.slide!, [presentationCommands.textBox({ x: 0, y: 0, cx: 2_000_000, cy: 500_000 }, `Box ${index}`, text)])
  })
  controller.goToSlide(controller.slideKeys()[0]!)
  return controller
}

describe('SectionDialog', () => {
  it('names a new section, PowerPoint style when left empty, and returns focus', async () => {
    const onApply = vi.fn()
    const returnFocus = vi.fn()
    function Host() {
      const [open, setOpen] = useState(true)
      return <SectionDialog open={open} onOpenChange={setOpen} mode="add" onApply={onApply} returnFocus={returnFocus} />
    }
    render(<Host />)
    expect(screen.getByRole('dialog', { name: 'Add section' })).toBeTruthy()
    const name = screen.getByLabelText('Section name')
    expect(document.activeElement).toBe(name)
    fireEvent.submit(name.closest('form')!)
    expect(onApply).toHaveBeenCalledWith('Untitled section')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(returnFocus).toHaveBeenCalled())
  })

  it('renames with the current name filled in; an empty name keeps it', () => {
    const onApply = vi.fn()
    render(<SectionDialog open onOpenChange={() => {}} mode="rename" name="Intro" onApply={onApply} />)
    const name = screen.getByLabelText('Section name') as HTMLInputElement
    expect(name.value).toBe('Intro')
    fireEvent.change(name, { target: { value: '  Overview ' } })
    fireEvent.submit(name.closest('form')!)
    expect(onApply).toHaveBeenLastCalledWith('Overview')
    onApply.mockClear()
    fireEvent.change(name, { target: { value: '   ' } })
    fireEvent.submit(name.closest('form')!)
    expect(onApply).not.toHaveBeenCalled()
  })
})

describe('PresentationContextMenu', () => {
  it('shows the rows it is given at the pointer, runs a command, and hands focus back', async () => {
    const onSelect = vi.fn()
    const returnFocus = vi.fn()
    function Host() {
      const [menu, setMenu] = useState<ContextMenuRequest | undefined>({
        id: 1,
        x: 40,
        y: 60,
        entries: () => [
          { type: 'item', id: 'duplicate', label: 'Duplicate', onSelect },
          { type: 'separator' },
          { type: 'item', id: 'delete', label: 'Delete', disabled: true, onSelect: () => {} },
        ],
        returnFocus,
      })
      return <PresentationContextMenu menu={menu} onClose={() => setMenu(undefined)} />
    }
    render(<Host />)
    const menu = await screen.findByRole('menu')
    expect(menu.getAttribute('data-presentation-context-menu')).toBe('')
    expect(screen.getByRole('menuitem', { name: 'Delete' }).getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    await waitFor(() => expect(returnFocus).toHaveBeenCalled())
  })
})

describe('PresentationFindBar', () => {
  it('counts matches across slides, steps with Enter and Shift+Enter, replaces all, and closes on Escape', async () => {
    const controller = await deck(['Alpha beta', 'beta gamma', 'Beta delta'])
    const onClose = vi.fn()
    render(<PresentationFindBar controller={controller} replace={false} onClose={onClose} />)
    const field = screen.getByRole('textbox', { name: 'Find in presentation' })
    expect(document.activeElement).toBe(field)
    fireEvent.change(field, { target: { value: 'beta' } })
    const status = () => document.querySelector('[data-find-status]')!.textContent
    expect(status()).toBe('1 of 3')
    expect(controller.state.slide).toBe(controller.slideKeys()[0])
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(status()).toBe('2 of 3')
    expect(controller.state.slide).toBe(controller.slideKeys()[1])
    fireEvent.keyDown(field, { key: 'Enter', shiftKey: true })
    expect(status()).toBe('1 of 3')
    // Match case narrows it.
    fireEvent.click(screen.getByRole('button', { name: 'Match case' }))
    expect(status()).toBe('1 of 2')
    fireEvent.click(screen.getByRole('button', { name: 'Match case' }))
    // Replace all, as one undo step.
    fireEvent.click(screen.getByRole('button', { name: 'Replace', pressed: false }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Replace with' }), { target: { value: 'zeta' } })
    fireEvent.click(screen.getByRole('button', { name: 'Replace all' }))
    expect(status()).toBe('Replaced 3')
    expect(controller.find('beta')).toHaveLength(0)
    await act(async () => { await Promise.resolve() })
    expect(controller.find('zeta')).toHaveLength(3)
    controller.undo()
    expect(controller.find('beta')).toHaveLength(3)
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onClose.mock.calls[0]![0]).toMatchObject({ text: expect.stringMatching(/beta/i) })
  })

  it('offers no replacing to viewers', async () => {
    const controller = await deck(['Alpha'])
    controller.setReadOnly(true)
    render(<PresentationFindBar controller={controller} replace onClose={() => {}} />)
    expect(screen.queryByRole('textbox', { name: 'Replace with' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Replace all' })).toBeNull()
  })
})

describe('PresentationStatusBar', () => {
  it('reads "Slide n of m", toggles the notes, and zooms to fit', async () => {
    const controller = await deck(['One', 'Two', 'Three'])
    controller.goToSlide(controller.slideKeys()[1]!)
    const onNotesChange = vi.fn()
    const onZoom = vi.fn()
    render(<PresentationStatusBar controller={controller} view="editor" notesOpen onNotesChange={onNotesChange} zoom={{ zoom: 1.5, fit: false }} onZoom={onZoom} />)
    expect(document.querySelector('[data-slide-counter]')!.textContent).toBe('Slide 2 of 3')
    const notes = screen.getByRole('button', { name: 'Notes' })
    expect(notes.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(notes)
    expect(onNotesChange).toHaveBeenCalledWith(false)
    expect(document.querySelector('[data-presentation-zoom]')!.textContent).toBe('150%')
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(onZoom).toHaveBeenLastCalledWith(1.6)
  })

  it('counts the selected slides in the sorter', async () => {
    const controller = await deck(['One', 'Two', 'Three'])
    controller.selectAllSlides()
    render(<PresentationStatusBar controller={controller} view="sorter" notesOpen onNotesChange={() => {}} zoom={{ zoom: 1, fit: true }} onZoom={() => {}} />)
    expect(document.querySelector('[data-slide-counter]')!.textContent).toBe('3 slides selected')
    expect(screen.queryByRole('button', { name: 'Notes' })).toBeNull()
  })
})
