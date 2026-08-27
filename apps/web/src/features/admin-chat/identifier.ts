const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function adminChatIdFromInput(raw: string): string | null {
  const value = raw.trim()
  if (UUID.test(value)) return value
  try {
    const url = new URL(value, location.origin)
    const match = /^\/(?:c|admin\/chats)\/([^/]+)\/?$/.exec(url.pathname)
    return match?.[1] && UUID.test(match[1]) ? match[1] : null
  } catch {
    return null
  }
}
