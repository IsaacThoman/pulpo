import { ApiError } from '@/lib/api'

export function adminAccessRequiredChatId(chatId: string | undefined, error: unknown): string | null {
  return chatId && error instanceof ApiError && error.code === 'chat_not_in_account'
    ? chatId
    : null
}
