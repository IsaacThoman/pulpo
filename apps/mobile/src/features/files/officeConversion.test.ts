// @vitest-environment node
import type { FileNode, MobileConfig } from '@pulpo/contracts'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requests: [] as Array<{ path: string; body: unknown; timeoutMs?: number; method?: string }>,
  downloads: [] as Array<{ url: string; headers: Record<string, string> }>,
  downloadError: null as Error | null,
  shared: [] as Array<{ uri: string; options: Record<string, unknown> }>,
}))

vi.mock('../../api/client', () => {
  class ApiError extends Error {
    constructor(readonly status: number, readonly code: string, message: string) { super(message) }
  }
  return {
    ApiError,
    apiRequest: async (path: string, options: { body: unknown; timeoutMs?: number; method?: string }) => {
      mocks.requests.push({ path, ...options })
      return { id: 'copy', name: 'Budget.xlsx' }
    },
    apiUrl: (path: string) => `https://pulpo.test${path}`,
    nativeAuthorizationHeaders: () => ({ authorization: 'Bearer token' }),
    // As in the real client: timeouts and 5xx answers count as connection trouble.
    isNetworkError: (error: unknown) => error instanceof ApiError && error.status >= 500,
  }
})
vi.mock('./availability', () => ({
  filesCapability: (config: MobileConfig | null | undefined) => ({ enabled: config?.capabilities.files?.enabled === true, docSchemaVersion: 1 }),
}))
vi.mock('../../store/session', () => ({ useSessionStore: Object.assign(() => undefined, { getState: () => ({}) }) }))
vi.mock('expo-sharing', () => ({
  isAvailableAsync: async () => true,
  shareAsync: async (uri: string, options: Record<string, unknown>) => { mocks.shared.push({ uri, options }) },
}))
vi.mock('expo-file-system', () => {
  class Directory {
    readonly uri: string
    constructor(...parts: Array<string | { uri: string }>) { this.uri = parts.map((part) => typeof part === 'string' ? part : part.uri).join('/') }
    get exists() { return false }
    create() {}
    delete() {}
  }
  class File {
    readonly uri: string
    constructor(directory: { uri: string }, name: string) { this.uri = `${directory.uri}/${name}` }
    get exists() { return false }
    delete() {}
    static async downloadFileAsync(url: string, destination: File, options: { headers: Record<string, string> }) {
      if (mocks.downloadError) throw mocks.downloadError
      mocks.downloads.push({ url, headers: options.headers })
      return destination
    }
  }
  return { Directory, File, Paths: { cache: { uri: 'cache' } } }
})

const { ApiError } = await import('../../api/client')
const { convertOfficeFile, officeConversionAvailable, pdfExportErrorMessage, shareOfficePdf, OFFICE_CONVERSION_TIMEOUT_MS } = await import('./officeConversion')
const { fileItemActions, officeActions } = await import('./itemActions')
const { filesErrorMessage } = await import('./display')

const legacy = { id: '00000000-0000-4000-8000-0000000000d1', kind: 'blob', name: 'Budget.xls', status: 'ready', pinned: false, systemRole: null } as unknown as FileNode
const config = (files: Partial<NonNullable<MobileConfig['capabilities']['files']>> | undefined) =>
  ({ capabilities: { files: files ? { enabled: true, docSchemaVersion: 1, urlImport: false, officeConversion: false, ...files } : undefined } }) as unknown as MobileConfig

describe('office conversion on mobile', () => {
  it('is offered only when the server converts and Files is on', () => {
    expect(officeConversionAvailable(config({ officeConversion: true }))).toBe(true)
    expect(officeConversionAvailable(config({ officeConversion: false }))).toBe(false)
    expect(officeConversionAvailable(config({ enabled: false, officeConversion: true }))).toBe(false)
    expect(officeConversionAvailable(config(undefined))).toBe(false)
  })

  it('adds Export as PDF and Convert to the item menu of office files', () => {
    const ids = (node: FileNode, officeConversion: boolean) => fileItemActions(node, { agent: 'none', selectable: true, officeConversion }).map((action) => action.id)
    expect(ids(legacy, true)).toEqual(expect.arrayContaining(['share', 'export-pdf', 'convert-office']))
    expect(fileItemActions(legacy, { agent: 'none', selectable: true, officeConversion: true }).find((action) => action.id === 'convert-office')?.title).toBe('Convert to .xlsx')
    expect(ids({ ...legacy, name: 'Budget.xlsx' } as FileNode, true)).toContain('export-pdf')
    expect(ids({ ...legacy, name: 'Budget.xlsx' } as FileNode, true)).not.toContain('convert-office')
    expect(ids(legacy, false)).not.toContain('export-pdf')
    expect(ids({ ...legacy, name: 'photo.png' } as FileNode, true)).not.toContain('export-pdf')
    expect(officeActions({ ...legacy, status: 'pending' }, true)).toEqual({ target: null, pdf: false })
  })

  it('asks the server for the copy, waiting as long as the converter may take', async () => {
    await convertOfficeFile(legacy.id, 'xlsx')
    expect(mocks.requests.at(-1)).toEqual({ path: `/api/files/${legacy.id}/conversions`, method: 'POST', body: { to: 'xlsx' }, timeoutMs: OFFICE_CONVERSION_TIMEOUT_MS })
    expect(OFFICE_CONVERSION_TIMEOUT_MS).toBeGreaterThan(180_000)
  })

  it('shares the PDF under the original name', async () => {
    await shareOfficePdf(legacy)
    expect(mocks.downloads.at(-1)).toEqual({ url: `https://pulpo.test/api/files/${legacy.id}/pdf`, headers: { authorization: 'Bearer token' } })
    expect(mocks.shared.at(-1)).toMatchObject({ uri: expect.stringMatching(/\/Budget\.pdf$/), options: { mimeType: 'application/pdf' } })
    mocks.downloadError = new Error('Unable to download: response has status 422')
    await expect(shareOfficePdf(legacy)).rejects.toMatchObject({ message: 'This file can’t be exported as PDF. It may be password-protected or damaged.' })
    mocks.downloadError = null
  })

  it('explains converter failures instead of reporting the device offline', () => {
    expect(filesErrorMessage(new ApiError(503, 'office_converter_busy', 'busy'))).toBe('The converter is busy. Try again in a moment.')
    expect(filesErrorMessage(new ApiError(504, 'office_conversion_timeout', 'slow'))).toBe('Converting took too long. Try again later.')
    expect(filesErrorMessage(new ApiError(422, 'office_file_encrypted', 'locked'))).toMatch(/^Password-protected files/)
    expect(filesErrorMessage(new ApiError(502, 'bad_gateway', 'x'))).toMatch(/offline/)
    expect(pdfExportErrorMessage(new Error('status 503'))).toBe('The converter is busy. Try again in a moment.')
    expect(pdfExportErrorMessage(new Error('socket hang up'))).toBe('This file couldn’t be exported as PDF. Try again later.')
  })
})
