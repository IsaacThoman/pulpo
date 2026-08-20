export function orderedAgentTurnPayloads(payloads: ReadonlyMap<number, unknown>): {
  turns: Array<{ turnNumber: number; payload: unknown }>
} {
  return {
    turns: [...payloads.entries()].sort(([left], [right]) => left - right)
      .map(([turnNumber, payload]) => ({ turnNumber, payload })),
  }
}
