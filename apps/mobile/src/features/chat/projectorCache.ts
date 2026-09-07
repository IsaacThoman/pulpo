import type { ResponseSnapshot } from '@pulpo/contracts'
import type { ServerChat } from '../../types'
import { createChatProjector } from './projection'
const projectors = new Map<string, ReturnType<typeof createChatProjector>>()
export function projectResidentChat(chat: ServerChat, snapshots: Record<string, ResponseSnapshot>) {
  let projector = projectors.get(chat.id)
  if (!projector) { projector = createChatProjector(); projectors.set(chat.id, projector) }
  return projector(chat, snapshots)
}
export function releaseChatProjector(id: string): void { projectors.delete(id) }
export function clearChatProjectors(): void { projectors.clear() }
