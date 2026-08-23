export function shouldPersistQuery(query: { queryKey: readonly unknown[]; state: { status: string; data?: unknown } }): boolean {
  if (query.state.status !== 'success') return false
  if (typeof query.queryKey[0] === 'string' && query.queryKey[0].startsWith('admin-billing')) return false
  if (query.queryKey[0] === 'chat') {
    return !(query.state.data as { temporary?: boolean } | undefined)?.temporary
  }
  if (query.queryKey[0] === 'chats' && Array.isArray(query.state.data)) {
    return !query.state.data.some((chat) => (chat as { temporary?: boolean }).temporary)
  }
  return true
}
