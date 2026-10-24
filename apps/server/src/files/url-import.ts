import { eq } from 'drizzle-orm'
import type { FastifyBaseLogger } from 'fastify'
import { FILE_DOC_MAX_MARKDOWN_LENGTH, FILE_NAME_MAX_LENGTH, type FileNode } from '@pulpo/contracts'
import { chargeMeteredUsage } from '../accounting/service.js'
import type { WebPage } from '../agent/kagi.js'
import { billedPrice, createWebProviderClients, enabledProviders, runWebProviders, webExtractAvailable } from '../agent/web-tools.js'
import { assertDailySpendAvailable } from '../billing/usage-tiers.js'
import { getConfig } from '../config.js'
import { db } from '../database/client.js'
import { applicationSettings } from '../database/schema.js'
import { AppError } from '../lib/errors.js'
import { parseWebToolsSettings } from '../settings/application-settings.js'
import { createDoc } from './doc-store.js'
import { initialDocState } from './doc-state.js'
import { assertDestination } from './tree-service.js'

const TRUNCATED_NOTE = '\n\n*The rest of this page was too long to import.*'

function importUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new AppError(400, 'url_import_invalid', 'Enter a full web address, like https://example.com', 'invalid_request_error', 'url')
  }
  if (url.protocol !== 'https:' || !url.hostname) {
    throw new AppError(400, 'url_import_not_https', 'Only https:// links can be imported', 'invalid_request_error', 'url')
  }
  if (url.username || url.password) {
    throw new AppError(400, 'url_import_credentials', 'Links with a username or password cannot be imported', 'invalid_request_error', 'url')
  }
  return url.toString()
}

function plainText(markdown: string): string {
  return markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]+/g, '')
}

/** The page's title, else its first heading, else the last part of its address. */
export function importedDocName(page: Pick<WebPage, 'output' | 'sourceUrl' | 'title'>): string {
  const heading = /^#{1,2}[ \t]+(.+?)[ \t#]*$/m.exec(page.output)?.[1]
  const url = new URL(page.sourceUrl)
  let segment = url.pathname.split('/').filter(Boolean).at(-1) ?? ''
  try {
    segment = decodeURIComponent(segment)
  } catch {
    // Keep the encoded form of a malformed escape.
  }
  const candidates = [page.title, heading && plainText(heading), segment.replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[-_]+/g, ' '), url.hostname]
  for (const candidate of candidates) {
    // Names cannot hold slashes or control characters; the editor's extension takes 3 of the 255.
    const cleaned = (candidate ?? '').replace(/[\p{Cc}/\\]+/gu, ' ').replace(/\s+/g, ' ').trim()
    const base = [...cleaned].slice(0, FILE_NAME_MAX_LENGTH - 3).join('').trim()
    if (base && base !== '.' && base !== '..') return `${base}.md`
  }
  return 'Imported page.md'
}

/** The page's Markdown under a line linking where it came from, cut to what a document can hold. */
export function importedMarkdown(page: Pick<WebPage, 'output' | 'sourceUrl'>): string {
  const header = `Source: <${page.sourceUrl}>\n\n`
  const body = page.output.trim()
  const room = FILE_DOC_MAX_MARKDOWN_LENGTH - header.length - TRUNCATED_NOTE.length
  if (body.length <= room) return header + body
  // Do not leave half of a surrogate pair at the cut.
  return header + body.slice(0, room).replace(/[\uD800-\uDBFF]$/, '').trimEnd() + TRUNCATED_NOTE
}

/**
 * Fetches a web page with the providers the agent's web_fetch uses, in the same order, and saves
 * it as a document. A billed fetch is charged once the page is known to fit in a document.
 */
export async function importUrlAsDoc(
  userId: string,
  input: { parentId: string | null; url: string },
  log?: Pick<FastifyBaseLogger, 'warn'>,
): Promise<FileNode> {
  const [row] = await db.select({ value: applicationSettings.value }).from(applicationSettings)
    .where(eq(applicationSettings.key, 'webTools')).limit(1)
  const settings = parseWebToolsSettings(row?.value)
  if (!webExtractAvailable(settings)) throw new AppError(404, 'url_import_unavailable', 'Importing from a URL is not available')
  const url = importUrl(input.url)
  // Check the folder before paying for the page.
  await assertDestination(db, userId, input.parentId)
  const clients = createWebProviderClients(settings, getConfig().ENCRYPTION_KEY)
  if (enabledProviders('extract', settings, clients).some((provider) => billedPrice(provider, 'extract', settings) > 0)) {
    await assertDailySpendAvailable(userId)
  }

  let outcome: Awaited<ReturnType<typeof runWebProviders<WebPage>>>
  try {
    outcome = await runWebProviders<WebPage>({
      capability: 'extract',
      settings,
      clients,
      attempt: (provider) => provider === 'kagi'
        ? clients.kagi!.fetchPage(url)
        : clients.firecrawl!.fetchPage(url, settings.firecrawl.maxAgeSeconds),
    })
  } catch (cause) {
    log?.warn({ err: cause }, 'URL import failed')
    throw new AppError(502, 'url_import_failed', 'This page could not be imported. Check the link and try again.', 'server_error')
  }

  const markdown = importedMarkdown(outcome.result)
  // Fails on Markdown the editor cannot hold, before anything is charged.
  initialDocState(markdown)
  if (outcome.billedCostMicros > 0) {
    await chargeMeteredUsage({
      userId,
      costMicros: outcome.billedCostMicros,
      type: 'url_import',
      metadata: { provider: outcome.provider, providerCostMicros: outcome.providerCostMicros },
    })
  }
  return createDoc(userId, { parentId: input.parentId, name: importedDocName(outcome.result), markdown })
}
