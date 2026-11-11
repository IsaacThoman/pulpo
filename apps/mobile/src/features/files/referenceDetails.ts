import type { FileReference } from '@pulpo/contracts'
import { useQuery } from '@tanstack/react-query'
import { isNetworkError } from '../../api/client'
import { fileIcon } from './display'
import { fileNodeQuery, type FileNodeLookup } from './queries'

export interface FileReferenceDetails {
  name: string
  icon: { symbol: string; tint: string }
  /** "In Files · <folder>", or "No longer in Files". */
  detail: string
  missing: boolean
}

/**
 * What a card says about a mentioned item. An attachment is a copy made when the message was sent;
 * a reference is the live item in Files, so its card names where that item is now, or that it is
 * gone. Until the item loads (or while offline) it is simply "In Files".
 */
export function fileReferenceDetails(reference: FileReference, lookup: FileNodeLookup | undefined, error: unknown): FileReferenceDetails {
  const node = lookup?.node
  const missing = Boolean(node?.trashedAt) || (!node && error != null && !isNetworkError(error))
  const icon = node ? fileIcon(node) : fileIcon({ kind: reference.folder ? 'folder' : 'blob', name: reference.name, mimeType: null })
  const parent = lookup ? lookup.ancestors.at(-1)?.name ?? 'My files' : null
  return {
    name: node?.name ?? reference.name,
    icon,
    detail: missing ? 'No longer in Files' : parent ? `In Files · ${parent}` : 'In Files',
    missing,
  }
}

/** The details of a mentioned item, looking it up in Files when `namespace` is set. */
export function useFileReferenceDetails(namespace: string | null | undefined, reference: FileReference): FileReferenceDetails {
  const query = useQuery({ ...fileNodeQuery(namespace ?? '', reference.id), enabled: Boolean(namespace), staleTime: 30_000, retry: false })
  return fileReferenceDetails(reference, query.data, query.error)
}
