import { FILE_IMPORT_URL_MAX_LENGTH, type FileNode, type MobileConfig } from '@pulpo/contracts'
import { normalizeImportUrl } from '@pulpo/client-core/files'
import type { QueryClient } from '@tanstack/react-query'
import * as Haptics from 'expo-haptics'
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { apiRequest } from '../../api/client'
import { cacheNamespace } from '../../data/database'
import { promptText } from '../../platform/materialActions'
import { useSessionStore } from '../../store/session'
import { filesCapability, isFilesDisabledError, refreshFilesCapability } from './availability'
import { filesErrorMessage } from './display'
import { refreshFiles } from './operations'
import { useFilesToasts } from './toasts'

/*
 * Import from URL, as on the web (apps/web/src/features/files/ImportUrlDialog.tsx): the server
 * fetches a web page with the providers the agent's web_fetch uses and saves its text as a
 * document in the folder. Kept apart from the rest of Files so the menus only add an entry.
 */

/** Whether the instance can import pages; it needs Files and a page extraction provider. */
export function urlImportAvailable(config: MobileConfig | null | undefined): boolean {
  return filesCapability(config).enabled && config?.capabilities.files?.urlImport === true
}

export function useUrlImportEnabled(): boolean {
  return useSessionStore((state) => urlImportAvailable(state.config))
}

/** A web page saved in `parentId` as a document. */
export function importFromUrl(parentId: string | null, url: string): Promise<FileNode> {
  return apiRequest<FileNode>('/api/files/import-url', { method: 'POST', body: { parentId, url } })
}

/** The address as a row shows it while the page is fetched: its host and path, without the scheme. */
export function urlImportLabel(url: string): string {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '')
    return `${parsed.host}${path}` || url
  } catch {
    return url
  }
}

export interface PendingUrlImport {
  id: number
  namespace: string
  parentId: string | null
  url: string
}

let nextId = 1

/** Pages being fetched, so the folder they go to can show them until they arrive. */
export const useUrlImports = create<{ items: PendingUrlImport[] }>(() => ({ items: [] }))

/** The pages being imported into `parentId` for the account `namespace`. */
export function usePendingUrlImports(namespace: string, parentId: string | null): PendingUrlImport[] {
  return useUrlImports(useShallow((state) => state.items.filter((item) => item.namespace === namespace && item.parentId === parentId)))
}

const DESCRIPTION = 'Saves the page’s text in this folder as a document you can edit.'
const TOO_LONG = `Web addresses can be at most ${FILE_IMPORT_URL_MAX_LENGTH} characters.`

function signedInNamespace(): string {
  const { instanceUrl, user } = useSessionStore.getState()
  return user ? cacheNamespace(instanceUrl, user.id) : ''
}

/** Asks for the address; a failed import asks again with the address kept and what went wrong. */
function askForUrl(value: string, error: string | undefined, onSubmit: (url: string) => void) {
  promptText({
    title: 'Import from URL',
    message: error ?? DESCRIPTION,
    value,
    fieldLabel: 'Web address',
    confirmLabel: 'Import',
    keyboardType: 'url',
    onSubmit: (text) => { if (text.trim()) onSubmit(text) },
  })
}

export interface UrlImportOptions {
  namespace: string
  parentId: string | null
  queryClient: QueryClient
  /** Called with the new document once the page is saved (the toast reports it either way). */
  onImported?: (node: FileNode) => void
  /** Reports the fetch in a toast, where no folder shows the page as pending (the drawer). */
  announce?: boolean
}

/**
 * Asks for a web address and imports the page into `parentId`. The page shows as pending in that
 * folder while the server fetches it; the folder then refreshes (other devices refresh through
 * the account's realtime revision) and a toast names the new document.
 */
export function promptUrlImport(options: UrlImportOptions, value = '', error?: string): void {
  askForUrl(value, error, (typed) => { void runUrlImport(options, typed) })
}

/** Imports `typed` (an address as entered), asking again when it is refused. */
export async function runUrlImport(options: UrlImportOptions, typed: string): Promise<FileNode | undefined> {
  const { namespace, parentId, queryClient } = options
  const url = normalizeImportUrl(typed)
  if (!url) return undefined
  if (url.length > FILE_IMPORT_URL_MAX_LENGTH) {
    promptUrlImport(options, typed.trim(), TOO_LONG)
    return undefined
  }
  const pending: PendingUrlImport = { id: nextId++, namespace, parentId, url }
  useUrlImports.setState((state) => ({ items: [...state.items, pending] }))
  if (options.announce) useFilesToasts.getState().show({ message: `Importing “${urlImportLabel(url)}”…` })
  try {
    const node = await importFromUrl(parentId, url)
    await refreshFiles(queryClient, namespace)
    if (signedInNamespace() !== namespace) return node
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    useFilesToasts.getState().show({ message: `Imported “${node.name}”` })
    options.onImported?.(node)
    return node
  } catch (cause) {
    if (isFilesDisabledError(cause)) void refreshFilesCapability()
    // The account may have signed out meanwhile; its prompt has nowhere to import to.
    if (signedInNamespace() === namespace) promptUrlImport(options, typed.trim(), filesErrorMessage(cause))
    return undefined
  } finally {
    useUrlImports.setState((state) => ({ items: state.items.filter((item) => item.id !== pending.id) }))
  }
}
