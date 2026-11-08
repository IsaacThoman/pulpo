// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseFontSize } from './font-size'
import { FontSizeInput } from './FontSizeInput'
import { LinkDialog } from './LinkDialog'
import { ShortcutsDialog } from './ShortcutsDialog'
import { steppedZoom } from './zoom'
import { ZoomControl } from './ZoomControl'

afterEach(cleanup)

describe('LinkDialog', () => {
  it('asks for the text when it can use it, normalizes the link, and applies on Enter', async () => {
    const onApply = vi.fn()
    const returnFocus = vi.fn()
    function Host() {
      const [open, setOpen] = useState(true)
      return <LinkDialog open={open} onOpenChange={setOpen} showText onApply={onApply} returnFocus={returnFocus} />
    }
    render(<Host />)
    expect(screen.getByRole('dialog', { name: 'Insert link' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Text to display'), { target: { value: ' Pulpo ' } })
    const link = screen.getByLabelText('Link')
    expect(document.activeElement).toBe(link)
    fireEvent.change(link, { target: { value: 'pulpo.baby' } })
    fireEvent.submit(link.closest('form')!)
    expect(onApply).toHaveBeenCalledWith({ text: 'Pulpo', url: 'https://pulpo.baby' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(returnFocus).toHaveBeenCalled())
  })

  it('explains a link it refuses and keeps the dialog open', () => {
    const onApply = vi.fn()
    render(<LinkDialog open onOpenChange={() => {}} onApply={onApply} />)
    expect(screen.queryByLabelText('Text to display')).toBeNull()
    const link = screen.getByLabelText('Link')
    fireEvent.change(link, { target: { value: 'javascript:alert(1)' } })
    fireEvent.submit(link.closest('form')!)
    expect(onApply).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toBe('Links can start with http://, https://, mailto:, or tel:.')
    expect(link.getAttribute('aria-invalid')).toBe('true')
    fireEvent.change(link, { target: { value: 'example.com' } })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('edits an existing link, accepts editor targets, and removes the link', () => {
    const onApply = vi.fn()
    const onRemove = vi.fn()
    const view = render(<LinkDialog open onOpenChange={() => {}} editing url="https://old.example" accept={(value) => value.includes('!') ? value : undefined} onApply={onApply} onRemove={onRemove} />)
    expect(screen.getByRole('dialog', { name: 'Edit link' })).toBeTruthy()
    const link = screen.getByLabelText('Link') as HTMLInputElement
    expect(link.value).toBe('https://old.example')
    fireEvent.change(link, { target: { value: 'Sheet2!B4' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onApply).toHaveBeenCalledWith({ text: '', url: 'Sheet2!B4' })
    view.rerender(<LinkDialog open onOpenChange={() => {}} editing url="https://old.example" onApply={onApply} onRemove={onRemove} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove link' }))
    expect(onRemove).toHaveBeenCalledOnce()
  })
})

describe('FontSizeInput', () => {
  it('applies a typed size on Enter, restores on Escape, and steps by one point', () => {
    const onChange = vi.fn()
    const onDone = vi.fn()
    const view = render(<FontSizeInput value={11} onChange={onChange} onDone={onDone} />)
    const input = screen.getByRole('textbox', { name: 'Font size' }) as HTMLInputElement
    expect(input.value).toBe('11')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '13,5' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenLastCalledWith(13.5)
    expect(onDone).toHaveBeenCalledTimes(1)
    fireEvent.change(input, { target: { value: '500' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(input.value).toBe('11')
    fireEvent.change(input, { target: { value: '30' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input.value).toBe('11')
    expect(onChange).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Increase font size' }))
    expect(onChange).toHaveBeenLastCalledWith(12)
    fireEvent.click(screen.getByRole('button', { name: 'Decrease font size' }))
    expect(onChange).toHaveBeenLastCalledWith(10)
    view.rerender(<FontSizeInput value={null} onChange={onChange} onStep={onChange} />)
    expect(input.value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Increase font size' }))
    expect(onChange).toHaveBeenLastCalledWith(1)
  })

  it('picks a preset from its list', async () => {
    const onChange = vi.fn()
    render(<FontSizeInput value={11} onChange={onChange} />)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Font sizes' }), { key: 'Enter' })
    const current = await screen.findByRole('menuitemradio', { name: '11' })
    expect(current.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('menuitemradio', { name: '24' }))
    expect(onChange).toHaveBeenCalledWith(24)
  })

  it('parses sizes within 1 to 400 points', () => {
    expect(parseFontSize('12')).toBe(12)
    expect(parseFontSize(' 10.5 ')).toBe(10.5)
    expect(parseFontSize('400')).toBe(400)
    for (const text of ['', '0', '401', 'abc', '-3']) expect(parseFontSize(text)).toBeNull()
  })
})

describe('ZoomControl', () => {
  it('zooms out and in by steps, picks presets and Fit, and keeps its labels', async () => {
    const onZoom = vi.fn()
    const onFit = vi.fn()
    const view = render(<ZoomControl zoom={1} onZoom={onZoom} onFit={onFit} valueProps={{ 'data-docx-zoom': '' }} />)
    expect(view.container.querySelector('[data-docx-zoom]')?.textContent).toBe('100%')
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(onZoom).toHaveBeenLastCalledWith(1.1)
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    expect(onZoom).toHaveBeenLastCalledWith(0.9)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Zoom' }), { key: 'Enter' })
    expect((await screen.findByRole('menuitemradio', { name: '100%' })).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('menuitemradio', { name: '150%' }))
    expect(onZoom).toHaveBeenLastCalledWith(1.5)
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    view.rerender(<ZoomControl zoom={0.83} fitted onZoom={onZoom} onFit={onFit} compact />)
    expect(screen.getByRole('button', { name: 'Zoom' }).textContent).toBe('Fit')
    fireEvent.keyDown(screen.getByRole('button', { name: 'Zoom' }), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Fit' }))
    expect(onFit).toHaveBeenCalledOnce()
  })

  it('tells screen readers the zoom without renaming its buttons', () => {
    function Host() {
      const [zoom, setZoom] = useState(1)
      return <ZoomControl zoom={zoom} onZoom={setZoom} />
    }
    const view = render(<Host />)
    const zoom = screen.getByRole('button', { name: 'Zoom' })
    expect(zoom.getAttribute('aria-describedby')).toBeTruthy()
    expect(document.getElementById(zoom.getAttribute('aria-describedby')!)?.textContent).toBe('100%')
    for (const name of ['Zoom out', 'Zoom in']) {
      expect(screen.getByRole('button', { name }).getAttribute('aria-describedby')).toBe(zoom.getAttribute('aria-describedby'))
    }
    const announcement = view.container.querySelector('[aria-live="polite"]')!
    expect(announcement.textContent).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(announcement.textContent).toBe('110%')
    expect(document.getElementById(zoom.getAttribute('aria-describedby')!)?.textContent).toBe('110%')
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    expect(announcement.textContent).toBe('90%')
  })

  it('stays within its bounds on whole percents', () => {
    expect(steppedZoom(0.75, -1)).toBe(0.65)
    expect(steppedZoom(0.3, -1)).toBe(0.25)
    expect(steppedZoom(3.95, 1)).toBe(4)
    expect(steppedZoom(1, 1, { step: 0.25 })).toBe(1.25)
  })
})

describe('ShortcutsDialog', () => {
  it('lists grouped shortcuts in the platform style and filters them as you type', () => {
    const groups = vi.fn(() => [
      { id: 'text', title: 'Text formatting', items: [{ label: 'Bold', keys: [{ key: 'b', mod: true }] }, { label: 'Subíndice', keys: [{ key: ',', mod: true }] }] },
      { id: 'cells', title: 'Cells', items: [{ label: 'Delete the selected cells', keys: ['D, D'] }] },
    ])
    render(<ShortcutsDialog open onOpenChange={() => {}} groups={groups} />)
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy()
    const bold = screen.getByText('Bold').closest('div')!
    expect(bold.querySelector('kbd')?.textContent).toMatch(/^(⌘B|Ctrl\+B)$/)
    expect(screen.getByText('D, D')).toBeTruthy()
    const search = screen.getByRole('searchbox', { name: 'Search shortcuts' })
    fireEvent.change(search, { target: { value: 'subindice' } })
    expect(screen.queryByText('Bold')).toBeNull()
    expect(screen.getByText('Subíndice')).toBeTruthy()
    fireEvent.change(search, { target: { value: 'cells delete' } })
    expect(screen.getByRole('region', { name: 'Cells' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Text formatting' })).toBeNull()
    fireEvent.change(search, { target: { value: 'nothing like it' } })
    expect(screen.getByText('No shortcuts match “nothing like it”')).toBeTruthy()
  })
})
