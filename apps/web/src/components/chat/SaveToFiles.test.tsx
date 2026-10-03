// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { FileNode } from '@pulpo/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from '@/stores/auth'
import { SaveToFilesDialog } from './SaveToFiles'

vi.hoisted(() => {
  window.matchMedia = (() => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined })) as never
})
const api = vi.hoisted(() => ({ fetchFolder: vi.fn(), save: vi.fn() }))
vi.mock('@/features/files/api', async (actual) => ({ ...await actual<object>(), fetchFolder: api.fetchFolder }))
vi.mock('./attachment-actions', () => ({ saveAttachmentToFiles: api.save }))

const parentId = null
function node(id: string, name: string, kind: FileNode['kind'] = 'blob'): FileNode {
  return { id, parentId, kind, name, status: 'ready', mimeType: null, sizeBytes: 1, revision: 0, trashedAt: null, createdAt: '', updatedAt: '' }
}
const attachment = { id: 'att', name: 'report.pdf', mimeType: 'application/pdf', type: 'file' as const, size: 1 }

function renderDialog() {
  const onSaved = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SaveToFilesDialog attachment={attachment} open onOpenChange={() => undefined} onSaved={onSaved} />
    </QueryClientProvider>,
  )
  return { onSaved, name: () => screen.getByRole('textbox') as HTMLInputElement }
}

beforeEach(() => {
  useAuth.setState({ user: { id: 'user' } } as never)
  api.fetchFolder.mockResolvedValue({ folder: null, ancestors: [], children: [node('f1', 'Work', 'folder'), node('q3', 'Q3.pdf')] })
  api.save.mockResolvedValue({ node: node('new', 'Q3.pdf'), replacedId: 'q3' })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('saving an attachment to Files', () => {
  it('saves under the attachment name when nothing clashes', async () => {
    const { onSaved } = renderDialog()
    await screen.findByText('Q3.pdf')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(api.save).toHaveBeenCalledWith('att', { parentId: null, name: 'report.pdf', replaceId: undefined })
  })

  it('takes a grayed-out file name, warns, and overwrites that file when asked', async () => {
    const { name } = renderDialog()
    fireEvent.click(await screen.findByText('Q3.pdf'))
    expect(name().value).toBe('Q3.pdf')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(api.save).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('"Q3.pdf" already exists here')
    fireEvent.click(screen.getByRole('button', { name: 'Overwrite' }))
    await waitFor(() => expect(api.save).toHaveBeenCalledWith('att', { parentId: null, name: 'Q3.pdf', replaceId: 'q3' }))
  })

  it('saves a separate, numbered copy, or goes back, from the warning', async () => {
    const { name } = renderDialog()
    await screen.findByText('Q3.pdf')
    fireEvent.change(name(), { target: { value: 'q3.pdf' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save separately' }))
    await waitFor(() => expect(api.save).toHaveBeenCalledWith('att', { parentId: null, name: 'q3.pdf', replaceId: undefined }))
  })

  it('starts from the next free numbered name when the folder already has the attachment', async () => {
    api.fetchFolder.mockImplementation(async (folderId: string | null) => folderId
      ? { folder: node('f1', 'Work', 'folder'), ancestors: [], children: [] }
      : { folder: null, ancestors: [], children: [node('f1', 'Work', 'folder'), node('r1', 'Report.pdf'), node('r2', 'report (2).pdf')] })
    const { name } = renderDialog()
    await waitFor(() => expect(name().value).toBe('report (3).pdf'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.save).toHaveBeenCalledWith('att', { parentId: null, name: 'report (3).pdf', replaceId: undefined }))

    // In another folder the plain name is free again; a picked file's name does not follow along.
    fireEvent.click(screen.getByText('Report.pdf'))
    expect(name().value).toBe('Report.pdf')
    fireEvent.click(screen.getByText('Work'))
    await waitFor(() => expect(name().value).toBe('report.pdf'))
  })

  it('cannot overwrite a folder, only save separately', async () => {
    const { name } = renderDialog()
    await screen.findByText('Work')
    fireEvent.change(name(), { target: { value: 'Work' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('alert').textContent).toContain('A folder named "Work"')
    expect(screen.queryByRole('button', { name: 'Overwrite' })).toBeNull()
  })
})
