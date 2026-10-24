// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { moveChatPatch, pinChatPatch } from './chatPatches'

describe('what the drawer sends to file and pin chats', () => {
  it('pins at the end of the pinned list', () => {
    expect(pinChatPatch(true, 7, 'work')).toEqual({ pinned: true, sortOrder: 7 })
  })

  it('unpins back into the folder, which the server places it at the top of', () => {
    expect(pinChatPatch(false, -3, 'work')).toEqual({ pinned: false, folderId: 'work' })
    expect(pinChatPatch(false, -3, null)).toEqual({ pinned: false, folderId: null })
  })

  it('leaves a chat at the top of My files there: sending a folder would file it in the sidebar', () => {
    expect(pinChatPatch(false, -3, undefined)).toEqual({ pinned: false })
  })

  it('tells servers without the sidebar where, as they keep the old position otherwise', () => {
    expect(pinChatPatch(false, -3, 'work', true)).toEqual({ pinned: false, folderId: 'work', sortOrder: -3 })
    expect(moveChatPatch('work', -3)).toEqual({ folderId: 'work', sortOrder: -3 })
    expect(moveChatPatch(null)).toEqual({ folderId: null })
  })
})
