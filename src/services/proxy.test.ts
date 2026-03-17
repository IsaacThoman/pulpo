import { assertEquals } from 'jsr:@std/assert@^1.0.14';
import type { PrismaClient, ProxyModel } from 'npm:@prisma/client';
import { encryptSecret } from '../lib/security.ts';
import { forwardChatCompletion } from './proxy.ts';

type UsageLogRecord = {
  retryCount: number;
  fallbackChain: string[];
  isFallback: boolean;
};

function createModel(overrides: Partial<ProxyModel> & Pick<ProxyModel, 'id' | 'displayName' | 'upstreamModelName'>): ProxyModel {
  const now = new Date('2026-03-17T00:00:00.000Z');
  const { id, displayName, upstreamModelName, ...rest } = overrides;

  return {
    id,
    displayName,
    description: null,
    providerId: null,
    providerBaseUrl: 'https://provider.test/v1',
    providerApiKeyEncrypted: overrides.providerApiKeyEncrypted || '',
    upstreamModelName,
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
      findUnique: async ({ where }: { where: { id: string } }) => modelMap.get(where.id) || null,
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
    headers: { 'content-type': 'application/json' },
  });
}

Deno.test('retries the same model until one attempt succeeds', async () => {
  const providerApiKeyEncrypted = await encryptSecret('test-key');
  const model = createModel({
    id: 'model-a',
    displayName: 'Model A',
    upstreamModelName: 'upstream-a',
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
    const body = JSON.parse(String((init as { body?: BodyInit | null } | undefined)?.body)) as { model: string };
    callOrder.push(body.model);
    attempts += 1;
    if (attempts < 3) {
      return jsonResponse({ error: `failure-${attempts}` }, 500);
    }
    return jsonResponse({
      id: 'success-a',
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  };

  try {
    const response = await forwardChatCompletion(prisma, {
      body: {
        stream: false,
        messages: [{ role: 'user', content: 'hello' }],
      },
      model,
      proxyKeyId: null,
      requestType: 'proxy',
    });
    const payload = await response.json();

    assertEquals(response.status, 200);
    assertEquals(callOrder, ['upstream-a', 'upstream-a', 'upstream-a']);
    assertEquals(payload.choices?.[0]?.message?.content, 'ok');
    assertEquals(usageLogs.length, 1);
    assertEquals(usageLogs[0].retryCount, 2);
    assertEquals(usageLogs[0].fallbackChain, ['Model A']);
    assertEquals(usageLogs[0].isFallback, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('retries the selected fallback model and lets that model resolve its own fallback chain first', async () => {
  const providerApiKeyEncrypted = await encryptSecret('test-key');
  const modelC = createModel({
    id: 'model-c',
    displayName: 'Model C',
    upstreamModelName: 'upstream-c',
    providerApiKeyEncrypted,
  });
  const modelB = createModel({
    id: 'model-b',
    displayName: 'Model B',
    upstreamModelName: 'upstream-b',
    providerApiKeyEncrypted,
    fallbackModelId: modelC.id,
    maxRetries: 1,
    fallbackDelaySeconds: 0,
  });
  const modelA = createModel({
    id: 'model-a',
    displayName: 'Model A',
    upstreamModelName: 'upstream-a',
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
    const body = JSON.parse(String((init as { body?: BodyInit | null } | undefined)?.body)) as { model: string };
    callOrder.push(body.model);
    const attemptNumber = (modelAttempts.get(body.model) || 0) + 1;
    modelAttempts.set(body.model, attemptNumber);

    if (body.model === 'upstream-a') {
      return jsonResponse({ error: 'primary failed' }, 500);
    }
    if (body.model === 'upstream-b') {
      return jsonResponse({ error: `fallback-b-failed-${attemptNumber}` }, 500);
    }
    if (body.model === 'upstream-c' && attemptNumber === 1) {
      return jsonResponse({ error: 'fallback-c-failed-1' }, 500);
    }

    return jsonResponse({
      id: 'success-c',
      choices: [{ message: { role: 'assistant', content: 'recovered' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  };

  try {
    const response = await forwardChatCompletion(prisma, {
      body: {
        stream: false,
        messages: [{ role: 'user', content: 'hello' }],
      },
      model: modelA,
      proxyKeyId: null,
      requestType: 'proxy',
    });
    const payload = await response.json();

    assertEquals(response.status, 200);
    assertEquals(callOrder, [
      'upstream-a',
      'upstream-b',
      'upstream-c',
      'upstream-b',
      'upstream-c',
    ]);
    assertEquals(payload.choices?.[0]?.message?.content, 'recovered');
    assertEquals(usageLogs.length, 1);
    assertEquals(usageLogs[0].retryCount, 4);
    assertEquals(usageLogs[0].fallbackChain, ['Model A', 'Model B', 'Model C']);
    assertEquals(usageLogs[0].isFallback, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
