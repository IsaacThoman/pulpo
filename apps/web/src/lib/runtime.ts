import { normalizeInstanceUrl } from '@pulpo/client-core'

export interface DesktopStoredSession {
  instanceUrl: string
  token: string
  expiresAt: string
}

interface DesktopApi {
  platform: 'desktop'
  os: 'darwin' | 'win32' | 'linux'
  session: {
    load(): Promise<DesktopStoredSession | null>
    store(session: DesktopStoredSession): Promise<void>
    clear(): Promise<void>
  }
  openExternal(url: string): Promise<void>
  onProtocolUrl(listener: (url: string) => void): () => void
  onCommand(listener: (command: 'new-chat' | 'settings') => void): () => void
  appInfo(): Promise<{ name: string; version: string; packaged: boolean }>
  windowControls: {
    minimize(): Promise<void>
    toggleMaximize(): Promise<boolean>
    close(): Promise<void>
    isMaximized(): Promise<boolean>
    onMaximizedChanged(listener: (maximized: boolean) => void): () => void
  }
}

declare global {
  interface Window { pulpoDesktop?: DesktopApi }
}

const DEFAULT_INSTANCE = 'https://pulpo.baby'
const INSTANCE_KEY = 'pulpo-desktop-instance'

let instanceUrl = readInstance()
let sessionToken: string | null = null
let unauthorizedHandler: (() => void) | undefined

function readInstance(): string {
  if (typeof window === 'undefined' || !window.pulpoDesktop) return DEFAULT_INSTANCE
  try {
    return normalizeInstanceUrl(localStorage.getItem(INSTANCE_KEY) ?? DEFAULT_INSTANCE, true)
  } catch {
    return DEFAULT_INSTANCE
  }
}

export function isDesktopRuntime(): boolean {
  return typeof window !== 'undefined' && Boolean(window.pulpoDesktop)
}

export function runtimeInstanceUrl(): string {
  if (isDesktopRuntime()) return instanceUrl
  return typeof window !== 'undefined' && window.location?.origin ? window.location.origin : DEFAULT_INSTANCE
}

export function runtimeSessionToken(): string | null {
  return sessionToken
}

export function configureDesktopRuntime(input: {
  instanceUrl: string
  token: string | null
  onUnauthorized?: () => void
}): void {
  instanceUrl = normalizeInstanceUrl(input.instanceUrl, true)
  sessionToken = input.token
  unauthorizedHandler = input.onUnauthorized
  localStorage.setItem(INSTANCE_KEY, instanceUrl)
}

export function desktopUnauthorized(): void {
  unauthorizedHandler?.()
}

export function runtimeApiUrl(path: string): string {
  if (!isDesktopRuntime()) return path
  return new URL(path, `${instanceUrl}/`).toString()
}

export function runtimeResourceUrl(url: string): string {
  if (!isDesktopRuntime()) return url
  return new URL(url, `${instanceUrl}/`).toString()
}

export function runtimeUrlTargetsInstance(url: string): boolean {
  if (!isDesktopRuntime()) return false
  return new URL(runtimeApiUrl(url)).origin === new URL(instanceUrl).origin
}

export function runtimeAuthorizationHeaders(url: string): Record<string, string> {
  if (!isDesktopRuntime() || !sessionToken) return {}
  return runtimeUrlTargetsInstance(url)
    ? { authorization: `Bearer ${sessionToken}` }
    : {}
}

export function runtimeAccountKey(userId: string): string {
  return isDesktopRuntime() ? `${new URL(instanceUrl).origin}|${userId}` : userId
}

export function runtimeProfileKey(): string {
  return isDesktopRuntime() ? `pulpo-profile:${new URL(instanceUrl).origin}` : 'pulpo-profile'
}

export async function openExternalUrl(url: string): Promise<void> {
  if (window.pulpoDesktop) await window.pulpoDesktop.openExternal(url)
  else window.location.assign(url)
}

export async function loadDesktopSession(): Promise<DesktopStoredSession | null> {
  return window.pulpoDesktop?.session.load() ?? null
}

export async function storeDesktopSession(session: DesktopStoredSession): Promise<void> {
  await window.pulpoDesktop?.session.store(session)
}

export async function clearDesktopSession(): Promise<void> {
  await window.pulpoDesktop?.session.clear()
}

export function onDesktopProtocolUrl(listener: (url: string) => void): () => void {
  return window.pulpoDesktop?.onProtocolUrl(listener) ?? (() => undefined)
}
