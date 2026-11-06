// @vitest-environment node
import type { FileNode, MobileConfig } from '@pulpo/contracts'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requests: [] as Array<{ path: string; body: unknown; timeoutMs?: number; method?: string }>,
  downloads: [] as Array<{ url: string; headers: Record<string, string>; signal?: AbortSignal }>,
  downloadAnswer: null as { status: number; body: unknown } | null,
  written: [] as Uint8Array[],
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
vi.mock('expo/fetch', () => ({
  fetch: async (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => {
    mocks.downloads.push({ url, ...init })
    const answer = mocks.downloadAnswer
    if (answer) return { ok: false, status: answer.status, json: async () => answer.body }
    return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('%PDF-1.7').buffer }
  },
}))
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
    create() {}
    write(bytes: Uint8Array) { mocks.written.push(bytes) }
  }
  return { Directory, File, Paths: { cache: { uri: 'cache' } } }
})

const { ApiError } = await import('../../api/client')
const { convertOfficeFile, officeConversionAvailable, shareOfficePdf, OFFICE_CONVERSION_TIMEOUT_MS } = await import('./officeConversion')
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

  it('uses icons that have a Material equivalent on Android', async () => {
    const { materialSymbolNames } = await import('../../platform/symbolNames')
    for (const action of fileItemActions(legacy, { agent: 'none', selectable: true, officeConversion: true }).filter((item) => item.id === 'export-pdf' || item.id === 'convert-office')) {
      expect(materialSymbolNames[action.systemImage!], action.systemImage).toBeTruthy()
    }
  })

  it('asks the server for the copy, waiting as long as the converter may take', async () => {
    await convertOfficeFile(legacy.id, 'xlsx')
    expect(mocks.requests.at(-1)).toEqual({ path: `/api/files/${legacy.id}/conversions`, method: 'POST', body: { to: 'xlsx' }, timeoutMs: OFFICE_CONVERSION_TIMEOUT_MS })
    expect(OFFICE_CONVERSION_TIMEOUT_MS).toBeGreaterThan(180_000)
  })

  it('shares the PDF under the original name, waiting as long as the conversion may take', async () => {
    await shareOfficePdf(legacy)
    expect(mocks.downloads.at(-1)).toMatchObject({ url: `https://pulpo.test/api/files/${legacy.id}/pdf`, headers: { authorization: 'Bearer token' } })
    expect(mocks.downloads.at(-1)!.signal).toBeInstanceOf(AbortSignal)
    expect(new TextDecoder().decode(mocks.written.at(-1))).toBe('%PDF-1.7')
    expect(mocks.shared.at(-1)).toMatchObject({ uri: expect.stringMatching(/\/Budget\.pdf$/), options: { mimeType: 'application/pdf' } })
    mocks.downloadAnswer = { status: 422, body: { error: { code: 'office_file_encrypted', message: 'locked' } } }
    const failure = await shareOfficePdf(legacy).catch((error: unknown) => error)
    expect(filesErrorMessage(failure)).toMatch(/^Password-protected files/)
    mocks.downloadAnswer = { status: 503, body: null }
    expect(await shareOfficePdf(legacy).catch((error: unknown) => error)).toMatchObject({ status: 503, code: 'office_pdf_export_failed' })
    mocks.downloadAnswer = null
  })

  it('explains converter failures instead of reporting the device offline', () => {
    expect(filesErrorMessage(new ApiError(503, 'office_converter_busy', 'busy'))).toBe('The converter is busy. Try again in a moment.')
    expect(filesErrorMessage(new ApiError(504, 'office_conversion_timeout', 'slow'))).toBe('Converting took too long. Try again later.')
    expect(filesErrorMessage(new ApiError(422, 'office_file_encrypted', 'locked'))).toMatch(/^Password-protected files/)
    expect(filesErrorMessage(new ApiError(502, 'bad_gateway', 'x'))).toMatch(/offline/)
  })
})
