import { hydrateEmbeddedResponseSnapshot, lineageFromLeaf } from '@pulpo/client-core'
import { mergeResponseSnapshots, type ResponseSnapshot } from '@pulpo/contracts'
import type { ServerAttachment, ServerChat, ServerResponse } from '../../types'
import { recalledChatLabel } from './recall-label'

export interface DisplayAttachment {
  id: string
  name: string
  mimeType: string
  sizeBytes: number
  generated: boolean
}

export interface ActivityItem {
  id: string
  kind: 'tool' | 'workspace' | 'compaction' | 'recall'
  title: string
  detail: string
  status: string
  durationMs?: number
}

export interface DisplayBranch {
  id: string
  text: string
  modelId: string
  createdAt: string
}

export interface DisplayMessage {
  id: string
  responseId: string
  role: 'user' | 'assistant'
  text: string
  reasoning?: string
  modelId: string
  status: ServerResponse['status']
  createdAt: string
  latencyMs?: number
  attachments: DisplayAttachment[]
  activity: ActivityItem[]
  branch: { ids: string[]; index: number; variants: DisplayBranch[] }
  error?: string
  agentMode: boolean
  usage?: { inputTokens: number; outputTokens: number } | null
  outputItems: unknown[]
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((part) => {
    if (typeof part === 'string') return part
    const value = part as { text?: string; content?: string; refusal?: string }
    return value.text ?? value.content ?? value.refusal ?? ''
  }).join('')
}

function inputText(input: unknown[]): string {
  for (let index = input.length - 1; index >= 0; index -= 1) {
    const item = input[index] as { role?: string; content?: unknown }
    if (item.role === 'user') return textFromContent(item.content)
  }
  return ''
}

function inputAttachmentIds(input: unknown[]): string[] {
  return input.flatMap((item) => {
    const content = (item as { content?: unknown }).content
    if (!Array.isArray(content)) return []
    return content.flatMap((part) => {
      const value = part as { type?: string; attachment_id?: string }
      return value.type === 'input_file' && value.attachment_id ? [value.attachment_id] : []
    })
  })
}

function outputText(output: unknown[]): string {
  return output.flatMap((item) => {
    const value = item as { type?: string; content?: unknown }
    return value.type === 'message' ? [textFromContent(value.content)] : []
  }).filter(Boolean).join('\n\n')
}

function reasoningText(output: unknown[]): string | undefined {
  const text = output.flatMap((item) => {
    const value = item as { type?: string; summary?: unknown }
    return value.type === 'reasoning' ? [textFromContent(value.summary)] : []
  }).filter(Boolean).join('\n\n')
  return text || undefined
}

function activities(output: unknown[]): ActivityItem[] {
  return output.flatMap<ActivityItem>((item, index) => {
    const value = item as {
      id?: string; type?: string; tool?: string; output?: string; status?: string; state?: string;
      durationMs?: number; error?: string; capacity?: string;
    }
    if (value.type === 'pulpo_tool') return [{
      id: value.id ?? `tool-${index}`, kind: 'tool' as const, title: value.tool ?? 'Tool',
      detail: value.output ?? '', status: value.status ?? 'running', durationMs: value.durationMs,
    }]
    if (value.type === 'pulpo_workspace') return [{
      id: value.id ?? `workspace-${index}`, kind: 'workspace' as const, title: 'Agent workspace',
      detail: value.error ?? value.capacity ?? value.state ?? '', status: value.state ?? 'running', durationMs: value.durationMs,
    }]
    if (value.type === 'pulpo_recall') {
      const recall = value as typeof value & {
        sources?: Array<{ title?: string; updated_at?: string; excerpt?: string }>
      }
      const sources = recall.sources ?? []
      return [{
        id: value.id ?? `recall-${index}`,
        kind: 'recall',
        title: recalledChatLabel(sources.length),
        detail: sources.map((source) => [source.title, source.updated_at, source.excerpt].filter(Boolean).join('\n')).join('\n\n'),
        status: 'completed',
      }]
    }
    if (value.type === 'pulpo_compaction') {
      const compaction = value as typeof value & {
        summary?: string
        retained_turns?: Array<{ role?: string; content?: string }>
      }
      const sections = [
        compaction.summary ? `Compacted summary\n${compaction.summary}` : '',
        compaction.retained_turns?.length
          ? `Kept verbatim\n${compaction.retained_turns.map((entry) => `${(entry.role ?? 'context').toUpperCase()}\n${entry.content ?? ''}`).join('\n\n')}`
          : '',
        compaction.error ?? '',
      ].filter(Boolean)
      return [{
        id: value.id ?? `compaction-${index}`,
        kind: 'compaction',
        title: value.status === 'in_progress' ? 'Compacting context…' : value.status === 'failed' ? 'Context compaction failed' : 'Compacted context',
        detail: sections.join('\n\n'),
        status: value.status ?? 'in_progress',
        durationMs: value.durationMs ?? (typeof (value as { duration_ms?: unknown }).duration_ms === 'number' ? (value as { duration_ms: number }).duration_ms : undefined),
      }]
    }
    return []
  })
}

