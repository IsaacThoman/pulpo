import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "jsr:@std/assert@^1.0.14";
import type { PrismaClient, ProxyModel } from "npm:@prisma/client";
import { encryptSecret } from "../lib/security.ts";
import { forwardChatCompletion } from "./proxy.ts";

type UsageLogRecord = {
  requestId?: string;
  success?: boolean;
  statusCode?: number;
  retryCount: number;
  fallbackChain: string[];
  isFallback: boolean;
  isRetryAttempt?: boolean;
};

function createModel(
  overrides:
    & Partial<ProxyModel>
    & Pick<ProxyModel, "id" | "displayName" | "upstreamModelName">,
): ProxyModel {
  const now = new Date("2026-03-17T00:00:00.000Z");
  const { id, displayName, upstreamModelName, ...rest } = overrides;

  return {
    id,
    displayName,
    description: null,
    providerId: null,
    providerBaseUrl: "https://provider.test/v1",
    providerApiKeyEncrypted: overrides.providerApiKeyEncrypted || "",
    upstreamModelName,
    providerProtocol: "chat_completions",
    reasoningSummaryMode: "off",
    reasoningOutputMode: "off",
    interceptImagesWithOcr: false,
    customParams: {},
    inputCostPerMillion: 0,
    cachedInputCostPerMillion: 0,
    outputCostPerMillion: 0,
    isActive: true,
    fallbackModelId: null,
    maxRetries: 0,
    fallbackDelaySeconds: 0,
    stickyFallbackSeconds: 0,
    firstTokenTimeoutEnabled: false,
    firstTokenTimeoutSeconds: 10,
    slowStickyEnabled: false,
    slowStickyMinTokensPerSecond: 5,
    slowStickyMinCompletionSeconds: 30,
    createdAt: now,
    updatedAt: now,
    ...rest,
  } as unknown as ProxyModel;
}

function createPrismaStub(
  models: ProxyModel[],
  usageLogs: UsageLogRecord[],
): PrismaClient {
  const modelMap = new Map(models.map((model) => [model.id, model]));

  return {
    appSetting: {
      findUnique: async () => null,
    },
    proxyModel: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        modelMap.get(where.id) || null,
    },
    usageLog: {
      create: async ({ data }: { data: UsageLogRecord }) => {
        usageLogs.push(data);
        return data;
      },
    },
  } as unknown as PrismaClient;
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sseResponse(
  events: Array<{ delayMs: number; data: string }>,
): Response {
  const encoder = new TextEncoder();
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        const pump = (index: number) => {
          if (cancelled) {
            return;
          }
          if (index >= events.length) {
            controller.close();
            return;
          }

          timer = setTimeout(() => {
            if (cancelled) {
              return;
            }
            controller.enqueue(encoder.encode(events[index].data));
            pump(index + 1);
          }, events[index].delayMs);
        };

        pump(0);
      },
      cancel() {
        cancelled = true;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      },
    }),
    {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    },
  );
}

