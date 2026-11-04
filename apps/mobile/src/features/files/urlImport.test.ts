// @vitest-environment node
import type { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: { instanceUrl: 'https://pulpo.test', user: { id: 'a' } as { id: string } | null, config: null as unknown },
  requests: [] as Array<{ path: string; body: unknown }>,
  respond: vi.fn<() => Promise<unknown>>(),
  prompts: [] as Array<{ title: string; message?: string; value?: string; keyboardType?: string; confirmLabel?: string; onSubmit: (value: string) => void }>,
  toasts: [] as string[],
  refreshed: [] as string[],
  capabilityRefreshes: 0,
}))

vi.mock('expo-haptics', () => ({ notificationAsync: async () => undefined, NotificationFeedbackType: { Success: 'success' } }))
vi.mock('../../api/client', () => ({
  ApiError: class extends Error {
    constructor(readonly status: number, readonly code: string, message: string) { super(message) }
  },
  apiRequest: async (path: string, options: { body: unknown }) => {
    mocks.requests.push({ path, body: options.body })
    return mocks.respond()
  },
}))
vi.mock('../../data/database', () => ({ cacheNamespace: (instanceUrl: string, userId: string) => `${instanceUrl}|${userId}` }))
vi.mock('../../platform/materialActions', () => ({ promptText: (options: (typeof mocks.prompts)[number]) => { mocks.prompts.push(options) } }))
vi.mock('../../store/session', () => ({ useSessionStore: { getState: () => mocks.session } }))
vi.mock('./availability', () => ({
  filesCapability: (config: { capabilities?: { files?: { enabled?: boolean } } } | null) => ({ enabled: config?.capabilities?.files?.enabled === true, docSchemaVersion: null }),
  isFilesDisabledError: (error: unknown) => (error as { code?: string } | null)?.code === 'files_disabled',
  refreshFilesCapability: async () => { mocks.capabilityRefreshes += 1 },
}))
vi.mock('./display', () => ({ filesErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)) }))
vi.mock('./operations', () => ({ refreshFiles: async (_client: unknown, namespace: string) => { mocks.refreshed.push(namespace) } }))
vi.mock('./toasts', () => ({ useFilesToasts: { getState: () => ({ show: ({ message }: { message: string }) => { mocks.toasts.push(message) } }) } }))

const { promptUrlImport, runUrlImport, urlImportAvailable, urlImportErrorMessage, urlImportLabel, useUrlImports } = await import('./urlImport')
const { ApiError } = await import('../../api/client')
const { FILE_IMPORT_URL_MAX_LENGTH } = await import('@pulpo/contracts')

const A = 'https://pulpo.test|a'
const client = {} as QueryClient
const page = { id: 'doc', parentId: 'folder', name: 'Article.md', kind: 'doc' }
const lastPrompt = () => mocks.prompts.at(-1)!

beforeEach(() => {
  mocks.session.user = { id: 'a' }
  mocks.requests.length = 0
  mocks.prompts.length = 0
  mocks.toasts.length = 0
  mocks.refreshed.length = 0
  mocks.capabilityRefreshes = 0
  mocks.respond.mockReset()
  useUrlImports.setState({ items: [] })
})

describe('Import from URL availability', () => {
  const config = (files: object | undefined) => ({ capabilities: { files } }) as never

  it('is offered only when Files is on and the server can fetch pages', () => {
    expect(urlImportAvailable(config({ enabled: true, docSchemaVersion: 1, urlImport: true }))).toBe(true)
    expect(urlImportAvailable(config({ enabled: true, docSchemaVersion: 1, urlImport: false }))).toBe(false)
    expect(urlImportAvailable(config({ enabled: false, docSchemaVersion: 1, urlImport: true }))).toBe(false)
    // Servers that predate it don't say, and then it stays hidden.
    expect(urlImportAvailable(config({ enabled: true, docSchemaVersion: 1 }))).toBe(false)
    expect(urlImportAvailable(config(undefined))).toBe(false)
    expect(urlImportAvailable(null)).toBe(false)
  })
})

