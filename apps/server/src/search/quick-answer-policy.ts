import { z } from 'zod'

export const searchQuickAnswerScope = 'search:quick-answer'
export const quickAnswerInput = z.strictObject({ query: z.string().trim().min(1).max(500), requestId: z.uuid() })
export const quickAnswerParams = z.strictObject({ responseId: z.uuid() })

export const searchQuickAnswerInstructions = [
  'Answer the search question directly in concise Markdown.',
  'Verify current or version-dependent facts with web search. Use official documentation when answering about software commands or version-specific behavior.',
  'Cite pages you consulted with inline Markdown links next to the claims they support.',
  'Keep the answer compact. Use a short list when useful, and omit narration about your process.',
].join(' ')
