function normalizeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const errorWithExtras = error as Error & {
      status?: number;
      request_id?: string;
      headers?: unknown;
      cause?: unknown;
    };

    return {
      name: errorWithExtras.name,
      message: errorWithExtras.message,
      stack: errorWithExtras.stack,
      status: errorWithExtras.status,
      requestId: errorWithExtras.request_id,
      headers: errorWithExtras.headers,
      cause:
        errorWithExtras.cause instanceof Error
          ? {
              name: errorWithExtras.cause.name,
              message: errorWithExtras.cause.message,
            }
          : errorWithExtras.cause,
    };
  }

  return {
    message: String(error),
  };
}

function write(level: 'info' | 'error', event: string, payload: Record<string, unknown>) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...payload,
  });

  if (level === 'error') {
    console.error(line);
    return;
  }

  console.log(line);
}

export function logInfo(event: string, payload: Record<string, unknown> = {}) {
  write('info', event, payload);
}

export function logError(
  event: string,
  error: unknown,
  payload: Record<string, unknown> = {},
) {
  write('error', event, {
    ...payload,
    error: normalizeError(error),
  });
}

export function summarizeMessages(messages: unknown): Record<string, unknown> {
  if (!Array.isArray(messages)) {
    return {
      messageCount: 0,
      roles: [],
      contentKinds: [],
    };
  }

  return {
    messageCount: messages.length,
    roles: messages.map((message) =>
      typeof message === 'object' && message !== null && 'role' in message
        ? (message as { role?: unknown }).role
        : 'unknown'
    ),
    contentKinds: messages.map((message) => {
      if (!message || typeof message !== 'object' || !('content' in message)) {
        return 'unknown';
      }

      const content = (message as { content?: unknown }).content;
      if (typeof content === 'string') {
        return 'text';
      }
      if (Array.isArray(content)) {
        return content
          .map((item) =>
            typeof item === 'object' && item !== null && 'type' in item
              ? (item as { type?: unknown }).type
              : 'unknown'
          )
          .join(',');
      }
      return typeof content;
    }),
  };
}
