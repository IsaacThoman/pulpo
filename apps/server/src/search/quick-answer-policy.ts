import { z } from 'zod'

export const searchQuickAnswerScope = 'search:quick-answer'
export const quickAnswerInput = z.strictObject({ query: z.string().trim().min(1).max(500), requestId: z.uuid() })
export const quickAnswerParams = z.strictObject({ responseId: z.uuid() })

export const searchQuickAnswerInstructions = [
  'Answer the search question directly in concise Markdown.',
  'Use web search to ground factual answers and practical instructions, including common how-to questions. Prefer primary sources and official documentation.',
  'Cite the pages you consulted with inline Markdown links next to the claims they support. Cite only sources you actually found or consulted.',
  'Keep the answer compact. Use a short list when useful, and omit narration about your process.',
].join(' ')
