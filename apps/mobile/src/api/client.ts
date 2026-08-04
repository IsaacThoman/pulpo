import type { MobileConfig, NativeAuthResponse, User } from '@pulpo/contracts'
import type { MobileModel, ServerChat, ServerDeletedChat, ServerFolder } from '../types'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

let instanceUrl = process.env.EXPO_PUBLIC_DEFAULT_INSTANCE_URL ?? 'https://pulpo.baby'
let sessionToken: string | null = null
let unauthorizedHandler: (() => void) | undefined

export function configureApi(input: {
  instanceUrl: string
  token: string | null
  onUnauthorized?: () => void
}): void {
  instanceUrl = input.instanceUrl.replace(/\/+$/, '')
  sessionToken = input.token
  unauthorizedHandler = input.onUnauthorized
}

export function apiOrigin(): string {
  return instanceUrl
}

export function nativeAuthorizationHeaders(url?: string): Record<string, string> {
  if (!sessionToken || (url && new URL(url).origin !== new URL(instanceUrl).origin)) return {}
  return { authorization: `Bearer ${sessionToken}` }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown
  auth?: boolean
  idempotencyKey?: string
  timeoutMs?: number
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers)
  if (options.body !== undefined) headers.set('content-type', 'application/json')
  if (options.idempotencyKey) headers.set('idempotency-key', options.idempotencyKey)
  if (options.auth !== false && sessionToken) headers.set('authorization', `Bearer ${sessionToken}`)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000)
  const abort = () => controller.abort()
  options.signal?.addEventListener('abort', abort, { once: true })
  let response: Response
  try {
    response = await fetch(`${instanceUrl}${path}`, {
      ...options,
      headers,
      signal: controller.signal,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
  } catch (error) {
    if (controller.signal.aborted && !options.signal?.aborted) {
      throw new ApiError(408, 'request_timeout', 'The Pulpo instance did not respond in time.')
    }
    throw error
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', abort)
  }
  if (response.status === 204) return undefined as T
  const body = await response.json().catch(() => undefined) as {
    error?: { message?: string; code?: string }
  } | undefined
  if (!response.ok) {
    if (response.status === 401 && options.auth !== false) unauthorizedHandler?.()
    throw new ApiError(
      response.status,
      body?.error?.code ?? 'request_failed',
      body?.error?.message ?? `Request failed (${response.status})`,
      body,
    )
  }
  return body as T
}

export const mobileApi = {
  config: () => apiRequest<MobileConfig>('/api/mobile/config', { auth: false }),
  login: (email: string, password: string, deviceLabel: string) =>
    apiRequest<NativeAuthResponse>('/api/mobile/auth/login', {
      method: 'POST', auth: false, body: { email, password, deviceLabel },
    }),
  signup: (name: string, email: string, password: string, deviceLabel: string) =>
    apiRequest<NativeAuthResponse>('/api/mobile/auth/signup', {
      method: 'POST', auth: false, body: { name, email, password, deviceLabel },
    }),
  logout: () => apiRequest<void>('/api/mobile/auth/logout', { method: 'POST' }),
  me: () => apiRequest<{ user: User }>('/api/mobile/me'),
  updateProfile: (name: string) => apiRequest<{ user: User }>('/api/me', { method: 'PATCH', body: { name } }),
  changePassword: (currentPassword: string, newPassword: string) =>
    apiRequest<void>('/api/me/password', { method: 'POST', body: { currentPassword, newPassword } }),
  forgotPassword: (email: string) => apiRequest<{ accepted: true }>('/api/auth/forgot-password', {
    method: 'POST', auth: false, body: { email },
  }),
  chats: () => apiRequest<{ data: ServerChat[] }>('/api/chats'),
  deletedChats: () => apiRequest<{ data: ServerDeletedChat[] }>('/api/chats/deleted'),
  chat: (id: string) => apiRequest<ServerChat>(`/api/chats/${id}`),
  models: () => apiRequest<{ agentAvailable: boolean; data: MobileModel[] }>('/api/models'),
  folders: () => apiRequest<{ data: ServerFolder[] }>('/api/folders'),
}

export function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError
    || (error instanceof ApiError && (error.code === 'request_timeout' || error.status >= 500))
}
