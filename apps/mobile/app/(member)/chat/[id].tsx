import { useLocalSearchParams } from 'expo-router'
import { ChatScreen } from '@/features/chat/ChatScreen'

export default function ExistingChatRoute() {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <ChatScreen chatId={id} />
}
