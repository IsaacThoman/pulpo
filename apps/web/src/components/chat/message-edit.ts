export function canSubmitMessageEdit(input: {
  role: 'user' | 'assistant' | 'system'
  draft: string
  originalContent: string
  hasAttachments: boolean
}): boolean {
  const content = input.draft.trim()
  if (input.role === 'user') return Boolean(content) || input.hasAttachments
  return Boolean(content) && content !== input.originalContent
}
