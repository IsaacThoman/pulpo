// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CoinFlip } from './CoinFlip'
import { randomFaces, type CoinFace } from './coin-flip'

afterEach(cleanup)

function sequence(...rounds: CoinFace[][]) {
  return vi.fn((count: number) => rounds.shift()!.slice(0, count))
}

describe('CoinFlip', () => {
  it('flips on arrival, flips again on request and keeps a running tally', () => {
    const onSearchWeb = vi.fn()
    render(<CoinFlip coins={1} onSearchWeb={onSearchWeb} flip={sequence(['heads'], ['tails'], ['tails'])} />)
    const result = screen.getByRole('status', { name: 'Result' })
    expect(screen.getByRole('heading', { name: 'Coin flip' })).toBeDefined()
    expect(result.textContent).toBe('Heads')
    expect(screen.queryByText(/over/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Flip again' }))
    expect(result.textContent).toBe('Tails')
    fireEvent.click(screen.getByRole('button', { name: 'Flip again' }))
    expect(screen.getByText('Heads 1 · Tails 2 over 3 flips')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Search the web' }))
    expect(onSearchWeb).toHaveBeenCalledOnce()
  })

  it('summarizes several coins', () => {
    render(<CoinFlip coins={3} onSearchWeb={vi.fn()} flip={sequence(['heads', 'tails', 'heads'], ['tails', 'tails', 'tails'])} />)
    expect(screen.getByRole('heading', { name: 'Flip 3 coins' })).toBeDefined()
    expect(screen.getByRole('status', { name: 'Result' }).textContent).toBe('2 heads · 1 tail')
    fireEvent.click(screen.getByRole('button', { name: 'Flip again' }))
    expect(screen.getByRole('status', { name: 'Result' }).textContent).toBe('0 heads · 3 tails')
    expect(screen.getByText('Heads 2 · Tails 4 over 2 rounds')).toBeDefined()
  })

  it('draws faces from the cryptographic random source', () => {
    const random = vi.spyOn(crypto, 'getRandomValues').mockImplementation(array => {
      (array as Uint8Array).set([2, 7, 255, 0])
      return array
    })
    expect(randomFaces(4)).toEqual(['heads', 'tails', 'tails', 'heads'])
    random.mockRestore()
  })
})
