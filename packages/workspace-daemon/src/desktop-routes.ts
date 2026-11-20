import type { IncomingMessage, ServerResponse } from 'node:http'
import { ScreenInputError, type WorkspaceDesktop } from './desktop.js'

/**
 * `/v1/desktop…`: the workspace's screen for the chat's owner, through the server. The workspace
 * controller relays only the status, `content-type` and `content-length`, so every answer is
 * carried by those alone.
 *
 *   GET  /v1/desktop                            → 200 { available, running, width, height, controlled }
 *   GET  /v1/desktop/frame?after=<id>&waitMs=   → 200 image/jpeg, or 204 when the picture did not change
 *   POST /v1/desktop/control { held }           → 200 { held }
 *   POST /v1/desktop/input { events }           → 200 { ok: true }; 409 { error: 'not_controlled' }
 *
 * On an image without a screen the last three answer 409 { error: 'no_screen' }.
 */

/** From WORKSPACE_SCREEN_FRAME_WAIT_MAX_MS in packages/contracts/src/workspace-screen.ts. */
const FRAME_WAIT_MAX_MS = 10_000
/** 64 events of 2,000 characters each, written out as JSON. */
const MAX_INPUT_BODY = 1024 * 1024

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(value))
}

/** Answers the request when it is one of the screen's; false for any other path. */
export async function desktopRoute(
  desktop: WorkspaceDesktop, request: IncomingMessage, response: ServerResponse, url: URL, readBody: (limit: number) => Promise<Buffer>,
): Promise<boolean> {
  const { pathname } = url
  if (pathname !== '/v1/desktop' && !pathname.startsWith('/v1/desktop/')) return false
  const method = request.method ?? 'GET'
  if (method === 'GET' && pathname === '/v1/desktop') {
    json(response, 200, await desktop.status())
    return true
  }
  const known = (method === 'GET' && pathname === '/v1/desktop/frame') || (method === 'POST' && (pathname === '/v1/desktop/control' || pathname === '/v1/desktop/input'))
  if (!known) { json(response, 404, { error: 'not_found' }); return true }
  if (!await desktop.available()) { json(response, 409, { error: 'no_screen' }); return true }

  if (pathname === '/v1/desktop/frame') {
    const after = url.searchParams.get('after') ?? undefined
    if (after !== undefined && !/^[a-f0-9]{8,64}$/.test(after)) throw new Error('after must name a frame')
    const waitMs = Math.min(Math.max(Math.trunc(Number(url.searchParams.get('waitMs') ?? 0)) || 0, 0), FRAME_WAIT_MAX_MS)
    const gone = new AbortController()
    response.once('close', () => gone.abort())
    let frame
    try { frame = await desktop.frames.next(after, waitMs, gone.signal) } catch (error) {
      json(response, 503, { error: error instanceof Error ? error.message : String(error) })
      return true
    }
    if (response.destroyed) return true
    if (!frame) { response.writeHead(204); response.end(); return true }
    response.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': frame.data.byteLength })
    response.end(frame.data)
    return true
  }

  const input = JSON.parse((await readBody(pathname === '/v1/desktop/input' ? MAX_INPUT_BODY : 4_096)).toString('utf8')) as unknown
  if (pathname === '/v1/desktop/control') {
    const held = (input as { held?: unknown } | null)?.held
    if (typeof held !== 'boolean') throw new Error('held must be true or false')
    json(response, 200, { held: desktop.setControl(held) })
    return true
  }
  try { await desktop.input(input) } catch (error) {
    if (!(error instanceof ScreenInputError)) throw error
    json(response, error.status, { error: error.message })
    return true
  }
  json(response, 200, { ok: true })
  return true
}
