// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileProject } from '@pulpo/contracts'
import { ApiError } from '@/lib/api'

vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }),
  })
})

const api = vi.hoisted(() => ({
  fetchFolderProject: vi.fn(),
  saveFolderProject: vi.fn(),
  removeFolderProject: vi.fn(),
}))
vi.mock('./project', async (actual) => ({ ...await actual<object>(), ...api }))

const { ProjectDialog } = await import('./ProjectDialog')
const { editProject } = await import('./project')
const { useAuth } = await import('@/stores/auth')
const { queryClient } = await import('@/lib/query-client')

const project: FileProject = {
  folderId: 'f1', name: 'Launch', instructions: 'Be brief.', memory: 'Uses Postgres.', memoryRevision: 3,
  threadModelId: null, createdAt: '2026-11-18T00:00:00.000Z', updatedAt: '2026-11-18T00:00:00.000Z',
}

beforeEach(() => {
  useAuth.setState({ user: { id: 'account' } as NonNullable<ReturnType<typeof useAuth.getState>['user']>, filesEnabled: true })
  queryClient.clear()
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function open() {
  render(<QueryClientProvider client={queryClient}><ProjectDialog /></QueryClientProvider>)
  act(() => editProject({ id: 'f1', name: 'Launch' }))
}

describe('ProjectDialog', () => {
  it('makes a folder a project with its instructions', async () => {
    api.fetchFolderProject.mockResolvedValue(null)
    api.saveFolderProject.mockResolvedValue({ ...project, memory: '', memoryRevision: 0 })
    open()
    const instructions = await screen.findByLabelText('Instructions')
    expect(screen.queryByRole('button', { name: 'Stop using as project' })).toBeNull()
    fireEvent.change(instructions, { target: { value: 'Write in Spanish.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Make project' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // Unchanged memory is left out, so the save cannot overwrite what the agent wrote.
    expect(api.saveFolderProject).toHaveBeenCalledWith('f1', { instructions: 'Write in Spanish.', threadModelId: null })
  })

  it('sends the memory revision it read and says to reload when the memory changed meanwhile', async () => {
    api.fetchFolderProject.mockResolvedValueOnce(project).mockResolvedValueOnce({ ...project, memory: 'Uses MySQL.', memoryRevision: 4 })
    api.saveFolderProject.mockRejectedValue(new ApiError(409, 'project_memory_conflict', 'Project memory changed'))
    open()
    const memory = await screen.findByLabelText('Memory')
    expect((memory as HTMLTextAreaElement).value).toBe('Uses Postgres.')
    fireEvent.change(memory, { target: { value: 'Uses Postgres 17.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/The memory changed since you opened it/)).toBeTruthy()
    expect(api.saveFolderProject).toHaveBeenCalledWith('f1', {
      instructions: 'Be brief.', threadModelId: null, memory: 'Uses Postgres 17.', expectedMemoryRevision: 3,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    await waitFor(() => expect((screen.getByLabelText('Memory') as HTMLTextAreaElement).value).toBe('Uses MySQL.'))
  })

  it('turns a project back into a plain folder', async () => {
    api.fetchFolderProject.mockResolvedValue(project)
    api.removeFolderProject.mockResolvedValue(undefined)
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Stop using as project' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(api.removeFolderProject).toHaveBeenCalledWith('f1')
  })
})
