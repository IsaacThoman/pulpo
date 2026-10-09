import { useQueryClient } from '@tanstack/react-query'
import type { MobileModel, ServerChat } from '@/types'
import { deleteChat, togglePin } from './data'
import { useNavigation } from './navigation'

export function useChatActions(namespace: string) {
  const queryClient = useQueryClient()
  const present = useNavigation((state) => state.present)
  return (chat: ServerChat) => present({
    name: 'actions',
    title: chat.title,
    actions: [
      { key: 'pin', label: chat.pinned ? 'Unpin' : 'Pin', icon: chat.pinned ? 'pin.slash' : 'pin', run: () => { void togglePin(queryClient, namespace, chat).catch(() => undefined) } },
      { key: 'delete', label: 'Delete', icon: 'trash', destructive: true, run: () => { void deleteChat(queryClient, namespace, chat.id).catch(() => undefined) } },
    ],
  })
}

export function useModelPicker() {
  const present = useNavigation((state) => state.present)
  return (selected: MobileModel | null, onSelect: (modelId: string) => void) => present({ name: 'models', selectedId: selected?.id ?? null, onSelect })
}
