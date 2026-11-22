// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), configurable: true })
const storage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value) },
  removeItem: (key: string) => { storage.delete(key) },
})
const { useSettings } = await import('@/stores/settings')
const { ColorThemeSettings } = await import('./ColorThemeSettings')

const empty = () => ({ colors: {}, tokenColors: [] })
const mine = (dark = empty()) => ({ id: 'custom-a', name: 'Mine', light: empty(), dark, css: '' })

function themeFile(json: string, name: string) {
  const file = new File([json], name, { type: 'application/json' })
  // jsdom's File has no text().
  Object.defineProperty(file, 'text', { value: async () => json })
  return file
}

beforeEach(() => {
  useSettings.setState({ theme: 'dark', colorTheme: 'pulpo', customThemes: [], instanceThemes: [] })
})
afterEach(() => cleanup())

describe('color theme settings', () => {
  it('selects an instance theme separately from a personal theme with the same id and can duplicate it', () => {
    const shared = { ...mine({ colors: { 'editor.background': '#112233' }, tokenColors: [] }), name: 'Lagoon' }
    useSettings.setState({ customThemes: [mine()], instanceThemes: [shared] })
    render(<ColorThemeSettings />)
    fireEvent.click(screen.getByRole('button', { name: 'Lagoon Instance theme' }))
    expect(useSettings.getState().colorTheme).toBe('instance:custom-a')
    expect(screen.queryByRole('textbox', { name: 'Theme name' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }))
    expect(useSettings.getState().customThemes[1]).toMatchObject({ name: 'Lagoon copy', dark: shared.dark })
    expect(useSettings.getState().instanceThemes).toEqual([shared])
  })

  it('selects a built-in theme and duplicates it into an editable copy', () => {
    render(<ColorThemeSettings />)
    const picker = screen.getByRole('group', { name: 'Color theme' })
    fireEvent.click(within(picker).getByRole('button', { name: 'Iris' }))
    expect(useSettings.getState().colorTheme).toBe('iris')
    expect(screen.queryByRole('textbox', { name: 'Theme name' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }))
    const [copy] = useSettings.getState().customThemes
    expect(copy).toMatchObject({ name: 'Iris copy', dark: { colors: { 'editor.background': '#1d1929' } } })
    expect(useSettings.getState().colorTheme).toBe(copy!.id)
    expect((screen.getByRole('textbox', { name: 'Theme name' }) as HTMLInputElement).value).toBe('Iris copy')
  })

  it('edits colors for the active appearance, shows VS Code ids, and resets advanced overrides', () => {
    useSettings.setState({ colorTheme: 'custom-a', customThemes: [mine({ colors: { 'editor.background': '#101010', 'list.hoverBackground': '#202020' }, tokenColors: [] })] })
    render(<ColorThemeSettings />)
    expect(screen.getByRole('button', { name: 'Dark' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('textbox', { name: 'Hover' })).toBeNull()
    expect(screen.getByText('1 more color is set in Advanced.')).toBeTruthy()

    fireEvent.change(screen.getByRole('textbox', { name: 'Background' }), { target: { value: '#1d1929' } })
    expect(useSettings.getState().customThemes[0]!.dark.colors['editor.background']).toBe('#1d1929')

    fireEvent.click(screen.getByRole('switch', { name: 'Advanced' }))
    expect(screen.getByText('editor.background')).toBeTruthy()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter colors' }), { target: { value: 'list.hover' } })
    expect(screen.queryByRole('textbox', { name: 'Background' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Reset Hover' }))
    expect(useSettings.getState().customThemes[0]!.dark.colors['list.hoverBackground']).toBeUndefined()
  })

  it('sets temporary chat colors with alpha and code highlighting colors', () => {
    useSettings.setState({ colorTheme: 'custom-a', customThemes: [mine()] })
    render(<ColorThemeSettings />)
    fireEvent.click(screen.getByRole('switch', { name: 'Advanced' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Temporary composer and cards' }), { target: { value: '#ff000033' } })
    expect(useSettings.getState().customThemes[0]!.dark.colors['pulpo.temporaryChatSurface']).toBe('#ff000033')
    fireEvent.change(screen.getByRole('textbox', { name: 'Keywords' }), { target: { value: '#00ff00' } })
    expect(useSettings.getState().customThemes[0]!.dark.tokenColors).toEqual([
      { name: 'pulpo.keyword', scope: ['keyword', 'storage.type', 'storage.modifier'], settings: { foreground: '#00ff00' } },
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Reset Keywords' }))
    expect(useSettings.getState().customThemes[0]!.dark.tokenColors).toEqual([])
  })

  it('keeps unsafe custom CSS out of the saved theme', () => {
    useSettings.setState({ colorTheme: 'custom-a', customThemes: [mine()] })
    render(<ColorThemeSettings />)
    fireEvent.click(screen.getByRole('button', { name: 'Custom CSS' }))
    const css = screen.getByRole('textbox', { name: 'Custom CSS' })
    fireEvent.change(css, { target: { value: '.a { color: red }' } })
    expect(useSettings.getState().customThemes[0]!.css).toBe('.a { color: red }')
    fireEvent.change(css, { target: { value: '.a { background: url(https://example.com/x) }' } })
    expect(screen.getByRole('alert').textContent).toContain('can’t load anything from the internet')
    expect(useSettings.getState().customThemes[0]!.css).toBe('.a { color: red }')
  })

  it('imports a VS Code theme as a new theme and selects it', async () => {
    render(<ColorThemeSettings />)
    const json = '{ "name": "Night Sky", "type": "dark", "colors": { "editor.background": "#011627", }, }'
    fireEvent.change(screen.getByTestId('theme-import'), { target: { files: [themeFile(json, 'night-sky.json')] } })
    await waitFor(() => expect(useSettings.getState().customThemes).toHaveLength(1))
    const [imported] = useSettings.getState().customThemes
    expect(imported).toMatchObject({ name: 'Night Sky', dark: { colors: { 'editor.background': '#011627' } }, light: { colors: {} } })
    expect(useSettings.getState().colorTheme).toBe(imported!.id)
    expect(screen.getAllByRole('status')[0]!.textContent).toBe('Imported “Night Sky” as dark colors. Its light colors are Pulpo’s until you import a light theme into it.')
  })

  it('imports a light VS Code theme into the theme being edited', async () => {
    useSettings.setState({ theme: 'light', colorTheme: 'custom-a', customThemes: [mine({ colors: { 'editor.background': '#000000' }, tokenColors: [] })] })
    render(<ColorThemeSettings />)
    const json = '{ "name": "Paper", "type": "light", "colors": { "editor.background": "#fdf6e3" } }'
    fireEvent.change(screen.getByTestId('theme-editor-import'), { target: { files: [themeFile(json, 'paper.json')] } })
    await waitFor(() => expect(useSettings.getState().customThemes[0]!.light.colors['editor.background']).toBe('#fdf6e3'))
    expect(useSettings.getState().customThemes[0]!.dark.colors['editor.background']).toBe('#000000')
  })

  it('explains files it cannot import', async () => {
    render(<ColorThemeSettings />)
    fireEvent.change(screen.getByTestId('theme-import'), { target: { files: [themeFile('PK...', 'night-owl.vsix')] } })
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('.vsix'))
    expect(useSettings.getState().customThemes).toEqual([])
  })

  it('deletes a custom theme and returns to Pulpo', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    useSettings.setState({ colorTheme: 'custom-a', customThemes: [mine()] })
    render(<ColorThemeSettings />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(useSettings.getState()).toMatchObject({ colorTheme: 'pulpo', customThemes: [] })
  })
})
