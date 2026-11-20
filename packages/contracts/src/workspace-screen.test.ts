import { describe, expect, it } from 'vitest'
import { agentSettingsSchema } from './index.js'
import {
  WORKSPACE_SCREEN_HEIGHT, WORKSPACE_SCREEN_INPUT_MAX_EVENTS, WORKSPACE_SCREEN_WIDTH,
  workspaceScreenFrameQuerySchema, workspaceScreenInputSchema, workspaceScreenPath,
} from './workspace-screen.js'

describe('workspace screen contracts', () => {
  it('leaves the screen off until an admin turns it on', () => {
    expect(agentSettingsSchema.parse({}).workspaceDesktop).toBe(false)
    expect(agentSettingsSchema.parse({ workspaceDesktop: true }).workspaceDesktop).toBe(true)
  })

  it('builds the route for a chat', () => {
    expect(workspaceScreenPath('0199-a/b')).toBe('/api/chats/0199-a%2Fb/workspace-screen')
  })

  it('fills in the defaults of pointer events', () => {
    const { events } = workspaceScreenInputSchema.parse({ events: [
      { type: 'click', x: 10, y: 20 },
      { type: 'down', x: 1, y: 2, button: 'right' },
      { type: 'scroll', x: 5, y: 5, dy: 3 },
      { type: 'text', text: 'héllo' },
      { type: 'key', keys: 'ctrl+a' },
    ] })
    expect(events[0]).toEqual({ type: 'click', x: 10, y: 20, button: 'left', count: 1 })
    expect(events[1]).toEqual({ type: 'down', x: 1, y: 2, button: 'right' })
    expect(events[2]).toEqual({ type: 'scroll', x: 5, y: 5, dx: 0, dy: 3 })
  })

  it('refuses points off the screen, empty scrolls and oversized batches', () => {
    const one = (event: unknown) => workspaceScreenInputSchema.safeParse({ events: [event] }).success
    expect(one({ type: 'move', x: WORKSPACE_SCREEN_WIDTH + 1, y: 0 })).toBe(false)
    expect(one({ type: 'move', x: 0, y: WORKSPACE_SCREEN_HEIGHT + 1 })).toBe(false)
    expect(one({ type: 'move', x: -1, y: 0 })).toBe(false)
    expect(one({ type: 'scroll', x: 0, y: 0 })).toBe(false)
    expect(one({ type: 'text', text: '' })).toBe(false)
    expect(workspaceScreenInputSchema.safeParse({ events: [] }).success).toBe(false)
    const many = Array.from({ length: WORKSPACE_SCREEN_INPUT_MAX_EVENTS + 1 }, () => ({ type: 'move', x: 1, y: 1 }))
    expect(workspaceScreenInputSchema.safeParse({ events: many }).success).toBe(false)
  })

  it('reads the frame query as it arrives in a URL', () => {
    expect(workspaceScreenFrameQuerySchema.parse({ after: 'a1b2c3d4e5f60718', waitMs: '8000' })).toEqual({ after: 'a1b2c3d4e5f60718', waitMs: 8000 })
    expect(workspaceScreenFrameQuerySchema.safeParse({ after: '../etc' }).success).toBe(false)
    expect(workspaceScreenFrameQuerySchema.safeParse({ waitMs: '60000' }).success).toBe(false)
  })
})