Deno.test("retries the same model until one attempt succeeds", async () => {
  const providerApiKeyEncrypted = await encryptSecret("test-key");
  const model = createModel({
    id: "model-a",
    displayName: "Model A",
    upstreamModelName: "upstream-a",
    providerApiKeyEncrypted,
    maxRetries: 2,
    fallbackDelaySeconds: 0,
  });

  const usageLogs: UsageLogRecord[] = [];
  const prisma = createPrismaStub([model], usageLogs);
  const callOrder: string[] = [];
  let attempts = 0;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(
      String((init as { body?: BodyInit | null } | undefined)?.body),
    ) as { model: string };
    callOrder.push(body.model);
    attempts += 1;
    if (attempts < 3) {
      return jsonResponse({ error: `failure-${attempts}` }, 500);
    }
    return jsonResponse({
      id: "success-a",
      choices: [{ message: { role: "assistant", content: "ok" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  };

  try {
    const response = await forwardChatCompletion(prisma, {
      body: {
        stream: false,
        messages: [{ role: "user", content: "hello" }],
      },
      model,
      proxyKeyId: null,
      requestType: "proxy",
    });
    const payload = await response.json();

    assertEquals(response.status, 200);
    assertEquals(callOrder, ["upstream-a", "upstream-a", "upstream-a"]);
    assertEquals(payload.choices?.[0]?.message?.content, "ok");
    assertEquals(usageLogs.length, 3);
    assertEquals(usageLogs.map((log) => log.isRetryAttempt), [true, true, false]);
    assertEquals(usageLogs.map((log) => log.statusCode), [500, 500, 200]);
    assertEquals(usageLogs[2].retryCount, 2);
    assertEquals(usageLogs[2].fallbackChain, ["Model A"]);
    assertEquals(usageLogs[2].isFallback, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("retries the selected fallback model and lets that model resolve its own fallback chain first", async () => {
  const providerApiKeyEncrypted = await encryptSecret("test-key");
  const modelC = createModel({
    id: "model-c",
    displayName: "Model C",
    upstreamModelName: "upstream-c",
    providerApiKeyEncrypted,
  });
  const modelB = createModel({
    id: "model-b",
    displayName: "Model B",
    upstreamModelName: "upstream-b",
    providerApiKeyEncrypted,
    fallbackModelId: modelC.id,
    maxRetries: 1,
    fallbackDelaySeconds: 0,
  });
  const modelA = createModel({
    id: "model-a",
    displayName: "Model A",
    upstreamModelName: "upstream-a",
    providerApiKeyEncrypted,
    fallbackModelId: modelB.id,
    maxRetries: 2,
    fallbackDelaySeconds: 0,
  });

  const usageLogs: UsageLogRecord[] = [];
  const prisma = createPrismaStub([modelA, modelB, modelC], usageLogs);
  const callOrder: string[] = [];
  const modelAttempts = new Map<string, number>();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(
      String((init as { body?: BodyInit | null } | undefined)?.body),
    ) as { model: string };
    callOrder.push(body.model);
    const attemptNumber = (modelAttempts.get(body.model) || 0) + 1;
    modelAttempts.set(body.model, attemptNumber);

    if (body.model === "upstream-a") {
      return jsonResponse({ error: "primary failed" }, 500);
    }
    if (body.model === "upstream-b") {
      return jsonResponse({ error: `fallback-b-failed-${attemptNumber}` }, 500);
    }
    if (body.model === "upstream-c" && attemptNumber === 1) {
      return jsonResponse({ error: "fallback-c-failed-1" }, 500);
    }

    return jsonResponse({
      id: "success-c",
      choices: [{ message: { role: "assistant", content: "recovered" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  };

  try {
    const response = await forwardChatCompletion(prisma, {
      body: {
        stream: false,
        messages: [{ role: "user", content: "hello" }],
      },
      model: modelA,
      proxyKeyId: null,
      requestType: "proxy",
    });
    const payload = await response.json();

    assertEquals(response.status, 200);
    assertEquals(callOrder, [
      "upstream-a",
      "upstream-b",
      "upstream-c",
      "upstream-b",
      "upstream-c",
    ]);
    assertEquals(payload.choices?.[0]?.message?.content, "recovered");
    assertEquals(usageLogs.length, 5);
    assertEquals(
      usageLogs.map((log) => log.isRetryAttempt),
      [true, true, true, true, false],
    );
    assertEquals(usageLogs.map((log) => log.statusCode), [500, 500, 500, 500, 200]);
    assertEquals(usageLogs[4].retryCount, 4);
    assertEquals(usageLogs[4].fallbackChain, ["Model A", "Model B", "Model C"]);
    assertEquals(usageLogs[4].isFallback, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("returns a streamed response immediately while first-token timeout monitoring continues", async () => {
  const providerApiKeyEncrypted = await encryptSecret("test-key");
  const model = createModel({
    id: "model-a",
    displayName: "Model A",
    upstreamModelName: "upstream-a",
    providerApiKeyEncrypted,
    maxRetries: 1,
    firstTokenTimeoutEnabled: true,
    firstTokenTimeoutSeconds: 0.5,
  });

  const usageLogs: UsageLogRecord[] = [];
  const prisma = createPrismaStub([model], usageLogs);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return sseResponse([
      {
        delayMs: 250,
        data: 'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n',
      },
      {
        delayMs: 0,
        data:
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\n',
      },
      {
        delayMs: 0,
        data: "data: [DONE]\n\n",
      },
    ]);
  };

  try {
    const startedAt = Date.now();
    const response = await forwardChatCompletion(prisma, {
      body: {
        stream: true,
        messages: [{ role: "user", content: "hello" }],
      },
      model,
      proxyKeyId: null,
      requestType: "proxy",
    });
    const elapsedMs = Date.now() - startedAt;

    assert(
      elapsedMs < 150,
      `expected streamed response immediately, took ${elapsedMs}ms`,
    );
    assertEquals(response.status, 200);
    assertEquals(response.headers.get("content-type"), "text/event-stream");

    const streamText = await response.text();
    assertStringIncludes(streamText, '"hello"');

    await sleep(0);
    assertEquals(usageLogs.length, 1);
    assertEquals(usageLogs[0].retryCount, 0);
    assertEquals(usageLogs[0].fallbackChain, ["Model A"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("falls back to the next model stream when the first token timeout elapses", async () => {
  const providerApiKeyEncrypted = await encryptSecret("test-key");
  const fallbackModel = createModel({
    id: "model-b",
    displayName: "Model B",
    upstreamModelName: "upstream-b",
    providerApiKeyEncrypted,
  });
  const primaryModel = createModel({
    id: "model-a",
    displayName: "Model A",
    upstreamModelName: "upstream-a",
    providerApiKeyEncrypted,
    fallbackModelId: fallbackModel.id,
    maxRetries: 1,
    fallbackDelaySeconds: 0,
    firstTokenTimeoutEnabled: true,
    firstTokenTimeoutSeconds: 0.05,
  });

  const usageLogs: UsageLogRecord[] = [];
  const prisma = createPrismaStub([primaryModel, fallbackModel], usageLogs);
  const callOrder: string[] = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(
      String((init as { body?: BodyInit | null } | undefined)?.body),
    ) as {
      model: string;
    };
    callOrder.push(body.model);

    if (body.model === "upstream-a") {
      return sseResponse([
        {
          delayMs: 200,
          data: 'data: {"choices":[{"delta":{"content":"late-primary"}}]}\n\n',
        },
      ]);
    }

    return sseResponse([
      {
        delayMs: 0,
        data: 'data: {"choices":[{"delta":{"content":"fallback-win"}}]}\n\n',
      },
      {
        delayMs: 0,
        data:
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}\n\n',
      },
      {
        delayMs: 0,
        data: "data: [DONE]\n\n",
      },
    ]);
  };

  try {
    const startedAt = Date.now();
    const response = await forwardChatCompletion(prisma, {
      body: {
        stream: true,
        messages: [{ role: "user", content: "hello" }],
      },
      model: primaryModel,
      proxyKeyId: null,
      requestType: "proxy",
    });
    const elapsedMs = Date.now() - startedAt;

    assert(
      elapsedMs < 150,
      `expected streamed response immediately, took ${elapsedMs}ms`,
    );
    assertEquals(response.status, 200);

    const streamText = await response.text();
    assertEquals(callOrder, ["upstream-a", "upstream-b"]);
    assertStringIncludes(streamText, '"fallback-win"');
    assert(!streamText.includes("late-primary"));

    await sleep(0);
    assertEquals(usageLogs.length, 2);
    assertEquals(usageLogs.map((log) => log.isRetryAttempt), [true, false]);
    assertEquals(usageLogs.map((log) => log.statusCode), [504, 200]);
    assertEquals(usageLogs[1].retryCount, 1);
    assertEquals(usageLogs[1].fallbackChain, ["Model A", "Model B"]);
    assertEquals(usageLogs[1].isFallback, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("falls back when only a role chunk arrives before the first content token", async () => {
  const providerApiKeyEncrypted = await encryptSecret("test-key");
  const fallbackModel = createModel({
    id: "model-b",
    displayName: "Model B",
    upstreamModelName: "upstream-b",
    providerApiKeyEncrypted,
  });
  const primaryModel = createModel({
    id: "model-a",
    displayName: "Model A",
    upstreamModelName: "upstream-a",
    providerApiKeyEncrypted,
    fallbackModelId: fallbackModel.id,
    maxRetries: 1,
    fallbackDelaySeconds: 0,
    firstTokenTimeoutEnabled: true,
    firstTokenTimeoutSeconds: 0.05,
  });

  const usageLogs: UsageLogRecord[] = [];
  const prisma = createPrismaStub([primaryModel, fallbackModel], usageLogs);
  const callOrder: string[] = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(
      String((init as { body?: BodyInit | null } | undefined)?.body),
    ) as {
      model: string;
    };
    callOrder.push(body.model);

    if (body.model === "upstream-a") {
      return sseResponse([
        {
          delayMs: 10,
          data: 'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
        },
        {
          delayMs: 200,
          data: 'data: {"choices":[{"delta":{"content":"late-primary"}}]}\n\n',
        },
      ]);
    }

    return sseResponse([
      {
        delayMs: 0,
        data:
          'data: {"choices":[{"delta":{"content":"fallback-should-not-run"}}]}\n\n',
      },
    ]);
  };

  try {
    const startedAt = Date.now();
    const response = await forwardChatCompletion(prisma, {
      body: {
        stream: true,
        messages: [{ role: "user", content: "hello" }],
      },
      model: primaryModel,
      proxyKeyId: null,
      requestType: "proxy",
    });

    const body = response.body;
    assert(body);
    const reader = body.getReader();
    const firstChunk = await reader.read();
    const firstChunkElapsedMs = Date.now() - startedAt;
    const decoder = new TextDecoder();
    const restChunks: Uint8Array[] = [];

    assert(
      firstChunkElapsedMs < 150,
      `expected first streamed chunk immediately, took ${firstChunkElapsedMs}ms`,
    );
    assert(!firstChunk.done);
    assert(firstChunk.value);
    assertStringIncludes(
      decoder.decode(firstChunk.value),
      '"role":"assistant"',
    );

    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      restChunks.push(chunk.value);
    }

    const streamText = decoder.decode(firstChunk.value) +
      restChunks.map((chunk) => decoder.decode(chunk)).join("");
    assertEquals(callOrder, ["upstream-a", "upstream-b"]);
    assertStringIncludes(streamText, '"fallback-should-not-run"');
    assert(!streamText.includes("late-primary"));

    await sleep(0);
    assertEquals(usageLogs.length, 2);
    assertEquals(usageLogs.map((log) => log.isRetryAttempt), [true, false]);
    assertEquals(usageLogs.map((log) => log.statusCode), [504, 200]);
    assertEquals(usageLogs[1].retryCount, 1);
    assertEquals(usageLogs[1].fallbackChain, ["Model A", "Model B"]);
    assertEquals(usageLogs[1].isFallback, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("translates non-stream Responses output into message.reasoning_content", async () => {
  const providerApiKeyEncrypted = await encryptSecret("test-key");
  const model = createModel({
    id: "model-r",
    displayName: "Responses Model",
    upstreamModelName: "gpt-5",
    providerApiKeyEncrypted,
    providerProtocol: "responses",
    reasoningSummaryMode: "detailed",
    reasoningOutputMode: "reasoning_content",
  });

  const usageLogs: UsageLogRecord[] = [];
  const prisma = createPrismaStub([model], usageLogs);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(
      String((init as { body?: BodyInit | null } | undefined)?.body),
    ) as Record<string, unknown>;

    assertEquals(body.model, "gpt-5");
    assertEquals(body.stream, false);
    assertEquals(body.store, false);
    assertEquals((body.reasoning as Record<string, unknown>).summary, "detailed");

    return jsonResponse({
      id: "resp_123",
      object: "response",
      created_at: 123,
      output: [
        {
          type: "reasoning",
          summary: [{ type: "summary_text", text: "Short reasoning." }],
        },
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Final answer." }],
        },
      ],
      usage: {
        input_tokens: 10,
        input_tokens_details: { cached_tokens: 2 },
        output_tokens: 4,
        output_tokens_details: { reasoning_tokens: 1 },
      },
    });
  };

  try {
    const response = await forwardChatCompletion(prisma, {
      body: {
        model: "Responses Model",
        stream: false,
        messages: [{ role: "user", content: "hello" }],
      },
      model,
      proxyKeyId: null,
      requestType: "proxy",
    });
    const payload = await response.json();

    assertEquals(payload.model, "Responses Model");
    assertEquals(payload.choices?.[0]?.message?.content, "Final answer.");
    assertEquals(
      payload.choices?.[0]?.message?.reasoning_content,
      "Short reasoning.",
    );
    assertEquals(payload.usage?.prompt_tokens, 10);
    assertEquals(payload.usage?.completion_tokens, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("preserves developer messages and encodes assistant history for Responses input", async () => {
  const providerApiKeyEncrypted = await encryptSecret("test-key");
  const model = createModel({
    id: "model-r",
    displayName: "Responses Model",
    upstreamModelName: "gpt-5",
    providerApiKeyEncrypted,
    providerProtocol: "responses",
  });

  const usageLogs: UsageLogRecord[] = [];
  const prisma = createPrismaStub([model], usageLogs);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(
      String((init as { body?: BodyInit | null } | undefined)?.body),
    ) as Record<string, unknown>;
    const input = body.input as Array<Record<string, unknown>>;

    assertEquals(input[0]?.role, "developer");
    assertEquals(
      (input[0]?.content as Array<Record<string, unknown>>)?.[0]?.type,
      "input_text",
    );
    assertEquals(input[1]?.role, "user");
    assertEquals(
      (input[1]?.content as Array<Record<string, unknown>>)?.[0]?.type,
      "input_text",
    );
    assertEquals(input[2]?.role, "assistant");
    assertEquals(
      (input[2]?.content as Array<Record<string, unknown>>)?.[0]?.type,
      "output_text",
    );

    return jsonResponse({
      id: "resp_123",
      object: "response",
      created_at: 123,
      output: [{
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Done." }],
      }],
      usage: {
        input_tokens: 3,
        output_tokens: 1,
      },
    });
  };

  try {
    const response = await forwardChatCompletion(prisma, {
      body: {
        model: "Responses Model",
        stream: false,
        messages: [
          { role: "developer", content: "be terse" },
          { role: "user", content: "hello" },
          { role: "assistant", content: "prior answer" },
        ],
      },
      model,
      proxyKeyId: null,
      requestType: "proxy",
    });

    assertEquals(response.status, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("streams Responses reasoning summaries as think tags in Chat Completions format", async () => {
  const providerApiKeyEncrypted = await encryptSecret("test-key");
  const model = createModel({
    id: "model-r",
    displayName: "Responses Model",
    upstreamModelName: "gpt-5",
    providerApiKeyEncrypted,
    providerProtocol: "responses",
    reasoningSummaryMode: "concise",
    reasoningOutputMode: "think_tags",
    maxRetries: 1,
    firstTokenTimeoutEnabled: true,
    firstTokenTimeoutSeconds: 1,
  });

  const usageLogs: UsageLogRecord[] = [];
  const prisma = createPrismaStub([model], usageLogs);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    sseResponse([
      {
        delayMs: 0,
        data:
          'data: {"type":"response.created","response":{"id":"resp_123","created_at":123}}\n\n',
      },
      {
        delayMs: 0,
        data:
          'data: {"type":"response.reasoning_summary_text.delta","delta":"Plan."}\n\n',
      },
      {
        delayMs: 0,
        data:
          'data: {"type":"response.output_text.delta","delta":"Answer."}\n\n',
      },
      {
        delayMs: 0,
        data:
          'data: {"type":"response.completed","response":{"id":"resp_123","created_at":123,"usage":{"input_tokens":3,"output_tokens":2}}}\n\n',
      },
      {
        delayMs: 0,
        data: "data: [DONE]\n\n",
      },
    ]);

  try {
    const response = await forwardChatCompletion(prisma, {
      body: {
        model: "Responses Model",
        stream: true,
        messages: [{ role: "user", content: "hello" }],
      },
      model,
      proxyKeyId: null,
      requestType: "proxy",
    });
    const streamText = await response.text();

    assertEquals(response.headers.get("content-type"), "text/event-stream");
    assertStringIncludes(streamText, '"role":"assistant"');
    assertStringIncludes(streamText, '"content":"<think>"');
    assertStringIncludes(streamText, '"content":"Plan."');
    assertStringIncludes(streamText, '"content":"</think>"');
    assertStringIncludes(streamText, '"content":"Answer."');
    assertStringIncludes(streamText, '"prompt_tokens":3');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("streams Responses reasoning summaries via delta.reasoning_content", async () => {
  const providerApiKeyEncrypted = await encryptSecret("test-key");
  const model = createModel({
    id: "model-r",
    displayName: "Responses Model",
    upstreamModelName: "gpt-5",
    providerApiKeyEncrypted,
    providerProtocol: "responses",
    reasoningSummaryMode: "auto",
    reasoningOutputMode: "reasoning_content",
  });

  const usageLogs: UsageLogRecord[] = [];
  const prisma = createPrismaStub([model], usageLogs);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    sseResponse([
      {
        delayMs: 0,
        data:
          'data: {"type":"response.reasoning_summary_text.delta","delta":"Think."}\n\n',
      },
      {
        delayMs: 0,
        data:
          'data: {"type":"response.output_text.delta","delta":"Answer."}\n\n',
      },
      {
        delayMs: 0,
        data:
          'data: {"type":"response.completed","response":{"id":"resp_123","created_at":123,"usage":{"input_tokens":1,"output_tokens":1}}}\n\n',
      },
    ]);

  try {
    const response = await forwardChatCompletion(prisma, {
      body: {
        model: "Responses Model",
        stream: true,
        messages: [{ role: "user", content: "hello" }],
      },
      model,
      proxyKeyId: null,
      requestType: "proxy",
    });
    const streamText = await response.text();

    assertStringIncludes(streamText, '"reasoning_content":"Think."');
    assertStringIncludes(streamText, '"content":"Answer."');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("falls back for Responses-backed models when reasoning is hidden and no visible token arrives", async () => {
  const providerApiKeyEncrypted = await encryptSecret("test-key");
  const fallbackModel = createModel({
    id: "model-b",
    displayName: "Fallback Model",
    upstreamModelName: "upstream-b",
    providerApiKeyEncrypted,
  });
  const primaryModel = createModel({
    id: "model-a",
    displayName: "Responses Hidden Reasoning",
    upstreamModelName: "gpt-5",
    providerApiKeyEncrypted,
    providerProtocol: "responses",
    reasoningSummaryMode: "auto",
    reasoningOutputMode: "off",
    fallbackModelId: fallbackModel.id,
    maxRetries: 1,
    fallbackDelaySeconds: 0,
    firstTokenTimeoutEnabled: true,
    firstTokenTimeoutSeconds: 0.05,
  });

  const usageLogs: UsageLogRecord[] = [];
  const prisma = createPrismaStub([primaryModel, fallbackModel], usageLogs);
  const callOrder: string[] = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(
      String((init as { body?: BodyInit | null } | undefined)?.body),
    ) as Record<string, unknown>;
    callOrder.push(String(body.model));

    if (body.model === "gpt-5") {
      return sseResponse([
        {
          delayMs: 10,
          data:
            'data: {"type":"response.reasoning_summary_text.delta","delta":"hidden"}\n\n',
        },
        {
          delayMs: 200,
          data:
            'data: {"type":"response.output_text.delta","delta":"late"}\n\n',
        },
      ]);
    }

    return sseResponse([
      {
        delayMs: 0,
        data: 'data: {"choices":[{"delta":{"content":"fallback-win"}}]}\n\n',
      },
    ]);
  };

  try {
    const response = await forwardChatCompletion(prisma, {
      body: {
        model: "Responses Hidden Reasoning",
        stream: true,
        messages: [{ role: "user", content: "hello" }],
      },
      model: primaryModel,
      proxyKeyId: null,
      requestType: "proxy",
    });
    const streamText = await response.text();

    assertEquals(callOrder, ["gpt-5", "upstream-b"]);
    assertStringIncludes(streamText, '"fallback-win"');
    assert(!streamText.includes("hidden"));
    assert(!streamText.includes("late"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
