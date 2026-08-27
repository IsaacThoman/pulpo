export function recalledChatLabel(count: number): string {
  return `Recalled from ${count} ${count === 1 ? 'chat' : 'chats'}`
}
