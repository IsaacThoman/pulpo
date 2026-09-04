// @vitest-environment jsdom

import { act, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

  it('keeps the tabs in a horizontally scrollable row', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/admin/users']}>
        <AdminLayout />
      </MemoryRouter>,
    )

    const navigation = within(container).getByRole('navigation')
    expect(navigation.className).toContain('min-w-0')
    expect(navigation.className).toContain('overflow-x-auto')
    expect(within(container).getByRole('link', { name: 'Users' }).className).toContain('shrink-0')
  })
})

// These page tests do not exercise the authenticated composer lifecycle.
vi.mock('@/lib/local-first/composer-sync', () => ({ clearWebComposerSync: vi.fn() }))
