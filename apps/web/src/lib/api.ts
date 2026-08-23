export interface ApiErrorBody {
  error?: {
    message?: string
    type?: string
    code?: string
    param?: string | null
  }
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly body?: unknown

  constructor(
    status: number,
    code: string,
    message: string,
    body?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.body = body
  }
}

export interface ApiRequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown
  idempotencyKey?: string
}

export function authenticatedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  for (const [key, value] of Object.entries(runtimeAuthorizationHeaders(input))) headers.set(key, value)
  return fetch(runtimeApiUrl(input), {
    ...init,
    headers,
    credentials: isDesktopRuntime() ? 'omit' : input.startsWith('/api/') ? 'include' : init.credentials,
  })
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers)
  const formBody = typeof FormData !== 'undefined' && options.body instanceof FormData
  if (options.body !== undefined && !formBody) headers.set('content-type', 'application/json')
  if (options.idempotencyKey) headers.set('idempotency-key', options.idempotencyKey)
  for (const [key, value] of Object.entries(runtimeAuthorizationHeaders(path))) headers.set(key, value)
  const response = await authenticatedFetch(path, {
    ...options,
    headers,
    credentials: isDesktopRuntime() ? 'omit' : 'include',
    body: options.body === undefined ? undefined : formBody ? options.body as FormData : JSON.stringify(options.body),
  })
  if (response.status === 204) return undefined as T
  const body = await response.json().catch(() => undefined) as ApiErrorBody | undefined
  if (!response.ok) {
    if (response.status === 401 && isDesktopRuntime()) desktopUnauthorized()
    throw new ApiError(
      response.status,
      body?.error?.code ?? 'request_failed',
      body?.error?.message ?? `Request failed (${response.status})`,
      body,
    )
  }
  return body as T
}

export function apiDownloadUrl(path: string): string {
  return runtimeApiUrl(path)
}

export async function downloadApiFile(path: string, suggestedName?: string): Promise<void> {
  const response = await authenticatedFetch(path)
  if (!response.ok) throw new Error(`Download failed (${response.status})`)
  const blobUrl = URL.createObjectURL(await response.blob())
  const anchor = document.createElement('a')
  anchor.href = blobUrl
  if (suggestedName) anchor.download = suggestedName
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1_000)
}

export function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof ApiError && error.status >= 500)
}
import {
  desktopUnauthorized,
  isDesktopRuntime,
  runtimeApiUrl,
  runtimeAuthorizationHeaders,
} from './runtime'
