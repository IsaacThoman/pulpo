// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { FileNode } from '@pulpo/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ApiError } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import { useFileToasts } from './browser/toasts'
import { OfficeConversionBanner, OfficeFileHeaderActions, OfficePdfPreview } from './OfficeFile'
import { officeFileActions, useOfficeConversion } from './office-file'

vi.hoisted(() => {
  window.matchMedia = (() => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined })) as never
})
const api = vi.hoisted(() => ({ convertOfficeFile: vi.fn(), downloadFileAsPdf: vi.fn(), fetchFilePdf: vi.fn() }))
vi.mock('./api', async (actual) => ({ ...await actual<object>(), ...api }))

const legacy: FileNode = {
  id: '00000000-0000-4000-8000-0000000000d1', parentId: null, kind: 'blob', name: 'Budget.xls', status: 'ready',
  mimeType: 'application/vnd.ms-excel', sizeBytes: 10, contentChecksum: 'abc', revision: 0, trashedAt: null, createdAt: '', updatedAt: '',
}
const converted: FileNode = { ...legacy, id: '00000000-0000-4000-8000-0000000000d2', name: 'Budget.xlsx' }

function Actions({ node, onOpen }: { node: FileNode; onOpen: (node: FileNode) => void }) {
  const conversion = useOfficeConversion(onOpen)
  return <OfficeFileHeaderActions node={node} conversion={conversion} compact={false} />
}

function renderWithProviders(children: React.ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  useAuth.setState({ user: { id: 'user' }, officeConversionEnabled: true } as never)
  useFileToasts.setState({ toasts: [] })
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:preview')
  globalThis.URL.revokeObjectURL = vi.fn()
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('office files', () => {
  it('offers conversion only for convertible uploads, and only when the server can convert', () => {
    expect(officeFileActions(legacy, true)).toEqual({ target: 'xlsx', pdf: true })
    expect(officeFileActions(converted, true)).toEqual({ target: null, pdf: true })
    expect(officeFileActions({ kind: 'blob', name: 'photo.png' }, true)).toEqual({ target: null, pdf: false })
    expect(officeFileActions({ kind: 'doc', name: 'Notes.doc' }, true)).toEqual({ target: null, pdf: false })
    expect(officeFileActions(legacy, false)).toEqual({ target: null, pdf: false })
  })

  it('converts beside the original and offers to open the copy', async () => {
    api.convertOfficeFile.mockResolvedValue(converted)
    const onOpen = vi.fn()
    renderWithProviders(<Actions node={legacy} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: 'Convert to .xlsx' }))
    expect(await screen.findByRole('button', { name: 'Converting…' })).toBeTruthy()
    await waitFor(() => expect(useFileToasts.getState().toasts).toHaveLength(1))
    expect(api.convertOfficeFile).toHaveBeenCalledWith(legacy.id, 'xlsx')
    const [toast] = useFileToasts.getState().toasts
    expect(toast).toMatchObject({ message: 'Converted to “Budget.xlsx”', action: { label: 'Open' } })
    toast!.action!.run()
    expect(onOpen).toHaveBeenCalledWith(converted)
    expect(await screen.findByRole('button', { name: 'Convert to .xlsx' })).toBeTruthy()
  })

  it('explains why a conversion failed', async () => {
    api.convertOfficeFile.mockRejectedValue(new ApiError(422, 'office_file_encrypted', 'locked'))
    renderWithProviders(<Actions node={legacy} onOpen={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Convert to .xlsx' }))
    await waitFor(() => expect(useFileToasts.getState().toasts).toEqual([
      expect.objectContaining({ message: "Password-protected files can't be converted", tone: 'error' }),
    ]))
  })

  it('downloads as PDF, and hides everything when conversion is unavailable', async () => {
    api.downloadFileAsPdf.mockResolvedValue(undefined)
    const { unmount } = renderWithProviders(<Actions node={converted} onOpen={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /Convert to/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Download as PDF' }))
    await waitFor(() => expect(api.downloadFileAsPdf).toHaveBeenCalledWith(converted))
    unmount()
    useAuth.setState({ officeConversionEnabled: false } as never)
    renderWithProviders(<><Actions node={legacy} onOpen={vi.fn()} /><OfficeConversionBanner node={legacy} /></>)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('explains the read-only state of legacy files', () => {
    renderWithProviders(<OfficeConversionBanner node={legacy} />)
    expect(screen.getByRole('note').textContent).toBe(".xls files open read only. Converting makes a .xlsx copy beside it; the original stays as it is.")
  })

  it('previews as PDF, with a retry when rendering fails', async () => {
    api.fetchFilePdf.mockRejectedValueOnce(new ApiError(503, 'office_converter_busy', 'busy'))
    renderWithProviders(<OfficePdfPreview node={legacy} />)
    expect(screen.getByText('Preparing preview…')).toBeTruthy()
    expect(await screen.findByText('No preview: The converter is busy. Try again in a moment.')).toBeTruthy()
    api.fetchFilePdf.mockResolvedValueOnce(new Blob(['%PDF-1.7'], { type: 'application/octet-stream' }))
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    const frame = await screen.findByTitle('Budget.xls')
    expect(frame.getAttribute('src')).toBe('blob:preview')
    // The frame only ever receives a PDF type.
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0]![0] as Blob
    expect(blob.type).toBe('application/pdf')
  })
})
