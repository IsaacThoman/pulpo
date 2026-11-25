// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UnitConversion } from './UnitConversion'

afterEach(cleanup)

describe('unit conversion card', () => {
  it('updates locally and commits the edited amount and units on Apply', () => {
    const onConvert = vi.fn()
    render(<UnitConversion initialConversion={{ amount: '5', from: 'mi', to: 'km' }} onConvert={onConvert} onSearchWeb={vi.fn()} />)

    const result = screen.getByLabelText('Conversion result')
    expect(result.textContent).toBe('8.04672 km')
    const amount = screen.getByRole('textbox', { name: 'Amount' })
    const from = screen.getByRole<HTMLSelectElement>('combobox', { name: 'From unit' })
    const to = screen.getByRole<HTMLSelectElement>('combobox', { name: 'To unit' })
    expect(within(to).queryByRole('option', { name: 'kg' })).toBeNull()

    fireEvent.change(amount, { target: { value: '12' } })
    fireEvent.change(from, { target: { value: 'in' } })
    fireEvent.change(to, { target: { value: 'ft' } })
    expect(result.textContent).toBe('1 ft')
    expect(onConvert).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onConvert).toHaveBeenCalledExactlyOnceWith('12 in to ft')
  })

  it('swaps affine units and carries the valid draft to an explicit web search', () => {
    const onSearchWeb = vi.fn()
    render(<UnitConversion initialConversion={{ amount: '32', from: 'f', to: 'c' }} onConvert={vi.fn()} onSearchWeb={onSearchWeb} />)
    expect(screen.getByLabelText('Conversion result').textContent).toBe('0 °C')

    fireEvent.click(screen.getByRole('button', { name: 'Swap units' }))
    expect(screen.getByLabelText('Conversion result').textContent).toBe('89.6 °F')
    const searchWeb = screen.getByRole<HTMLButtonElement>('button', { name: 'Search the web' })
    const amount = screen.getByRole('textbox', { name: 'Amount' })
    fireEvent.change(amount, { target: { value: 'invalid' } })
    expect(searchWeb.disabled).toBe(true)
    expect(amount.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByLabelText('Conversion result').textContent).toBe('—')

    fireEvent.change(amount, { target: { value: '-40' } })
    fireEvent.click(searchWeb)
    expect(onSearchWeb).toHaveBeenCalledExactlyOnceWith('-40 c to f')
  })
})
