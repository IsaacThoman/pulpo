/**
 * Set while a thread update is being started in a chat (chats/threads.ts). The message queue waits
 * while it is, so a queued message and a thread update never start together.
 */
export function threadReportDispatchKey(chatId: string): string {
  return `pulpo:chat:${chatId}:thread-report-dispatch`
}
