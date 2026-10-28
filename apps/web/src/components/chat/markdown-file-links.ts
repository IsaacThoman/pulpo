import { createContext } from 'react'
import { defaultUrlTransform, type UrlTransform } from 'react-markdown'
import type { Attachment } from '@/lib/types'

/** Files attached to the message whose Markdown is rendering, so links to them can download them. */
export const MarkdownAttachmentsContext = createContext<{
  attachments: readonly Attachment[]
  download: (attachment: Attachment) => void
} | null>(null)

// Models link files in their own workspace (`sandbox:/mnt/data/chart.png`, `/workspace/chart.png`),
// which mean nothing in the browser: react-markdown blanks the unknown schemes, and a blank or
// relative href opens the chat itself in a new tab.
const FILE_SCHEME = /^(?:sandbox|file|attachment):/i
const WORKSPACE_PATH = /^\/(?:workspace|mnt)\//i
const ANY_SCHEME = /^[a-z][a-z\d+.-]*:/i

/** Keeps workspace file links for the renderer to resolve; it never emits them as hrefs. */
export const keepFileLinks: UrlTransform = (url) => FILE_SCHEME.test(url) ? url : defaultUrlTransform(url)

/** Whether a link points at a file in the model's workspace rather than a web page. */
export function isWorkspaceFileLink(href: string): boolean {
  return FILE_SCHEME.test(href) || WORKSPACE_PATH.test(href)
}

function linkedFileName(href: string): string | null {
  if (!href || href.startsWith('#') || href.startsWith('//')) return null
  if (ANY_SCHEME.test(href) && !FILE_SCHEME.test(href)) return null
  const path = href.replace(FILE_SCHEME, '').split(/[?#]/)[0]
  const name = path.split('/').filter(Boolean).pop()
  if (!name) return null
  try {
    return decodeURIComponent(name)
  } catch {
    return name
  }
}

function extension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot).toLowerCase() : ''
}

/**
 * The attachment a workspace or relative link refers to: the one with the linked file's name, or
 * else the only one of its type (attachments can be renamed when attached).
 */
export function linkedAttachment(href: string | undefined, attachments: readonly Attachment[]): Attachment | null {
  if (!href || !attachments.length) return null
  const name = linkedFileName(href)
  if (!name) return null
  const lower = name.toLowerCase()
  const named = attachments.find((attachment) => attachment.name.toLowerCase() === lower)
  if (named) return named
  const type = extension(name)
  if (!type) return null
  const sameType = attachments.filter((attachment) => extension(attachment.name) === type)
  return sameType.length === 1 ? sameType[0] : null
}
