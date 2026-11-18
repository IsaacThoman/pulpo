// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), configurable: true })
const { useSettings } = await import('@/stores/settings')
const { ColorThemeSettings } = await import('./ColorThemeSettings')

beforeEach(() => {
  useSettings.setState({ theme: 'dark', colorTheme: 'pulpo', customThemes: [] })
})
afterEach(() => cleanup())

describe('color theme settings', () => {
  it('selects a built-in theme and duplicates it into an editable copy', () => {
    render(<ColorThemeSettings />)
    const picker = screen.getByRole('group', { name: 'Color theme' })
    fireEvent.click(within(picker).getByRole('button', { name: 'Iris' }))
    expect(useSettings.getState().colorTheme).toBe('iris')
    expect(screen.queryByRole('textbox', { name: 'Theme name' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }))
    const [copy] = useSettings.getState().customThemes
    expect(copy).toMatchObject({ name: 'Iris copy', dark: { background: '#1d1929' } })
    expect(useSettings.getState().colorTheme).toBe(copy!.id)
    expect((screen.getByRole('textbox', { name: 'Theme name' }) as HTMLInputElement).value).toBe('Iris copy')
  })

  it('edits colors for the active appearance and resets advanced overrides', () => {
    useSettings.setState({ colorTheme: 'custom-a', customThemes: [{ id: 'custom-a', name: 'Mine', light: {}, dark: { background: '#101010', hover: '#202020' }, css: '' }] })
    render(<ColorThemeSettings />)
    expect(screen.getByRole('button', { name: 'Dark' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('textbox', { name: 'Hover' })).toBeNull()
    expect(screen.getByText('1 more color is set in Advanced.')).toBeTruthy()

    fireEvent.change(screen.getByRole('textbox', { name: 'Background' }), { target: { value: '#1d1929' } })
    expect(useSettings.getState().customThemes[0]!.dark.background).toBe('#1d1929')

    fireEvent.click(screen.getByRole('switch', { name: 'Advanced' }))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter colors' }), { target: { value: 'hov' } })
    expect(screen.queryByRole('textbox', { name: 'Background' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Reset Hover' }))
    expect(useSettings.getState().customThemes[0]!.dark.hover).toBeUndefined()
  })

  it('keeps unsafe custom CSS out of the saved theme', () => {
    useSettings.setState({ colorTheme: 'custom-a', customThemes: [{ id: 'custom-a', name: 'Mine', light: {}, dark: {}, css: '' }] })
    render(<ColorThemeSettings />)
    fireEvent.click(screen.getByRole('button', { name: 'Custom CSS' }))
    const css = screen.getByRole('textbox', { name: 'Custom CSS' })
    fireEvent.change(css, { target: { value: '.a { color: red }' } })
    expect(useSettings.getState().customThemes[0]!.css).toBe('.a { color: red }')
    fireEvent.change(css, { target: { value: '.a { background: url(https://example.com/x) }' } })
    expect(screen.getByRole('alert').textContent).toContain('can’t load anything from the internet')
    expect(useSettings.getState().customThemes[0]!.css).toBe('.a { color: red }')
  })

  it('imports a theme file and selects it', async () => {
    render(<ColorThemeSettings />)
    const json = JSON.stringify({ kind: 'pulpo-theme', version: 1, name: 'Shared', dark: { action: '#00ff00' } })
    const file = new File([json], 'shared.pulpo-theme.json', { type: 'application/json' })
    // jsdom's File has no text().
    Object.defineProperty(file, 'text', { value: async () => json })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(useSettings.getState().customThemes).toHaveLength(1))
    expect(useSettings.getState().customThemes[0]).toMatchObject({ name: 'Shared', dark: { action: '#00ff00' } })
    expect(useSettings.getState().colorTheme).toBe(useSettings.getState().customThemes[0]!.id)
    expect(screen.getByRole('status').textContent).toBe('Imported “Shared”.')
  })

  it('deletes a custom theme and returns to Pulpo', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    useSettings.setState({ colorTheme: 'custom-a', customThemes: [{ id: 'custom-a', name: 'Mine', light: {}, dark: {}, css: '' }] })
    render(<ColorThemeSettings />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(useSettings.getState()).toMatchObject({ colorTheme: 'pulpo', customThemes: [] })
  })
})
