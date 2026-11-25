// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Calculator } from './Calculator'

afterEach(cleanup)

describe('Calculator', () => {
  it('edits and chains a result in place, with an explicit web search action', () => {
    const onSearchWeb = vi.fn()
    render(<Calculator initialExpression="18.5% of 249" onSearchWeb={onSearchWeb} />)
    const expression = screen.getByRole<HTMLInputElement>('textbox', { name: 'Expression' })
    const result = screen.getByRole('status', { name: 'Calculation result' })
    expect(result.textContent).toBe('46.065')
    fireEvent.change(expression, { target: { value: '6 * 7' } })
    expect(result.textContent).toBe('42')
    fireEvent.keyDown(expression, { key: '=' })
    expect(expression.value).toBe('42')
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    fireEvent.click(screen.getByRole('button', { name: '8' }))
    expect(result.textContent).toBe('50')
    expect(onSearchWeb).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Search the web' }))
    expect(onSearchWeb).toHaveBeenCalledExactlyOnceWith('42+8')
  })

  it('displays feedback for invalid input and lets the user recover', () => {
    render(<Calculator initialExpression="calculator" onSearchWeb={vi.fn()} />)
    const expression = screen.getByRole('textbox', { name: 'Expression' })
    const copy = screen.getByRole<HTMLButtonElement>('button', { name: 'Copy result' })
    fireEvent.change(expression, { target: { value: '1 / 0' } })
    expect(copy.disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Equals' }))
    expect(expression.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText('Enter a valid expression with a finite result.')).toBeDefined()
    fireEvent.change(expression, { target: { value: '1 / 2' } })
    expect(expression.getAttribute('aria-invalid')).toBeNull()
    expect(screen.getByRole('status', { name: 'Calculation result' }).textContent).toBe('0.5')
  })

  it('opens scientific controls and recalculates when the user changes angle units', () => {
    render(<Calculator initialExpression="scientific calculator" onSearchWeb={vi.fn()} />)
    expect(screen.getByRole('group', { name: 'Scientific keypad' })).toBeDefined()
    const expression = screen.getByRole('textbox', { name: 'Expression' })
    fireEvent.change(expression, { target: { value: 'cos(pi)' } })
    expect(screen.getByRole('status', { name: 'Calculation result' }).textContent).not.toBe('-1')
    fireEvent.click(screen.getByRole('radio', { name: 'Radians' }))
    expect(screen.getByRole('status', { name: 'Calculation result' }).textContent).toBe('-1')
    fireEvent.click(screen.getByRole('button', { name: 'Hide keypad' }))
    expect(screen.queryByRole('group', { name: 'Scientific keypad' })).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Expression' })).toBeDefined()
  })

  it('copies a usable numeric result with a status announcement', async () => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    try {
      render(<Calculator initialExpression="1000 * 1.5" onSearchWeb={vi.fn()} />)
      fireEvent.click(screen.getByRole('button', { name: 'Copy result' }))
      expect(await screen.findByText('Result copied')).toBeDefined()
      expect(writeText).toHaveBeenCalledExactlyOnceWith('1500')
    } finally {
      if (original) Object.defineProperty(navigator, 'clipboard', original)
      else Reflect.deleteProperty(navigator, 'clipboard')
    }
  })
})
