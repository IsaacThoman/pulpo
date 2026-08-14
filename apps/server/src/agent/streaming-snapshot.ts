import {
  applyResponseEventToSnapshot,
  type ResponseEvent,
  type ResponseSnapshot,
} from '@pulpo/contracts'

type AgentResponseEventInput = Pick<ResponseEvent, 'type' | 'payload' | 'emittedAt'>

type AgentResponseCheckpointOptions =
  | { terminal?: false }
  | { terminal: true; output: unknown[] }

export function projectNextAgentResponseEvent(
  current: ResponseSnapshot,
  input: AgentResponseEventInput,
): { event: ResponseEvent; projection: ResponseSnapshot } {
  const event: ResponseEvent = {
    responseId: current.responseId,
    sequence: current.sequence + 1,
    type: input.type,
    payload: structuredClone(input.payload),
    emittedAt: input.emittedAt,
  }
  return {
    event,
    projection: applyResponseEventToSnapshot(current, event),
  }
}

export function selectAgentResponseCheckpoint(
  projection: ResponseSnapshot,
  options: AgentResponseCheckpointOptions = {},
): Pick<ResponseSnapshot, 'sequence' | 'output'> {
  return {
    sequence: projection.sequence,
    output: options.terminal ? options.output : projection.output,
  }
}
