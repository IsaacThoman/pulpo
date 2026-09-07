export type ShortcutDestination = {
  action: 'new-chat' | 'temporary-chat' | 'open-chat'
  scope: string
  requestId: string
  chatId?: string
}
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i

/** Navigation only: a URL can never send a message or choose a server/token. */
export function parseShortcutURL(value: string): ShortcutDestination | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'pulpo:' || url.hostname !== 'shortcuts' || (url.pathname !== '' && url.pathname !== '/') || url.username || url.password || url.port || url.hash) return null
    const allowed = ['action', 'scope', 'requestId', 'chatId']
    for (const key of url.searchParams.keys()) if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) return null
    const action = url.searchParams.get('action')
    const scope = url.searchParams.get('scope') ?? ''
    const requestId = url.searchParams.get('requestId') ?? ''
    if (!['new-chat', 'temporary-chat', 'open-chat'].includes(action ?? '') || !/^[\da-f]{64}$/.test(scope) || !uuid.test(requestId)) return null
    const chatId = url.searchParams.get('chatId') ?? undefined
    if (action === 'open-chat' ? !chatId || !uuid.test(chatId) : chatId !== undefined) return null
    return { action: action as ShortcutDestination['action'], scope, requestId, chatId }
  } catch { return null }
}
