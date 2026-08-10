import {
  applyResponseEventToSnapshot,
  mergeResponseSnapshots,
  type ChatPreset,
  type EmbeddedResponseSnapshot,
  type ManagementInfo,
  type ManagementAccountSettingsDocument,
  type ManagementInstanceSettingsDocument,
  type ManagementSettingsChange,
  type ManagementSettingsDocument,
  type ManagementSettingsPlan,
  type ManagementToken,
  type NativeAuthResponse,
  type ResponseEvent,
  type ResponseSnapshot,
  type TwoFactorEnrollment,
  type TwoFactorRecoveryCodes,
  type TwoFactorStatus,
  type User,
} from '@pulpo/contracts'

export function hydrateEmbeddedResponseSnapshot(
  snapshot: ResponseSnapshot | EmbeddedResponseSnapshot,
  output: unknown[],
): ResponseSnapshot {
  return 'output' in snapshot ? snapshot : { ...snapshot, output }
}

export interface ChatTreeNode {
  id: string
  parentResponseId: string | null
}

export interface RevisionInvalidationBatch {
  revision: number
  chatIds: string[]
  /** Account revisions that have not been paired with a chat change. */
  accountOnlyRevisions: number[]
}

/** Merge the paired account/chat events emitted for one server revision. */
export function mergeRevisionInvalidation(
  current: RevisionInvalidationBatch | undefined,
  event: { revision: number; chatId?: string },
): RevisionInvalidationBatch {
  const chatIds = new Set(current?.chatIds ?? [])
  const accountOnlyRevisions = new Set(current?.accountOnlyRevisions ?? [])
  if (event.chatId) {
    chatIds.add(event.chatId)
    accountOnlyRevisions.delete(event.revision)
  } else if (!accountOnlyRevisions.has(event.revision)) {
    accountOnlyRevisions.add(event.revision)
  }
  return {
    revision: Math.max(current?.revision ?? 0, event.revision),
    chatIds: [...chatIds],
    accountOnlyRevisions: [...accountOnlyRevisions],
  }
}

export function lineageFromLeaf<T extends ChatTreeNode>(nodes: T[], leafId: string | null): T[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const lineage: T[] = []
  const seen = new Set<string>()
  let cursor = leafId
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor)
    const node = byId.get(cursor)
    if (!node) break
    lineage.unshift(node)
    cursor = node.parentResponseId
  }
  return lineage
}

export function newestDescendantId<T extends ChatTreeNode>(nodes: T[], selectedId: string): string {
  let leafId = selectedId
  for (;;) {
    const children = nodes.filter((node) => node.parentResponseId === leafId)
    const newest = children.at(-1)
    if (!newest) return leafId
    leafId = newest.id
  }
}

export function reconcileResponseEvents(
  snapshot: ResponseSnapshot,
  events: ResponseEvent[],
  authoritative?: ResponseSnapshot,
): ResponseSnapshot {
  const next = [...events]
    .sort((left, right) => left.sequence - right.sequence)
    .reduce(applyResponseEventToSnapshot, snapshot)
  return authoritative ? mergeResponseSnapshots(next, authoritative) : next
}

export type PresetResolutionErrorCode = 'model_unavailable' | 'conflicting_redirects' | 'redirect_cycle'

export class PresetResolutionError extends Error {
  constructor(readonly code: PresetResolutionErrorCode, message: string) {
    super(message)
  }
}

export interface PresetResolutionModel {
  id: string
  enabled: boolean
  allowedParameters: string[]
  presets: ChatPreset[]
}

export interface ResolvedPresetActions {
  effectiveModelId: string
  parameters: Record<string, unknown>
  selections: Record<string, string>
}

const RESERVED_PARAMETERS = new Set(['model', 'input', 'stream', 'store', 'metadata'])

export async function resolvePresetActions(
  requestedModelId: string,
  requestedSelections: Record<string, string>,
  loadModel: (modelId: string) => Promise<PresetResolutionModel | undefined>,
): Promise<ResolvedPresetActions> {
  const visited = new Set<string>()
  const parameters: Record<string, unknown> = {}
  const selections = { ...requestedSelections }
  let currentId = requestedModelId
  let initial = true

  while (!visited.has(currentId)) {
    visited.add(currentId)
    const current = await loadModel(currentId)
    if (!current?.enabled) throw new PresetResolutionError('model_unavailable', 'The selected model is unavailable')
    const redirects = new Set<string>()
    for (const preset of current.presets) {
      const requestedChoice = preset.choices.find((choice) => choice.id === selections[preset.id])
      const choice = requestedChoice ?? (initial
        ? preset.choices.find((candidate) => candidate.id === preset.defaultChoiceId) ?? preset.choices[0]
        : undefined)
      if (!choice) continue
      selections[preset.id] = choice.id
      if (choice.action.type === 'params') Object.assign(parameters, choice.action.params)
      if (choice.action.type === 'redirect') redirects.add(choice.action.modelId)
    }
    if (redirects.size === 0) {
      const allowed = new Set(current.allowedParameters)
      return {
        effectiveModelId: current.id,
        parameters: Object.fromEntries(Object.entries(parameters)
          .filter(([key]) => allowed.has(key) && !RESERVED_PARAMETERS.has(key))),
        selections,
      }
    }
    if (redirects.size > 1) {
      throw new PresetResolutionError('conflicting_redirects', 'Preset choices redirect to different models')
    }
    currentId = [...redirects][0]!
    initial = false
  }
  throw new PresetResolutionError('redirect_cycle', 'Preset redirects contain a cycle')
}

