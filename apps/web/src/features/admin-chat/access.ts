export interface AdminChatGrant {
  accessToken: string
  accessId: string
  expiresAt: string
  chatId: string
  owner: {
    id: string
    email: string
    name: string
    username: string
    role: 'pending' | 'user' | 'admin'
    blocked: boolean
  }
}

let activeGrant: AdminChatGrant | null = null
const listeners = new Set<() => void>()

export function getAdminChatGrant(): AdminChatGrant | null {
  return activeGrant
}

export function setAdminChatGrant(grant: AdminChatGrant): void {
  activeGrant = grant
  for (const listener of listeners) listener()
}

export function clearAdminChatGrant(): void {
  if (!activeGrant) return
  activeGrant = null
  for (const listener of listeners) listener()
}

export function subscribeAdminChatGrant(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function adminChatAccessActive(): boolean {
  return Boolean(getAdminChatGrant())
}

export function adminChatAccountKey(): string | null {
  const grant = getAdminChatGrant()
  return grant ? `admin-chat:${grant.accessId}` : null
}

function targetsScopedResource(path: string, chatId: string): boolean {
  const pathname = path.split('?')[0] ?? path
  return pathname === `/api/chats/${chatId}`
    || pathname.startsWith(`/api/chats/${chatId}/`)
    || pathname.startsWith('/api/messages/')
    || pathname.startsWith('/api/responses/')
    || pathname === '/api/attachments'
    || pathname.startsWith('/api/attachments/')
    || pathname === '/api/chat-shares'
    || pathname.startsWith('/api/chat-shares/')
    || pathname === '/api/folders'
}

export function adminChatAccessHeaders(path: string): Record<string, string> {
  const grant = getAdminChatGrant()
  if (!grant || !targetsScopedResource(path, grant.chatId)) return {}
  return { 'x-pulpo-admin-chat-access': grant.accessToken }
}
