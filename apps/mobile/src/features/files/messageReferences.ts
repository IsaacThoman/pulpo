import { splitFileReferences, type FileReference } from '@pulpo/contracts'

/**
 * A sent message as it is shown: a user message's last paragraph of links to Files items is its
 * references, shown as cards beside its attachments, and the bubble holds the rest. Links written
 * within a sentence stay in the text, and replies are shown as written.
 */
export function sentMessageParts(role: 'user' | 'assistant', content: string): { text: string; references: FileReference[] } {
  if (role !== 'user') return { text: content, references: [] }
  return splitFileReferences(content)
}

/**
 * What copying, sharing, quoting, or reading a message aloud uses: its text without the reference
 * links, or the names of the items it mentions when that is all it has.
 */
export function sentMessageReadableText(role: 'user' | 'assistant', content: string): string {
  const { text, references } = sentMessageParts(role, content)
  return text || references.map((reference) => reference.name).join(', ')
}
