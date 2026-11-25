// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { useRef, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadPreferences } from './preferences'
import { matchRecentQueries, useRecentQueries } from './recent-queries'
import { SearchBox } from './SearchBox'

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

describe('recent searches', () => {
  it('starts off and keeps queries private to the signed-in browser account', () => {
    expect(loadPreferences().rememberRecentQueries).toBe(false)
    const { result, rerender } = renderHook(({ account, enabled }: { account?: string; enabled: boolean }) =>
      useRecentQueries(account, enabled), { initialProps: { account: 'first' as string | undefined, enabled: false } })

    act(() => result.current.rememberQuery('ignored'))
    expect(result.current.recentQueries).toEqual([])
    rerender({ account: 'first', enabled: true })
    act(() => result.current.rememberQuery('browser storage'))
    act(() => result.current.rememberQuery('Browser storage'))
    expect(result.current.recentQueries).toEqual(['Browser storage'])

    rerender({ account: 'second', enabled: true })
    expect(result.current.recentQueries).toEqual([])
    act(() => result.current.rememberQuery('second account only'))
    rerender({ account: undefined, enabled: true })
    expect(result.current.recentQueries).toEqual([])
    rerender({ account: 'first', enabled: true })
    expect(result.current.recentQueries).toEqual(['Browser storage'])
  })

  it('clears history immediately and on disable', () => {
    const { result, rerender, unmount } = renderHook(({ enabled }) =>
      useRecentQueries('tester', enabled), { initialProps: { enabled: true } })

    act(() => result.current.rememberQuery('containers'))
    act(() => result.current.clearRecentQueries())
    expect(result.current.recentQueries).toEqual([])
    act(() => result.current.rememberQuery('privacy'))
    rerender({ enabled: false })
    expect(result.current.recentQueries).toEqual([])
    rerender({ enabled: true })
    expect(result.current.recentQueries).toEqual([])
    unmount()
    expect(renderHook(() => useRecentQueries('tester', true)).result.current.recentQueries).toEqual([])
  })

  it('shows up to six prefix matches and skips the exact input', () => {
    const queries = ['CSS', 'cSS grid', ...Array.from({ length: 8 }, (_, index) => 'css ' + index), 'headphones']
    expect(matchRecentQueries(queries, ' css ')).toEqual(['cSS grid', 'css 0', 'css 1', 'css 2', 'css 3', 'css 4'])
    expect(matchRecentQueries(queries, 'head')).toEqual(['headphones'])
  })

  it('supports keyboard selection and keeps named bang suggestions distinct', () => {
    const onSearch = vi.fn()
    function Harness() {
      const [value, setValue] = useState('')
      const input = useRef<HTMLInputElement>(null)
      return <SearchBox value={value} setValue={setValue} onSearch={onSearch} customBangs={[]}
        recentQueries={['CSS grid', 'CSS flexbox']} input={input} />
    }
    render(<Harness />)
    const input = screen.getByRole('combobox', { name: 'Search the web' })
    fireEvent.focus(input)
    expect(screen.getByRole('listbox', { name: 'Recent searches' })).toBeDefined()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    const option = screen.getByRole('option', { name: 'CSS flexbox' })
    expect(option.getAttribute('aria-selected')).toBe('true')
    expect(input.getAttribute('aria-activedescendant')).toBe(option.id)
    fireEvent.submit(screen.getByRole('search'))
    expect(onSearch).toHaveBeenCalledExactlyOnceWith('CSS flexbox')

    fireEvent.change(input, { target: { value: '!w' } })
    expect(screen.queryByRole('listbox', { name: 'Recent searches' })).toBeNull()
    fireEvent.click(screen.getByRole('option', { name: '!w Wikipedia' }))
    expect((input as HTMLInputElement).value).toBe('!w ')
    expect(onSearch).toHaveBeenCalledOnce()
  })
})
