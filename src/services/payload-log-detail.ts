function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

export function buildSummaryResponsePayload(
  payload: unknown,
): Record<string, unknown> | null {
  const record = asRecord(payload);
  if (!record) {
    return null;
  }

  const summary: Record<string, unknown> = {};

  for (const key of ['id', 'object', 'created', 'created_at', 'model'] as const) {
    const value = record[key];
    if (typeof value === 'string' || typeof value === 'number') {
      summary[key] = value;
    }
  }

  const usage = asRecord(record.usage);
  if (usage) {
    summary.usage = usage;
  }

  if (Array.isArray(record.choices)) {
    summary.choices = [];
  }

  return Object.keys(summary).length > 0 ? summary : null;
}

export function hasDetailedResponsePayload(payload: unknown): boolean {
  const record = asRecord(payload);
  if (!record) {
    return false;
  }

  if (
    'assistantText' in record ||
    'reasoningSummaryText' in record ||
    'translatedResponse' in record ||
    'upstreamResponse' in record
  ) {
    return true;
  }

  if (Array.isArray(record.output) && record.output.length > 0) {
    return true;
  }

  if (!Array.isArray(record.choices)) {
    return false;
  }

  return record.choices.some((choice) => {
    const choiceRecord = asRecord(choice);
    if (!choiceRecord) {
      return false;
    }

    const message = asRecord(choiceRecord.message);
    if (
      message &&
      (typeof message.content === 'string' || 'reasoning_content' in message)
    ) {
      return true;
    }

    const delta = asRecord(choiceRecord.delta);
    return Boolean(
      delta &&
        (typeof delta.content === 'string' || 'reasoning_content' in delta),
    );
  });
}

export function hasDetailedPayloads(input: {
  requestPayload: unknown;
  responsePayload: unknown;
}): boolean {
  return Boolean(input.requestPayload) ||
    hasDetailedResponsePayload(input.responsePayload);
}
