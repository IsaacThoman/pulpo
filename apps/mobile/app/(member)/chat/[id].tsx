import { useLocalSearchParams } from 'expo-router'
import { MemberShell } from '@/features/chat/MemberShell'

export default function ExistingChatRoute() {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <MemberShell chatId={id} />
}
