// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReusableImageControls } from './ReusableImageControls'
import type { ReusableImageFilters } from './reusable-images'

afterEach(cleanup)

describe('reusable image controls', () => {
  it('switches between image modes explicitly and credits Openverse when active', () => {
    const onToggle = vi.fn()
    const onFilters = vi.fn()
    const { rerender } = render(<ReusableImageControls active={false} filters={{}} onToggle={onToggle} onFilters={onFilters} />)
    const modes = within(screen.getByRole('group', { name: 'Image search mode' }))
    expect(modes.getByRole('button', { name: 'All images', pressed: true })).toBeDefined()
    expect(screen.queryByRole('combobox')).toBeNull()
    fireEvent.click(modes.getByRole('button', { name: 'All images' }))
    expect(onToggle).not.toHaveBeenCalled()
    fireEvent.click(modes.getByRole('button', { name: 'Reusable images', pressed: false }))
    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(onFilters).not.toHaveBeenCalled()

    rerender(<ReusableImageControls active filters={{}} onToggle={onToggle} onFilters={onFilters} />)
    expect(modes.getByRole('button', { name: 'Reusable images', pressed: true })).toBeDefined()
    expect(screen.getByRole('link', { name: 'Openverse' }).getAttribute('href')).toBe('https://openverse.org/')
    expect(screen.getByText(/independently, without Openverse endorsement or certification/)).toBeDefined()
    fireEvent.click(modes.getByRole('button', { name: 'All images', pressed: false }))
    expect(onToggle).toHaveBeenCalledTimes(2)
  })

  it('uses labeled selectors that preserve the other choice and returns focus when reset', () => {
    const changes = vi.fn()
    function Fixture() {
      const [filters, setFilters] = useState<ReusableImageFilters>({})
      return <ReusableImageControls active filters={filters} onToggle={vi.fn()} onFilters={next => {
        changes(next)
        setFilters(next)
      }} />
    }
    render(<Fixture />)
    const license = screen.getByRole<HTMLSelectElement>('combobox', { name: 'License' })
    const category = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Image type' })
    expect(screen.queryByRole('button', { name: 'Reset filters' })).toBeNull()
    fireEvent.change(license, { target: { value: 'commercial' } })
    expect(changes).toHaveBeenLastCalledWith({ license: 'commercial' })
    fireEvent.change(category, { target: { value: 'digitized_artwork' } })
    expect(changes).toHaveBeenLastCalledWith({ license: 'commercial', category: 'digitized_artwork' })
    const reset = screen.getByRole('button', { name: 'Reset filters' })
    reset.focus()
    fireEvent.click(reset)
    expect(changes).toHaveBeenLastCalledWith({})
    expect(license.value).toBe('')
    expect(category.value).toBe('')
    expect(document.activeElement).toBe(license)
  })
})
