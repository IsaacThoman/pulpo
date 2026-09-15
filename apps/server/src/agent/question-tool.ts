import { Type } from '@earendil-works/pi-ai'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { requestUserInputSchema, type AgentQuestion } from '@pulpo/contracts'

export function createQuestionTool(execute: (id: string, questions: AgentQuestion[]) => Promise<Awaited<ReturnType<AgentTool['execute']>>>): AgentTool {
  return {
    name: 'request_user_input', label: 'Ask questions', executionMode: 'sequential',
    description: 'Ask the user 1–3 useful clarification questions and wait for their answers before continuing. Each question supports one option or a custom text answer; omit options for text-only questions. Avoid unnecessary questions. Skipped questions are unanswered, never approval or consent.',
    parameters: Type.Object({ questions: Type.Array(Type.Object({
      id: Type.String({ minLength: 1, maxLength: 100 }),
      prompt: Type.String({ minLength: 1, maxLength: 2000 }),
      options: Type.Optional(Type.Array(Type.Object({ label: Type.String({ minLength: 1, maxLength: 300 }), description: Type.Optional(Type.String({ maxLength: 1000 })), recommended: Type.Optional(Type.Boolean()) }), { minItems: 2, maxItems: 6 })),
    }), { minItems: 1, maxItems: 3 }) }),
    execute: async (id, args) => execute(id, requestUserInputSchema.parse(args).questions),
  }
}
