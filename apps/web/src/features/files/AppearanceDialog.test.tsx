// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FileNode } from '@pulpo/contracts'
import { AppearanceDialog } from './AppearanceDialog'
import { editAppearance } from './appearance'
import { trashFolderNode } from '@/features/trash/folder'
import { useSettings } from '@/stores/settings'

vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener: () => undefined }),
  })
})

const setItemAppearance = vi.hoisted(() => vi.fn(async () => ({})))
vi.mock('@/features/sidebar/api', () => ({ setItemAppearance }))

const folder: FileNode = {
  id: 'f1', parentId: null, kind: 'folder', name: 'Projects', status: 'ready', mimeType: null, sizeBytes: 0, revision: 0,
  trashedAt: null, createdAt: '', updatedAt: '', systemRole: null, color: 'blue', icon: null,
}

afterEach(() => {
  cleanup()
  setItemAppearance.mockClear()
})

describe('AppearanceDialog', () => {
  it('applies each color and icon as it is chosen', () => {
    render(<AppearanceDialog />)
    act(() => editAppearance([folder]))
    expect(screen.getByRole('button', { name: 'Blue' }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Teal' }))
    expect(setItemAppearance).toHaveBeenLastCalledWith(['f1'], { color: 'teal' })
    expect(screen.getByRole('button', { name: 'Teal' }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Rocket' }))
    expect(setItemAppearance).toHaveBeenLastCalledWith(['f1'], { icon: 'rocket' })

    const [defaultColor] = screen.getAllByRole('button', { name: 'Default' })
    fireEvent.click(defaultColor!)
    expect(setItemAppearance).toHaveBeenLastCalledWith(['f1'], { color: null })

    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('changes several items at once, starting from what they share, and leaves chats out', () => {
    const doc: FileNode = { ...folder, id: 'd1', kind: 'doc', name: 'Notes.md', color: 'red', icon: 'star' }
    const chat: FileNode = { ...folder, id: 'c1', kind: 'chat', name: 'Trip planning' }
    render(<AppearanceDialog />)
    act(() => editAppearance([{ ...folder, icon: 'star' }, doc, chat]))
    expect(screen.getByRole('heading', { name: '2 items' })).toBeTruthy()
    // The colors differ, so none is chosen; the icon is shared.
    expect(screen.getAllByRole('button', { pressed: true }).map((button) => button.getAttribute('aria-label'))).toEqual(['Star'])

    fireEvent.click(screen.getByRole('button', { name: 'Green' }))
    expect(setItemAppearance).toHaveBeenLastCalledWith(['f1', 'd1'], { color: 'green' })
  })

  it('offers only a color for built-in folders, and keeps the trash color as a setting', () => {
    const archive: FileNode = { ...folder, id: 'a1', name: 'Archive', systemRole: 'archive', color: null }
    useSettings.setState({ trashColor: null })
    render(<AppearanceDialog />)
    act(() => editAppearance([archive, trashFolderNode('Trash', null)]))
    expect(screen.getByText('Choose a color.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Rocket' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Purple' }))
    expect(setItemAppearance).toHaveBeenLastCalledWith(['a1'], { color: 'purple' })
    expect(useSettings.getState().trashColor).toBe('purple')

    fireEvent.click(screen.getByRole('button', { name: 'Default' }))
    expect(useSettings.getState().trashColor).toBeNull()
  })
})
