// @vitest-environment jsdom

import { useEffect, useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from './index'
import { LocaleBoundary } from './LocaleBoundary'
import { ui } from './ui'

describe('LocaleBoundary', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en-US')
  })

  it('applies a locale change without remounting the app', async () => {
    const mounted = vi.fn()

    function StatefulCopy() {
      const [count, setCount] = useState(0)

      useEffect(() => {
        mounted()
      }, [])

      return <button onClick={() => setCount((value) => value + 1)}>{ui('Billing')}: {count}</button>
    }

    render(
      <LocaleBoundary>
        <StatefulCopy />
      </LocaleBoundary>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Billing: 0' }))
    expect(screen.getByRole('button', { name: 'Billing: 1' })).toBeTruthy()

    await act(() => i18n.changeLanguage('es-ES'))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Facturación: 1' })).toBeTruthy()
    })
    expect(mounted).toHaveBeenCalledTimes(1)
  })
})
