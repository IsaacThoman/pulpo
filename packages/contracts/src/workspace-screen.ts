import { z } from 'zod'

/**
 * The screen of a cloud agent workspace: a virtual display inside the disposable VM. The agent
 * works on it with the app tools (`app_list`, `app_view`, `app_click`, …), and the chat's owner can
 * watch it and take it over, to sign in to a site for example. Nothing here involves the user's own
 * computer; that is `computer.ts`.
 *
 * A viewer asks for the picture again and again (`…/frame`, a long-poll that answers when the
 * picture changed) and, while it holds control, sends what the user does (`…/input`). Control is
 * held by renewing it; a viewer that goes away loses it by itself. While it is held the agent can
 * still look at the screen but not act on it.
 */

/** The screen's size in pixels. Pictures of it are never scaled, so a point in one is a point on the screen. */
export const WORKSPACE_SCREEN_WIDTH = 1_280
export const WORKSPACE_SCREEN_HEIGHT = 800

/** Control lapses this long after it was last taken or renewed. */
export const WORKSPACE_SCREEN_CONTROL_TTL_MS = 20_000
/** How often a viewer in control renews it. */
export const WORKSPACE_SCREEN_CONTROL_RENEW_MS = 5_000
/** The longest one frame request waits for the picture to change. */
export const WORKSPACE_SCREEN_FRAME_WAIT_MAX_MS = 10_000
/** The most events one input request carries; a viewer batches what happened since its last one. */
export const WORKSPACE_SCREEN_INPUT_MAX_EVENTS = 64
/** The most text one `text` event types. */
export const WORKSPACE_SCREEN_INPUT_MAX_TEXT = 2_000

/** `/api/chats/:chatId/workspace-screen`, the root of the routes below. */
export const workspaceScreenPath = (chatId: string) => `/api/chats/${encodeURIComponent(chatId)}/workspace-screen`
/** The response header of `…/frame` that names the picture; sent back as `after` to wait for the next one. */
export const WORKSPACE_SCREEN_FRAME_HEADER = 'x-pulpo-frame'

export const workspaceScreenStatusSchema = z.object({
  /**
   * `ready`: the chat has a running workspace with a screen. `none`: no workspace is running for
   * the chat (none was started yet, or it was deleted after sitting idle). `unavailable`: this
   * instance has the screen turned off, or its workspace image has none.
   */
  state: z.enum(['ready', 'none', 'unavailable']),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** A viewer holds control right now, in this tab or another. */
  controlled: z.boolean(),
  /**
   * What a minute with the screen open costs the user, in millionths of a dollar; 0 or absent when
   * the instance does not bill for workspaces. A minute is charged when it starts, and none while a
   * reply has the workspace, since the reply pays for it then.
   */
  pricePerMinuteMicros: z.number().int().nonnegative().optional(),
})
export type WorkspaceScreenStatus = z.infer<typeof workspaceScreenStatusSchema>

/**
 * Whether the chat's workspace is still there, from the server's own records. Unlike the status,
 * asking this does not reach the workspace and does not count as using it, so a client may ask
 * whenever it wants to know whether to offer the screen at all.
 */
export const workspaceScreenPresenceSchema = z.object({
  /** A workspace is running for the chat on an instance that gives workspaces a screen. */
  live: z.boolean(),
  /** When it shuts down unless the agent or a viewer uses it before then; null when none is running. */
  expiresAt: z.string().nullable(),
})
export type WorkspaceScreenPresence = z.infer<typeof workspaceScreenPresenceSchema>
/** `…/presence`, under `workspaceScreenPath(chatId)`. */
export const WORKSPACE_SCREEN_PRESENCE_SUFFIX = '/presence'
/** The error code of a viewer request refused because the user cannot pay for the next minute (HTTP 402). */
export const WORKSPACE_SCREEN_UNFUNDED_CODE = 'insufficient_balance'

export const workspaceScreenFrameQuerySchema = z.object({
  /** The frame the viewer already shows; the answer waits until the picture differs from it. */
  after: z.string().regex(/^[a-f0-9]{8,64}$/).optional(),
  waitMs: z.coerce.number().int().min(0).max(WORKSPACE_SCREEN_FRAME_WAIT_MAX_MS).optional(),
})

export const workspaceScreenControlSchema = z.object({
  /** True takes control or renews it; false gives it back. */
  held: z.boolean(),
})
export type WorkspaceScreenControl = z.infer<typeof workspaceScreenControlSchema>

const screenX = z.number().finite().min(0).max(WORKSPACE_SCREEN_WIDTH)
const screenY = z.number().finite().min(0).max(WORKSPACE_SCREEN_HEIGHT)
const screenButton = z.enum(['left', 'middle', 'right']).default('left')

/**
 * One thing the user did while in control. Points are screen pixels from the top-left corner.
 * `key` is one key or chord in the app tools' own words (`enter`, `backspace`, `ctrl+a`,
 * `shift+tab`); `text` is typed as characters, so any character works.
 */
export const workspaceScreenInputEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('move'), x: screenX, y: screenY }),
  z.object({ type: z.literal('down'), x: screenX, y: screenY, button: screenButton }),
  z.object({ type: z.literal('up'), x: screenX, y: screenY, button: screenButton }),
  /** A whole click at once, for viewers that only know taps. */
  z.object({ type: z.literal('click'), x: screenX, y: screenY, button: screenButton, count: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1) }),
  /** Wheel notches at a point; positive `dy` moves down the page, positive `dx` to the right. */
  z.object({
    type: z.literal('scroll'), x: screenX, y: screenY,
    dx: z.number().int().min(-20).max(20).default(0),
    dy: z.number().int().min(-20).max(20).default(0),
  }).refine((value) => value.dx !== 0 || value.dy !== 0, 'Scroll by at least one notch'),
  z.object({ type: z.literal('text'), text: z.string().min(1).max(WORKSPACE_SCREEN_INPUT_MAX_TEXT) }),
  z.object({ type: z.literal('key'), keys: z.string().min(1).max(100) }),
])
export type WorkspaceScreenInputEvent = z.infer<typeof workspaceScreenInputEventSchema>
export type WorkspaceScreenInputEventInput = z.input<typeof workspaceScreenInputEventSchema>

/**
 * Text cut into pieces one `text` event may carry. The limit counts UTF-16 units, as the schema's
 * does, and a character written as two of them (an emoji) is never cut in half.
 */
export function workspaceScreenTextChunks(text: string): string[] {
  const chunks: string[] = []
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + WORKSPACE_SCREEN_INPUT_MAX_TEXT, text.length)
    const last = text.charCodeAt(end - 1)
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end -= 1
    chunks.push(text.slice(start, end))
    start = end
  }
  return chunks
}

export const workspaceScreenInputSchema = z.object({
  events: z.array(workspaceScreenInputEventSchema).min(1).max(WORKSPACE_SCREEN_INPUT_MAX_EVENTS),
})
export type WorkspaceScreenInput = z.infer<typeof workspaceScreenInputSchema>
