// @vitest-environment jsdom

import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import i18n from '@/i18n'
import { LocaleBoundary } from '@/i18n/LocaleBoundary'
import { AdminLayout } from './AdminLayout'

describe('AdminLayout localization', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en-US')
  })

  it('updates module-configured navigation when the language changes', async () => {
    await i18n.changeLanguage('es-ES')
    render(
      <MemoryRouter initialEntries={['/admin/users']}>
        <LocaleBoundary>
          <AdminLayout />
        </LocaleBoundary>
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'Usuarios' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Proveedores' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Ajustes' })).toBeTruthy()

    await act(() => i18n.changeLanguage('en-US'))

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Users' })).toBeTruthy()
      expect(screen.getByRole('link', { name: 'Providers' })).toBeTruthy()
      expect(screen.getByRole('link', { name: 'Settings' })).toBeTruthy()
    })
  })
})
