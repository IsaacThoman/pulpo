import type { ResponseEvent, ResponseSnapshot } from '@pulpo/contracts'

function appendOutputText(output: unknown[], delta: string): unknown[] {
  const copy = structuredClone(output) as Array<Record<string, unknown>>
  let message = copy.find((item) => item.type === 'message')
  if (!message) {
    message = { type: 'message', role: 'assistant', status: 'in_progress', content: [] }
    copy.push(message)
  }
  const content = Array.isArray(message.content) ? message.content as Array<Record<string, unknown>> : []
  let part = content.find((item) => item.type === 'output_text')
  if (!part) {
    part = { type: 'output_text', text: '' }
    content.push(part)
  }
  part.text = `${typeof part.text === 'string' ? part.text : ''}${delta}`
  message.content = content
  return copy
}

function appendReasoning(output: unknown[], delta: string): unknown[] {
  const copy = structuredClone(output) as Array<Record<string, unknown>>
  let reasoning = copy.find((item) => item.type === 'reasoning')
  if (!reasoning) {
    reasoning = { type: 'reasoning', status: 'in_progress', summary: [] }
    copy.push(reasoning)
  }
  const summary = Array.isArray(reasoning.summary) ? reasoning.summary as Array<Record<string, unknown>> : []
  let part = summary.find((item) => item.type === 'summary_text')
  if (!part) {
    part = { type: 'summary_text', text: '' }
    summary.push(part)
  }
  part.text = `${typeof part.text === 'string' ? part.text : ''}${delta}`
  reasoning.summary = summary
  return copy
}

export function applyEventToSnapshot(snapshot: ResponseSnapshot, event: ResponseEvent): ResponseSnapshot {
  const payload = event.payload as { delta?: unknown }
  const delta = typeof payload.delta === 'string' ? payload.delta : ''
  let output = snapshot.output
  if (delta && event.type === 'response.output_text.delta') output = appendOutputText(output, delta)
  if (delta && event.type === 'response.reasoning_summary_text.delta') output = appendReasoning(output, delta)
  return {
    ...snapshot,
    status: snapshot.status === 'queued' ? 'in_progress' : snapshot.status,
    sequence: Math.max(snapshot.sequence, event.sequence),
    output,
    updatedAt: event.emittedAt,
  }
}
