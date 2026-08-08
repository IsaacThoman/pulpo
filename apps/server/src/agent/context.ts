import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { sanitizeContextForStorage } from '../responses/public-output.js'

export function messagesForPersistence(messages: AgentMessage[]): AgentMessage[] {
  return sanitizeContextForStorage(messages)
}
