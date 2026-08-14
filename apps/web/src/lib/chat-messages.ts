import type { EmbeddedResponseSnapshot, ResponseSnapshot } from '@pulpo/contracts'
import type { Attachment, Message } from '@/lib/types'

export interface ChatResponseDto {
  id: string
  parentResponseId?: string | null
  userMessageId?: string | null
  modelId: string
  displayModelId?: string
  status: ResponseSnapshot['status']
  input: unknown[]
  output: unknown[]
  presetSelections: Record<string, string>
  usage: { inputTokens: number; outputTokens: number } | null
  error: { message?: string } | null
  createdAt: string
  completedAt: string | null
  agentMode?: boolean
  snapshot?: ResponseSnapshot | EmbeddedResponseSnapshot
  branches?: {
    user: { ids: string[]; index: number }
    assistant: { ids: string[]; index: number }
  }
  detailAvailable?: boolean
}

export interface ChatAttachmentDto {
  id: string
  originalName: string
  mimeType: string
  sizeBytes: number
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((part) => {
    if (typeof part === 'string') return part
    const typed = part as { text?: string; content?: string; refusal?: string }
    return typed.text ?? typed.content ?? typed.refusal ?? ''
  }).join('')
}

export function outputText(output: unknown[]): string {
  return output.map((item) => {
    const typed = item as { type?: string; content?: unknown }
    return typed.type === 'message' ? textFromContent(typed.content) : ''
  }).filter(Boolean).join('')
}

export function reasoningText(output: unknown[]): string | undefined {
  const parts = output.flatMap((item) => {
    const typed = item as { type?: string; summary?: unknown[] }
    return typed.type === 'reasoning' ? typed.summary ?? [] : []
  })
  const text = textFromContent(parts)
  return text || undefined
}

function inputText(input: unknown[]): string {
  for (let index = input.length - 1; index >= 0; index -= 1) {
    const item = input[index] as { role?: string; content?: unknown }
    if (item.role === 'user') return textFromContent(item.content)
  }
  return ''
}

function attachmentIdsFromInput(input: unknown[]): string[] {
  return input.flatMap((item) => {
    const content = (item as { content?: unknown }).content
    if (!Array.isArray(content)) return []
    return content.flatMap((part) => {
      const typed = part as { type?: string; attachment_id?: string }
      return typed.type === 'input_file' && typed.attachment_id ? [typed.attachment_id] : []
    })
  })
}

export function attachmentsFromOutput(output: unknown[], metadata: Map<string, ChatAttachmentDto>): Attachment[] {
  return output.flatMap((item): Attachment[] => {
    const value = item as { type?: string; attachment_id?: string; name?: string; mime_type?: string; size_bytes?: number }
    if (value.type !== 'pulpo_attachment' || !value.attachment_id) return []
    const stored = metadata.get(value.attachment_id)
    const mimeType = stored?.mimeType ?? value.mime_type ?? 'application/octet-stream'
    return [{
      id: value.attachment_id,
      name: stored?.originalName ?? value.name ?? 'attachment',
      mimeType,
      type: mimeType.startsWith('image/') ? 'image' : 'file',
      size: stored?.sizeBytes ?? value.size_bytes ?? 0,
    }]
  })
}

export function messagesFromResponses(responses: ChatResponseDto[], attachmentRows: ChatAttachmentDto[]): Message[] {
  const attachments = new Map(attachmentRows.map((attachment) => [attachment.id, attachment]))
  return responses.flatMap((response) => {
    const timestamp = Date.parse(response.createdAt)
    const done = !['queued', 'in_progress'].includes(response.status)
    const messageAttachments = attachmentIdsFromInput(response.input).flatMap((id): Attachment[] => {
      const attachment = attachments.get(id)
      return attachment ? [{
        id: attachment.id,
        name: attachment.originalName,
        mimeType: attachment.mimeType,
        type: attachment.mimeType.startsWith('image/') ? 'image' : 'file',
        size: attachment.sizeBytes,
      }] : []
    })
    return [
      {
        id: `${response.id}:input`, role: 'user' as const, content: inputText(response.input),
        timestamp, done: true, branch: response.branches?.user, attachments: messageAttachments,
        agentMode: response.agentMode,
      },
      {
        id: response.id, role: 'assistant' as const, content: outputText(response.output),
        modelId: response.displayModelId ?? response.modelId, timestamp: timestamp + 1, done,
        reasoning: reasoningText(response.output), presetSelections: response.presetSelections,
        tokensIn: response.usage?.inputTokens, tokensOut: response.usage?.outputTokens,
        latencyMs: response.completedAt ? Math.max(0, Date.parse(response.completedAt) - timestamp) : undefined,
        error: response.error?.message,
        agentMode: response.agentMode,
        outputItems: response.output,
        attachments: attachmentsFromOutput(response.output, attachments),
        branch: response.branches?.assistant,
      },
    ]
  })
}
