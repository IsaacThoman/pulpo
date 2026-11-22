import { fetch as expoFetch } from 'expo/fetch'
import {
  WORKSPACE_SCREEN_FRAME_HEADER,
  workspaceScreenPath,
  workspaceScreenStatusSchema,
  type WorkspaceScreenInputEventInput,
  type WorkspaceScreenStatus,
} from '@pulpo/contracts'
import { ApiError, apiRequest, apiUrl, nativeAuthorizationHeaders } from '../../api/client'
import type { FrameAnswer } from './frameLoop'

/** The server's code for an input sent while the viewer does not hold control. */
export const NOT_CONTROLLED_CODE = 'workspace_screen_not_controlled'
/** The wait happens on the server; a frame request that outlasts it by this much is stuck. */
const FRAME_TIMEOUT_MARGIN_MS = 15_000

export async function fetchWorkspaceScreenStatus(chatId: string, signal?: AbortSignal): Promise<WorkspaceScreenStatus> {
  return workspaceScreenStatusSchema.parse(await apiRequest<unknown>(workspaceScreenPath(chatId), { signal }))
}

/** One long-poll for the screen's picture; a picture is read as bytes with its id from the header. */
export async function fetchWorkspaceScreenFrame(chatId: string, after: string | undefined, waitMs: number, signal: AbortSignal): Promise<FrameAnswer> {
  const query = new URLSearchParams({ waitMs: String(waitMs) })
  if (after) query.set('after', after)
  const url = apiUrl(`${workspaceScreenPath(chatId)}/frame?${query}`)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), waitMs + FRAME_TIMEOUT_MARGIN_MS)
  const abort = () => controller.abort()
  if (signal.aborted) controller.abort()
  signal.addEventListener('abort', abort, { once: true })
  try {
    const response = await expoFetch(url, { headers: nativeAuthorizationHeaders(url), signal: controller.signal })
    if (response.status === 204) return { kind: 'unchanged' }
    if (response.status === 404) return { kind: 'gone' }
    if (!response.ok) throw new ApiError(response.status, 'request_failed', `Request failed (${response.status})`)
    const id = response.headers.get(WORKSPACE_SCREEN_FRAME_HEADER)
    if (!id) throw new ApiError(response.status, 'request_failed', 'The picture came without its id.')
    return { kind: 'frame', id, bytes: new Uint8Array(await response.arrayBuffer()) }
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener('abort', abort)
  }
}

/** Takes or renews control (`true`) or gives it back (`false`); resolves to what the server holds. */
export async function postWorkspaceScreenControl(chatId: string, held: boolean): Promise<boolean> {
  const answer = await apiRequest<{ held?: unknown }>(`${workspaceScreenPath(chatId)}/control`, { method: 'POST', body: { held } })
  return answer?.held === true
}

export async function postWorkspaceScreenInput(chatId: string, events: WorkspaceScreenInputEventInput[]): Promise<void> {
  await apiRequest<void>(`${workspaceScreenPath(chatId)}/input`, { method: 'POST', body: { events } })
}

export function isNotControlledError(error: unknown): boolean {
  return error instanceof ApiError && (error.code === NOT_CONTROLLED_CODE || error.status === 409)
}
