import { expect, it } from 'vitest'
import type { Chat } from '@/lib/types'
import { sidebarChatGroups } from './chat-groups'

it('keeps folder and loose order, excludes pinned/Files-only chats, and leaves source records untouched', () => {
  const chats = Object.freeze([
    { id: 'first', folderId: 'work' },
    { id: 'loose', folderId: null },
    { id: 'second', folderId: 'work' },
    { id: 'other', folderId: 'other' },
    { id: 'pinned', folderId: 'work', pinned: true },
    { id: 'files-root', folderId: null, inFilesRoot: true },
    { id: 'loose-second', folderId: null },
  ].map((chat) => Object.freeze(chat))) as unknown as readonly Chat[]
  const result = sidebarChatGroups(chats)
  expect(result.loose).toEqual([chats[1], chats[6]])
  expect([...result.inFolders]).toEqual([['work', [chats[0], chats[2]]], ['other', [chats[3]]]])
  expect(result.inFolders.get('work')?.[0]).toBe(chats[0])
  // A later partition owns its arrays; mutation of one result cannot change another.
  const second = sidebarChatGroups(chats)
  result.inFolders.get('work')?.pop()
  expect(second.inFolders.get('work')).toEqual([chats[0], chats[2]])
})
