import type { ActivityStep, PrototypeAttachment, PrototypeMessage, ResponseBranch } from '../domain'

function sameAttachments(left?: PrototypeAttachment[], right?: PrototypeAttachment[]): boolean {
  if (left === right) return true
  if ((left?.length ?? 0) !== (right?.length ?? 0)) return false
  return (left ?? []).every((item, index) => {
    const other = right?.[index]
    return item.id === other?.id && item.name === other.name && item.uri === other.uri
      && item.mimeType === other.mimeType && item.sizeBytes === other.sizeBytes
      && item.kind === other.kind && item.status === other.status && item.progress === other.progress
      && item.error === other.error
  })
}

function sameActivity(left?: ActivityStep[], right?: ActivityStep[]): boolean {
  if (left === right) return true
  if ((left?.length ?? 0) !== (right?.length ?? 0)) return false
  return (left ?? []).every((item, index) => {
    const other = right?.[index]
    const itemOutput = 'output' in item ? item.output : undefined
    const otherOutput = other && 'output' in other ? other.output : undefined
    return item.id === other?.id && item.kind === other.kind && item.title === other.title
      && item.detail === other.detail && itemOutput === otherOutput && item.durationMs === other.durationMs
      && item.status === other.status
  })
}

function sameBranches(left?: ResponseBranch[], right?: ResponseBranch[]): boolean {
  if (left === right) return true
  if ((left?.length ?? 0) !== (right?.length ?? 0)) return false
  return (left ?? []).every((item, index) => {
    const other = right?.[index]
    return item.id === other?.id && item.text === other.text && item.modelId === other.modelId
      && item.createdAt === other.createdAt
  })
}

function sameOutput(left?: unknown[], right?: unknown[]): boolean {
  return left === right || ((left?.length ?? 0) === 0 && (right?.length ?? 0) === 0)
}

export function projectedMessageUnchanged(left: PrototypeMessage, right: PrototypeMessage): boolean {
  return left.id === right.id && left.role === right.role && left.text === right.text
    && left.requestReceivedAt === right.requestReceivedAt && left.firstReplyTextAt === right.firstReplyTextAt
    && left.initialResponseDurationMs === right.initialResponseDurationMs
    && left.createdAt === right.createdAt && left.latencyMs === right.latencyMs && left.modelId === right.modelId
    && left.status === right.status && left.error === right.error && left.meta === right.meta
    && left.feedback === right.feedback && left.activeBranch === right.activeBranch
    && left.agentMode === right.agentMode
    && sameAttachments(left.attachments, right.attachments)
    && sameActivity(left.activity, right.activity)
    && sameBranches(left.branches, right.branches)
    && sameOutput(left.outputItems, right.outputItems)
}

/** Keep historical message references stable while only the streaming response changes. */
export function reuseProjectedMessages(
  previous: PrototypeMessage[],
  projected: PrototypeMessage[],
): PrototypeMessage[] {
  const previousById = new Map(previous.map((message) => [message.id, message]))
  let changed = previous.length !== projected.length
  const next = projected.map((message, index) => {
    const existing = previousById.get(message.id)
    const value = existing && projectedMessageUnchanged(existing, message) ? existing : message
    if (value !== previous[index]) changed = true
    return value
  })
  return changed ? next : previous
}
