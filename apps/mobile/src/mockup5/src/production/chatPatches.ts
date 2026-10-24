/*
 * What the drawer sends to file and pin chats (PATCH /api/chats/:id), as the web sends it: the
 * server places a chat itself, above the folder's Files items, unless told where. Servers without
 * the sidebar (before 0.156) keep a chat's old position instead, so they are told.
 */

/** Pins a chat at `sortOrder`, or unpins it back into its folder (none: it stays at the top of My files). */
export function pinChatPatch(pinned: boolean, sortOrder: number, folderId: string | null | undefined, sendSortOrder = false) {
  if (pinned) return { pinned, sortOrder }
  return { pinned, ...folderId === undefined ? {} : { folderId }, ...sendSortOrder ? { sortOrder } : {} }
}

/** Files a chat in a folder (null: the top of the sidebar), at `sortOrder` only when given. */
export function moveChatPatch(folderId: string | null, sortOrder?: number) {
  return sortOrder === undefined ? { folderId } : { folderId, sortOrder }
}