function generatedAttachments(output: unknown[]): DisplayAttachment[] {
  return output.flatMap((item) => {
    const value = item as { type?: string; attachment_id?: string; name?: string; mime_type?: string; size_bytes?: number }
    return value.type === 'pulpo_attachment' && value.attachment_id ? [{
      id: value.attachment_id, name: value.name ?? 'Generated file', mimeType: value.mime_type ?? 'application/octet-stream',
      sizeBytes: value.size_bytes ?? 0, generated: true,
    }] : []
  })
}

function resolvedResponseSnapshot(
  response: ServerResponse,
  liveSnapshots: Record<string, ResponseSnapshot>,
): ResponseSnapshot {
  const embedded = hydrateEmbeddedResponseSnapshot(response.snapshot, response.output)
  const live = liveSnapshots[response.id]
  return live ? mergeResponseSnapshots(embedded, live) : embedded
}

function branchVariants(
  responses: ServerResponse[],
  ids: string[],
  role: 'user' | 'assistant',
  liveSnapshots: Record<string, ResponseSnapshot>,
): DisplayBranch[] {
  const byId = new Map(responses.map((response) => [response.id, response]))
  return ids.flatMap((id) => {
    const response = byId.get(id)
    if (!response) return []
    return [{
      id,
      text: role === 'user' ? inputText(response.input) : outputText(resolvedResponseSnapshot(response, liveSnapshots).output),
      modelId: response.displayModelId ?? response.modelId,
      createdAt: response.createdAt,
    }]
  })
}

export function projectChat(chat: ServerChat, liveSnapshots: Record<string, ResponseSnapshot>): DisplayMessage[] {
  const responses = chat.responses ?? []
  const selected = lineageFromLeaf(responses, chat.activeBranchLeafId ?? chat.activeResponseId ?? responses.at(-1)?.id ?? null)
  const attachmentById = new Map((chat.attachments ?? []).map((attachment) => [attachment.id, attachment]))
  return selected.flatMap((response): DisplayMessage[] => {
    const snapshot = resolvedResponseSnapshot(response, liveSnapshots)
    const output = snapshot.output
    const status = snapshot.status
    const error = snapshot.error
    const inputAttachments = inputAttachmentIds(response.input).flatMap((id) => {
      const attachment = attachmentById.get(id)
      return attachment ? [{
        id: attachment.id, name: attachment.originalName, mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes, generated: false,
      }] : []
    })
    const errorMessage = error && typeof error === 'object' && 'message' in error
      ? String((error as { message?: unknown }).message ?? '') : undefined
    return [{
      id: `${response.id}:input`, responseId: response.id, role: 'user', text: inputText(response.input),
      modelId: response.displayModelId ?? response.modelId, status: 'completed', createdAt: response.createdAt,
      attachments: inputAttachments, activity: [], branch: {
        ...response.branches.user,
        variants: branchVariants(responses, response.branches.user.ids, 'user', liveSnapshots),
      }, agentMode: response.agentMode,
      outputItems: [],
    }, {
      id: response.id, responseId: response.id, role: 'assistant', text: outputText(output), reasoning: reasoningText(output),
      modelId: response.displayModelId ?? response.modelId, status, createdAt: response.createdAt,
      latencyMs: response.completedAt
        ? Math.max(0, Date.parse(response.completedAt) - Date.parse(response.createdAt))
        : undefined,
      attachments: generatedAttachments(output), activity: activities(output), branch: {
        ...response.branches.assistant,
        variants: branchVariants(responses, response.branches.assistant.ids, 'assistant', liveSnapshots),
      },
      error: errorMessage, agentMode: response.agentMode, usage: response.usage,
      outputItems: output,
    }]
  })
}

export function metadataForAttachment(attachment: ServerAttachment): DisplayAttachment {
  return { id: attachment.id, name: attachment.originalName, mimeType: attachment.mimeType, sizeBytes: attachment.sizeBytes, generated: false }
}
