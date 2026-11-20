import {
  WORKSPACE_SCREEN_FRAME_HEADER,
  WORKSPACE_SCREEN_PRESENCE_SUFFIX,
  WORKSPACE_SCREEN_UNFUNDED_CODE,
  workspaceScreenPath,
  workspaceScreenPresenceSchema,
  workspaceScreenStatusSchema,
  type WorkspaceScreenPresence,
  type WorkspaceScreenStatus,
} from '@pulpo/contracts'
import { ApiError, apiRequest, authenticatedFetch, fetchApiBlobResponse } from '@/lib/api'
import type { FrameAnswer } from './frame-loop'
import type { ScreenInputEvent } from './input'

export async function fetchScreenStatus(chatId: string, signal?: AbortSignal): Promise<WorkspaceScreenStatus> {
  const body = await apiRequest<unknown>(workspaceScreenPath(chatId), { signal })
  const parsed = workspaceScreenStatusSchema.safeParse(body)
  if (!parsed.success) throw new Error('Unexpected workspace screen status')
  return parsed.data
}

/** Whether the chat's workspace is still there. Asking does not count as using the workspace. */
export async function fetchScreenPresence(chatId: string, signal?: AbortSignal): Promise<WorkspaceScreenPresence> {
  const body = await apiRequest<unknown>(`${workspaceScreenPath(chatId)}${WORKSPACE_SCREEN_PRESENCE_SUFFIX}`, { signal })
  const parsed = workspaceScreenPresenceSchema.safeParse(body)
  if (!parsed.success) throw new Error('Unexpected workspace screen presence')
  return parsed.data
}

/** The server names a frame by the first 32 hex characters of its bytes' SHA-256; the same is worked out here when the name did not come through. */
async function frameId(image: Blob): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', await image.arrayBuffer())
    return Array.from(new Uint8Array(digest).slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('')
  } catch {
    return null
  }
}

export async function fetchScreenFrame(chatId: string, after: string | undefined, waitMs: number, signal: AbortSignal): Promise<FrameAnswer> {
  const query = new URLSearchParams()
  if (after) query.set('after', after)
  query.set('waitMs', String(waitMs))
  try {
    const response = await fetchApiBlobResponse(`${workspaceScreenPath(chatId)}/frame?${query}`, { signal, cache: 'no-store' })
    if (response.status === 204) return { kind: 'unchanged' }
    const image = await response.blob()
    const header = response.headers.get(WORKSPACE_SCREEN_FRAME_HEADER)
    const id = header && /^[a-f0-9]{8,64}$/.test(header) ? header : await frameId(image)
    return { kind: 'frame', id, image }
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return { kind: 'gone' }
    if (unfunded(error)) return { kind: 'unfunded' }
    throw error
  }
}

/** Takes or renews control (`held: true`) or gives it back. Answers whether the viewer holds it now. */
export async function setScreenControl(chatId: string, held: boolean): Promise<boolean> {
  const body = await apiRequest<{ held?: unknown }>(`${workspaceScreenPath(chatId)}/control`, { method: 'POST', body: { held } })
  return body?.held === true
}

/**
 * Gives control back while the page goes away. `keepalive` lets the request outlive the page; it
 * is best effort, and control lapses by itself soon after anyway.
 */
export function releaseScreenControlOnExit(chatId: string): void {
  void authenticatedFetch(`${workspaceScreenPath(chatId)}/control`, {
    method: 'POST',
    keepalive: true,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ held: false }),
  }).catch(() => undefined)
}

export async function sendScreenInput(chatId: string, events: ScreenInputEvent[]): Promise<void> {
  await apiRequest<void>(`${workspaceScreenPath(chatId)}/input`, { method: 'POST', body: { events } })
}

/** The input or control request failed because control is no longer held, or the workspace went away. */
export function lostControl(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 409)
}

/** The request was refused because the user cannot pay for the next minute with the screen open. */
export function unfunded(error: unknown): boolean {
  return error instanceof ApiError && error.status === 402 && error.code === WORKSPACE_SCREEN_UNFUNDED_CODE
}