describe('Import from URL', () => {
  it('asks for a web address with a URL keyboard', () => {
    promptUrlImport({ namespace: A, parentId: 'folder', queryClient: client })
    expect(lastPrompt()).toMatchObject({
      title: 'Import from URL',
      message: 'Saves the page’s text in this folder as a document you can edit.',
      value: '',
      keyboardType: 'url',
      confirmLabel: 'Import',
    })
  })

  it('saves the page in the folder, shows it as pending until then, and reports the new document', async () => {
    let finish!: (value: unknown) => void
    mocks.respond.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const onImported = vi.fn()
    const running = runUrlImport({ namespace: A, parentId: 'folder', queryClient: client, onImported }, ' example.com/article ')
    expect(useUrlImports.getState().items).toMatchObject([{ namespace: A, parentId: 'folder', url: 'https://example.com/article' }])
    finish(page)
    await expect(running).resolves.toEqual(page)
    expect(mocks.requests).toEqual([{ path: '/api/files/import-url', body: { parentId: 'folder', url: 'https://example.com/article' } }])
    expect(useUrlImports.getState().items).toEqual([])
    expect(mocks.refreshed).toEqual([A])
    expect(mocks.toasts).toEqual(['Imported “Article.md”'])
    expect(onImported).toHaveBeenCalledWith(page)
    expect(mocks.prompts).toEqual([])
  })

  it('announces the fetch where no folder shows it', async () => {
    mocks.respond.mockResolvedValue(page)
    await runUrlImport({ namespace: A, parentId: null, queryClient: client, announce: true }, 'https://example.com/post/')
    expect(mocks.toasts).toEqual(['Importing “example.com/post”…', 'Imported “Article.md”'])
  })

  it('asks again with the address kept and what went wrong when the page can’t be imported', async () => {
    mocks.respond.mockRejectedValue(new Error('This page could not be imported. Check the link and try again.'))
    const onImported = vi.fn()
    await expect(runUrlImport({ namespace: A, parentId: 'folder', queryClient: client, onImported }, 'example.com/missing')).resolves.toBeUndefined()
    expect(useUrlImports.getState().items).toEqual([])
    expect(onImported).not.toHaveBeenCalled()
    expect(mocks.toasts).toEqual([])
    expect(lastPrompt()).toMatchObject({ message: 'This page could not be imported. Check the link and try again.', value: 'example.com/missing' })

    // Submitting the prompt again retries.
    mocks.respond.mockResolvedValue(page)
    lastPrompt().onSubmit('https://example.com/found')
    await vi.waitFor(() => expect(mocks.toasts).toEqual(['Imported “Article.md”']))
    expect(mocks.requests.at(-1)).toEqual({ path: '/api/files/import-url', body: { parentId: 'folder', url: 'https://example.com/found' } })
  })

  it('explains a page that could not be fetched in the server’s words, not as being offline', async () => {
    const failed = new ApiError(502, 'url_import_failed', 'This page could not be imported. Check the link and try again.')
    expect(urlImportErrorMessage(failed)).toBe('This page could not be imported. Check the link and try again.')
    mocks.respond.mockRejectedValue(failed)
    await runUrlImport({ namespace: A, parentId: null, queryClient: client }, 'example.com/missing')
    expect(lastPrompt().message).toBe('This page could not be imported. Check the link and try again.')
    expect(urlImportErrorMessage(new Error('Network request failed'))).toBe('Network request failed')
  })

  it('rechecks Files when an administrator turned it off meanwhile', async () => {
    mocks.respond.mockRejectedValue(Object.assign(new Error('Files are turned off by your administrator.'), { code: 'files_disabled' }))
    await runUrlImport({ namespace: A, parentId: null, queryClient: client }, 'example.com')
    expect(mocks.capabilityRefreshes).toBe(1)
  })

  it('refuses an address longer than the server takes without sending it', async () => {
    const long = `example.com/${'a'.repeat(FILE_IMPORT_URL_MAX_LENGTH)}`
    await runUrlImport({ namespace: A, parentId: null, queryClient: client }, long)
    expect(mocks.requests).toEqual([])
    expect(lastPrompt()).toMatchObject({ message: `Web addresses can be at most ${FILE_IMPORT_URL_MAX_LENGTH} characters.`, value: long })
  })

  it('ignores an empty address', async () => {
    await runUrlImport({ namespace: A, parentId: null, queryClient: client }, '   ')
    expect(mocks.requests).toEqual([])
    expect(mocks.prompts).toEqual([])
  })

  it('stays quiet when the account signed out while the page was fetched', async () => {
    const onImported = vi.fn()
    mocks.respond.mockImplementation(async () => {
      mocks.session.user = null
      throw new Error('upstream')
    })
    await runUrlImport({ namespace: A, parentId: null, queryClient: client, onImported }, 'example.com')
    expect(mocks.prompts).toEqual([])
    mocks.session.user = { id: 'a' }
    mocks.respond.mockImplementation(async () => {
      mocks.session.user = { id: 'b' }
      return page
    })
    await runUrlImport({ namespace: A, parentId: null, queryClient: client, onImported }, 'example.com')
    expect(mocks.toasts).toEqual([])
    expect(onImported).not.toHaveBeenCalled()
  })
})

describe('urlImportLabel', () => {
  it('shows the host and path without the scheme', () => {
    expect(urlImportLabel('https://example.com/')).toBe('example.com')
    expect(urlImportLabel('https://example.com/blog/post/')).toBe('example.com/blog/post')
    expect(urlImportLabel('https://example.com:8443/a?b=c')).toBe('example.com:8443/a')
    expect(urlImportLabel('not a url')).toBe('not a url')
  })
})