export function normalizeInstanceUrl(value: string, allowLocalhost = false): string {
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`
  const url = new URL(withScheme)
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1'
  if (url.protocol !== 'https:' && !(allowLocalhost && local && url.protocol === 'http:')) {
    throw new Error('Pulpo instances must use HTTPS')
  }
  if (url.username || url.password || url.search || url.hash) throw new Error('Enter the instance origin only')
  url.pathname = url.pathname.replace(/\/+$/, '') || '/'
  return url.origin + (url.pathname === '/' ? '' : url.pathname)
}

export interface AttachmentCandidate {
  name: string
  mimeType: string
  sizeBytes: number
}

export function attachmentValidationError(candidate: AttachmentCandidate): string | null {
  if (!candidate.name.trim()) return 'Attachment name is required'
  if (!Number.isFinite(candidate.sizeBytes) || candidate.sizeBytes <= 0) return 'Attachment is empty'
  if (candidate.sizeBytes > 25 * 1024 * 1024) return 'Attachment exceeds the 25 MB limit'
  return null
}

export class ManagementApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body?: unknown,
  ) {
    super(message)
    this.name = 'ManagementApiError'
  }
}

export interface ManagementRequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown
  timeoutMs?: number
}

export class PulpoManagementClient {
  private token: string | null

  constructor(
    readonly baseUrl: string,
    token: string | null = null,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.token = token
  }

  setToken(token: string | null): void {
    this.token = token
  }

  async request<T>(path: string, options: ManagementRequestOptions = {}): Promise<T> {
    const headers = new Headers(options.headers)
    if (options.body !== undefined) headers.set('content-type', 'application/json')
    if (this.token) headers.set('authorization', `Bearer ${this.token}`)
    const response = await this.fetchImpl(new URL(path, `${this.baseUrl.replace(/\/+$/, '')}/`), {
      ...options,
      headers,
      signal: options.signal ?? AbortSignal.timeout(options.timeoutMs ?? 30_000),
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
    if (response.status === 204) return undefined as T
    const body = await response.json().catch(() => undefined) as {
      error?: { code?: string; message?: string }
    } | undefined
    if (!response.ok) {
      throw new ManagementApiError(
        response.status,
        body?.error?.code ?? 'request_failed',
        body?.error?.message ?? `Request failed (${response.status})`,
        body,
      )
    }
    return body as T
  }

  async upload<T>(path: string, input: {
    bytes: Uint8Array
    filename: string
    contentType: string
    fields?: Record<string, string>
    timeoutMs?: number
  }): Promise<T> {
    const form = new FormData()
    for (const [name, value] of Object.entries(input.fields ?? {})) form.append(name, value)
    const copy = new ArrayBuffer(input.bytes.byteLength)
    new Uint8Array(copy).set(input.bytes)
    form.append('file', new Blob([copy], { type: input.contentType }), input.filename)
    const headers = new Headers()
    if (this.token) headers.set('authorization', `Bearer ${this.token}`)
    const response = await this.fetchImpl(new URL(path, `${this.baseUrl.replace(/\/+$/, '')}/`), {
      method: 'POST',
      headers,
      body: form,
      signal: AbortSignal.timeout(input.timeoutMs ?? 30_000),
    })
    const body = await response.json().catch(() => undefined) as {
      error?: { code?: string; message?: string }
    } | undefined
    if (!response.ok) {
      throw new ManagementApiError(
        response.status,
        body?.error?.code ?? 'upload_failed',
        body?.error?.message ?? `Upload failed (${response.status})`,
        body,
      )
    }
    return body as T
  }

  async download(path: string, timeoutMs = 300_000): Promise<{ bytes: Uint8Array; contentType: string | null; filename: string | null }> {
    const headers = new Headers()
    if (this.token) headers.set('authorization', `Bearer ${this.token}`)
    const response = await this.fetchImpl(new URL(path, `${this.baseUrl.replace(/\/+$/, '')}/`), {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) {
      const body = await response.json().catch(() => undefined) as { error?: { code?: string; message?: string } } | undefined
      throw new ManagementApiError(
        response.status,
        body?.error?.code ?? 'download_failed',
        body?.error?.message ?? `Download failed (${response.status})`,
        body,
      )
    }
    const disposition = response.headers.get('content-disposition')
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentType: response.headers.get('content-type'),
      filename: /filename="?([^";]+)"?/i.exec(disposition ?? '')?.[1] ?? null,
    }
  }

  info(): Promise<ManagementInfo> {
    return this.request('/api/management/v1/info')
  }

  login(email: string, password: string, deviceLabel = 'Pulpo CLI', twoFactorCode?: string): Promise<NativeAuthResponse> {
    return this.request('/api/management/v1/auth/login', { method: 'POST', body: { email, password, deviceLabel, twoFactorCode } })
  }

  logout(): Promise<void> {
    return this.request('/api/management/v1/auth/logout', { method: 'POST' })
  }

  me(): Promise<{ user: User }> {
    return this.request('/api/management/v1/auth/me')
  }

  twoFactorStatus(): Promise<TwoFactorStatus> {
    return this.request('/api/me/two-factor')
  }

  beginTwoFactorEnrollment(input: { currentPassword: string; verificationCode?: string }): Promise<TwoFactorEnrollment> {
    return this.request('/api/me/two-factor/enrollment', { method: 'POST', body: input })
  }

  confirmTwoFactorEnrollment(code: string): Promise<TwoFactorRecoveryCodes> {
    return this.request('/api/me/two-factor/enrollment/confirm', { method: 'POST', body: { code } })
  }

  regenerateTwoFactorRecoveryCodes(input: { currentPassword: string; verificationCode: string }): Promise<TwoFactorRecoveryCodes> {
    return this.request('/api/me/two-factor/recovery-codes', { method: 'POST', body: input })
  }

  disableTwoFactor(input: { currentPassword: string; verificationCode: string }): Promise<void> {
    return this.request('/api/me/two-factor', { method: 'DELETE', body: input })
  }

  tokens(): Promise<{ data: ManagementToken[] }> {
    return this.request('/api/management/v1/tokens')
  }

  createToken(input: { name: string; scopes: string[]; expiresInDays?: number }): Promise<ManagementToken & { secret: string }> {
    return this.request('/api/management/v1/tokens', { method: 'POST', body: input })
  }

  revokeToken(id: string): Promise<ManagementToken> {
    return this.request(`/api/management/v1/tokens/${encodeURIComponent(id)}/revoke`, { method: 'POST' })
  }

  settings(): Promise<ManagementSettingsDocument> {
    return this.request('/api/management/v1/settings')
  }

  accountSettings(): Promise<ManagementAccountSettingsDocument> {
    return this.request('/api/management/v1/settings/account')
  }

  instanceSettings(): Promise<ManagementInstanceSettingsDocument> {
    return this.request('/api/management/v1/settings/instance')
  }

  planAccountSettings(document: ManagementAccountSettingsDocument): Promise<{
    revision: string
    changes: ManagementSettingsChange[]
    document: ManagementAccountSettingsDocument
  }> {
    return this.request('/api/management/v1/settings/account/plan', { method: 'POST', body: { document } })
  }

  applyAccountSettings(document: ManagementAccountSettingsDocument, revision: string): Promise<ManagementAccountSettingsDocument> {
    return this.request('/api/management/v1/settings/account/apply', { method: 'POST', body: { document, revision } })
  }

  planInstanceSettings(document: ManagementInstanceSettingsDocument, secrets?: { webToolsApiKey?: string | null }): Promise<{
    revision: string
    changes: ManagementSettingsChange[]
    document: ManagementInstanceSettingsDocument
  }> {
    return this.request('/api/management/v1/settings/instance/plan', { method: 'POST', body: { document, secrets } })
  }

  applyInstanceSettings(
    document: ManagementInstanceSettingsDocument,
    revision: string,
    secrets?: { webToolsApiKey?: string | null },
  ): Promise<ManagementInstanceSettingsDocument> {
    return this.request('/api/management/v1/settings/instance/apply', { method: 'POST', body: { document, revision, secrets } })
  }

  planSettings(document: ManagementSettingsDocument, secrets?: { webToolsApiKey?: string | null }): Promise<ManagementSettingsPlan> {
    return this.request('/api/management/v1/settings/plan', { method: 'POST', body: { document, secrets } })
  }

  applySettings(document: ManagementSettingsDocument, revision: string, secrets?: { webToolsApiKey?: string | null }): Promise<ManagementSettingsDocument> {
    return this.request('/api/management/v1/settings/apply', { method: 'POST', body: { document, revision, secrets } })
  }
}
