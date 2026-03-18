import OpenAI from "npm:openai";
import prismaPackage from "npm:@prisma/client";
import type {
  Prisma as PrismaTypes,
  PrismaClient,
  Provider,
  ProxyModel,
} from "npm:@prisma/client";
import { logError, logInfo, summarizeMessages } from "../lib/logging.ts";
import { decryptSecret, encryptSecret } from "../lib/security.ts";
import { applyOcrToMessages } from "./ocr.ts";
import { getLoggingSettings } from "./settings.ts";

const { Prisma } = prismaPackage;

type UsageShape = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
};

type FallbackContext = {
  requestId: string;
  requestStartTime: number;
  originalModelId: string;
  originalModelName: string;
  totalRetryCount: number;
  isStickyFallback?: boolean;
};

type AttemptFailure = {
  statusCode: number;
  errorMessage?: string;
  upstreamRequestId?: string | null;
};

type AttemptPathNode = {
  id: string;
  name: string;
};

type ExecutionSuccess =
  | {
    ok: true;
    kind: "json";
    model: ProxyModel;
    statusCode: number;
    responsePayload: Record<string, unknown>;
    upstreamRequestId: string | null;
    fallbackChain: string[];
    attemptStartTime: number;
  }
  | {
    ok: true;
    kind: "stream";
    model: ProxyModel;
    statusCode: number;
    response: Response;
    completion: Promise<StreamCompletionResult>;
    upstreamRequestId: string | null;
    fallbackChain: string[];
    attemptStartTime: number;
    cancelStream?: (reason: string) => Promise<void>;
  };

type ExecutionFailure = {
  ok: false;
  model: ProxyModel;
  statusCode: number;
  errorMessage: string;
  upstreamRequestId: string | null;
  fallbackChain: string[];
  responseError: string;
  responseDetails?: string;
};

type ExecutionResult = ExecutionSuccess | ExecutionFailure;

type StreamInspectionState = {
  buffer: string;
  usagePayload: Record<string, unknown> | null;
  assistantText: string;
  sawFirstToken: boolean;
};

type StreamInspectionResult = {
  usagePayload: Record<string, unknown> | null;
  assistantText: string;
  sawFirstToken: boolean;
};

type StreamCompletionResult = StreamInspectionResult & {
  model: ProxyModel;
  statusCode: number;
  upstreamRequestId: string | null;
  fallbackChain: string[];
  attemptStartTime: number;
};

type PreparedStreamingResponse =
  | {
    ok: true;
    response: Response;
    completion: Promise<StreamInspectionResult>;
    cancelStream: (reason: string) => Promise<void>;
  }
  | {
    ok: false;
    statusCode: number;
    errorMessage: string;
  };

// Sticky fallback (circuit breaker) tracking: modelId -> { blockedUntil: timestamp }
const stickyBlocks = new Map<string, number>();

// Helper to check if a model is currently blocked
function isModelBlocked(modelId: string): boolean {
  const blockExpiry = stickyBlocks.get(modelId);
  if (!blockExpiry) return false;
  if (Date.now() > blockExpiry) {
    // Block has expired, clean it up
    stickyBlocks.delete(modelId);
    return false;
  }
  return true;
}

// Helper to block a model
function blockModel(modelId: string, durationSeconds: number): void {
  if (durationSeconds <= 0) return;
  const blockedUntil = Date.now() + (durationSeconds * 1000);
  stickyBlocks.set(modelId, blockedUntil);
  logInfo("proxy.model_blocked", {
    modelId,
    durationSeconds,
    blockedUntil: new Date(blockedUntil).toISOString(),
  });
}

export function toAdminProxyKeyJson(key: {
  id: string;
  name: string;
  prefix: string;
  lastFour: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastUsedAt: Date | null;
}) {
  return {
    id: key.id,
    name: key.name,
    preview: `${key.prefix}••••${key.lastFour}`,
    isActive: key.isActive,
    createdAt: key.createdAt,
    updatedAt: key.updatedAt,
    lastUsedAt: key.lastUsedAt,
  };
}

export function toAdminProxyModelJson(
  model: ProxyModel & {
    provider?: { name: string } | null;
    fallbackModel?: { displayName: string } | null;
  },
) {
  return {
    id: model.id,
    displayName: model.displayName,
    description: model.description || "",
    providerId: model.providerId,
    providerName: model.provider?.name || null,
    usesCustomProvider: !model.providerId,
    providerBaseUrl: model.providerBaseUrl,
    upstreamModelName: model.upstreamModelName,
    interceptImagesWithOcr: model.interceptImagesWithOcr,
    customParams: model.customParams || {},
    inputCostPerMillion: Number(model.inputCostPerMillion),
    cachedInputCostPerMillion: Number(model.cachedInputCostPerMillion),
    outputCostPerMillion: Number(model.outputCostPerMillion),
    isActive: model.isActive,
    hasProviderApiKey: Boolean(model.providerApiKeyEncrypted),
    // Fallback configuration
    fallbackModelId: model.fallbackModelId,
    fallbackModelName: model.fallbackModel?.displayName || null,
    maxRetries: model.maxRetries,
    fallbackDelaySeconds: model.fallbackDelaySeconds,
    stickyFallbackSeconds: model.stickyFallbackSeconds,
    firstTokenTimeoutEnabled: model.firstTokenTimeoutEnabled,
    firstTokenTimeoutSeconds: model.firstTokenTimeoutSeconds,
    slowStickyEnabled: model.slowStickyEnabled,
    slowStickyMinTokensPerSecond: model.slowStickyMinTokensPerSecond,
    slowStickyMinCompletionSeconds: model.slowStickyMinCompletionSeconds,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
  };
}

export function toAdminProviderJson(
  provider: Provider & { _count?: { proxyModels: number } },
) {
  return {
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    hasApiKey: Boolean(provider.apiKeyEncrypted),
    modelCount: provider._count?.proxyModels ?? 0,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
  };
}

export function toAdminSimModelJson(model: {
  id: string;
  displayName: string;
  description: string | null;
  isActive: boolean;
  exposeInModels: boolean;
  segments: unknown;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: model.id,
    displayName: model.displayName,
    description: model.description || "",
    isActive: model.isActive,
    exposeInModels: model.exposeInModels,
    segments: model.segments as Array<{
      type: "delay" | "text";
      delayMs?: number;
      content?: string;
      ratePerSecond?: number;
      unit?: "char" | "token";
    }>,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
  };
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

async function assertNoFallbackCycle(
  prisma: PrismaClient,
  fallbackModelId: string,
  existingModelId?: string,
): Promise<void> {
  const seen = new Set<string>();
  if (existingModelId) {
    seen.add(existingModelId);
  }

  let currentModelId: string | null = fallbackModelId;
  while (currentModelId) {
    if (seen.has(currentModelId)) {
      throw new Error("Fallback configuration cannot contain cycles");
    }
    seen.add(currentModelId);

    const nextModel: { fallbackModelId: string | null } | null = await prisma
      .proxyModel.findUnique({
        where: { id: currentModelId },
        select: { fallbackModelId: true },
      });
    currentModelId = nextModel?.fallbackModelId ?? null;
  }
}

export async function fetchProviderModels(
  providerBaseUrl: string,
  apiKey: string,
): Promise<string[]> {
  const client = new OpenAI({
    apiKey,
    baseURL: normalizeBaseUrl(providerBaseUrl),
  });

  const response = await client.models.list();
  return response.data.map((model) => model.id).sort((left, right) =>
    left.localeCompare(right)
  );
}

export async function persistProviderInput(
  prisma: PrismaClient,
  input: {
    name: string;
    baseUrl: string;
    apiKey?: string;
  },
  existingProviderId?: string,
) {
  const existing = existingProviderId
    ? await prisma.provider.findUnique({ where: { id: existingProviderId } })
    : null;

  const apiKeyEncrypted = input.apiKey?.trim()
    ? await encryptSecret(input.apiKey.trim())
    : existing?.apiKeyEncrypted || "";

  const data = {
    name: input.name.trim(),
    baseUrl: normalizeBaseUrl(input.baseUrl),
    apiKeyEncrypted,
  } satisfies PrismaTypes.ProviderUncheckedCreateInput;

  return prisma.$transaction(async (tx) => {
    const provider = existingProviderId
      ? await tx.provider.update({
        where: { id: existingProviderId },
        data,
      })
      : await tx.provider.create({
        data,
      });

    if (existingProviderId) {
      await tx.proxyModel.updateMany({
        where: { providerId: provider.id },
        data: {
          providerBaseUrl: provider.baseUrl,
          providerApiKeyEncrypted: provider.apiKeyEncrypted,
        },
      });
    }

    return provider;
  });
}

export async function persistModelInput(
  prisma: PrismaClient,
  input: {
    displayName: string;
    description?: string;
    providerId?: string | null;
    providerBaseUrl: string;
    providerApiKey?: string;
    upstreamModelName: string;
    interceptImagesWithOcr: boolean;
    customParams: PrismaTypes.InputJsonValue;
    inputCostPerMillion: number;
    cachedInputCostPerMillion: number;
    outputCostPerMillion: number;
    isActive: boolean;
    // Fallback configuration
    fallbackModelId?: string | null;
    maxRetries?: number;
    fallbackDelaySeconds?: number;
    stickyFallbackSeconds?: number;
    firstTokenTimeoutEnabled?: boolean;
    firstTokenTimeoutSeconds?: number;
    slowStickyEnabled?: boolean;
    slowStickyMinTokensPerSecond?: number;
    slowStickyMinCompletionSeconds?: number;
  },
  existingModelId?: string,
) {
  const existing = existingModelId
    ? await prisma.proxyModel.findUnique({ where: { id: existingModelId } })
    : null;

  const providerId = input.providerId?.trim() || null;
  const provider = providerId
    ? await prisma.provider.findUnique({ where: { id: providerId } })
    : null;

  if (providerId && !provider) {
    throw new Error("Selected provider was not found");
  }

  // Validate fallback model - prevent self-reference
  const fallbackModelId = input.fallbackModelId?.trim() || null;
  if (fallbackModelId && fallbackModelId === existingModelId) {
    throw new Error("A model cannot be its own fallback");
  }
  if (fallbackModelId) {
    const fallbackModel = await prisma.proxyModel.findUnique({
      where: { id: fallbackModelId },
    });
    if (!fallbackModel) {
      throw new Error("Selected fallback model was not found");
    }
    if (!fallbackModel.isActive) {
      throw new Error("Fallback model must be active");
    }
    await assertNoFallbackCycle(prisma, fallbackModelId, existingModelId);
  }
  if (
    (input.maxRetries ?? 0) === 0 &&
    (input.firstTokenTimeoutEnabled || input.slowStickyEnabled)
  ) {
    throw new Error("Retry/fallback must be enabled to use fallback triggers");
  }
  if (input.slowStickyEnabled && (input.stickyFallbackSeconds ?? 0) <= 0) {
    throw new Error(
      "Sticky block seconds must be greater than 0 to enable slow sticky fallback",
    );
  }

  const providerBaseUrl = provider
    ? provider.baseUrl
    : normalizeBaseUrl(input.providerBaseUrl);
  const providerApiKeyEncrypted = provider
    ? provider.apiKeyEncrypted
    : input.providerApiKey?.trim()
    ? await encryptSecret(input.providerApiKey.trim())
    : existing?.providerApiKeyEncrypted || "";

  const data = {
    displayName: input.displayName.trim(),
    description: input.description?.trim() || null,
    providerId,
    providerBaseUrl,
    providerApiKeyEncrypted,
    upstreamModelName: input.upstreamModelName.trim(),
    interceptImagesWithOcr: input.interceptImagesWithOcr,
    customParams: input.customParams,
    inputCostPerMillion: input.inputCostPerMillion,
    cachedInputCostPerMillion: input.cachedInputCostPerMillion,
    outputCostPerMillion: input.outputCostPerMillion,
    isActive: input.isActive,
    fallbackModelId,
    maxRetries: input.maxRetries ?? 0,
    fallbackDelaySeconds: input.fallbackDelaySeconds ?? 3,
    stickyFallbackSeconds: input.stickyFallbackSeconds ?? 0,
    firstTokenTimeoutEnabled: input.firstTokenTimeoutEnabled ?? false,
    firstTokenTimeoutSeconds: input.firstTokenTimeoutSeconds ?? 10,
    slowStickyEnabled: input.slowStickyEnabled ?? false,
    slowStickyMinTokensPerSecond: input.slowStickyMinTokensPerSecond ?? 5,
    slowStickyMinCompletionSeconds: input.slowStickyMinCompletionSeconds ?? 30,
  } satisfies PrismaTypes.ProxyModelUncheckedCreateInput;

  if (existingModelId) {
    return prisma.proxyModel.update({
      where: { id: existingModelId },
      data,
    });
  }

  return prisma.proxyModel.create({
    data,
  });
}

function extractUsage(
  payload: Record<string, unknown> | null | undefined,
): UsageShape {
  const usage = (payload?.usage as Record<string, unknown> | undefined) || {};
  const promptTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
  const cachedInputTokens = Number(
    (usage.prompt_tokens_details as Record<string, unknown> | undefined)
      ?.cached_tokens ??
      (usage.input_tokens_details as Record<string, unknown> | undefined)
        ?.cached_tokens ??
      0,
  );
  const completionTokens = Number(
    usage.completion_tokens ?? usage.output_tokens ?? 0,
  );

  return {
    inputTokens: Number.isFinite(promptTokens) ? promptTokens : 0,
    cachedInputTokens: Number.isFinite(cachedInputTokens)
      ? cachedInputTokens
      : 0,
    outputTokens: Number.isFinite(completionTokens) ? completionTokens : 0,
  };
}

function computeCost(model: ProxyModel, usage: UsageShape): number {
  const freshInputTokens = Math.max(
    0,
    usage.inputTokens - usage.cachedInputTokens,
  );
  const inputCost = (freshInputTokens * Number(model.inputCostPerMillion)) /
    1_000_000;
  const cachedCost =
    (usage.cachedInputTokens * Number(model.cachedInputCostPerMillion)) /
    1_000_000;
  const outputCost = (usage.outputTokens * Number(model.outputCostPerMillion)) /
    1_000_000;

  return Number((inputCost + cachedCost + outputCost).toFixed(8));
}

function createStreamInspectionState(): StreamInspectionState {
  return {
    buffer: "",
    usagePayload: null,
    assistantText: "",
    sawFirstToken: false,
  };
}

function inspectSseBuffer(state: StreamInspectionState): void {
  let boundary = state.buffer.indexOf("\n\n");
  while (boundary !== -1) {
    const event = state.buffer.slice(0, boundary);
    state.buffer = state.buffer.slice(boundary + 2);
    boundary = state.buffer.indexOf("\n\n");

    const dataLines = event
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim());

    for (const line of dataLines) {
      if (!line || line === "[DONE]") {
        continue;
      }

      try {
        const json = JSON.parse(line) as Record<string, unknown>;
        if (json.usage) {
          state.usagePayload = json;
        }

        const choices = Array.isArray(json.choices) ? json.choices : [];
        for (const choice of choices) {
          if (!choice || typeof choice !== "object") {
            continue;
          }
          const delta = (choice as Record<string, unknown>).delta;
          if (!delta || typeof delta !== "object") {
            continue;
          }
          const content = (delta as Record<string, unknown>).content;
          if (typeof content === "string") {
            if (content.length > 0) {
              state.sawFirstToken = true;
            }
            state.assistantText += content;
          }
        }
      } catch {
        // Ignore malformed SSE payloads from upstream providers.
      }
    }
  }
}

function finalizeStreamInspection(
  state: StreamInspectionState,
  decoder: TextDecoder,
): StreamInspectionResult {
  state.buffer += decoder.decode();
  inspectSseBuffer(state);
  return {
    usagePayload: state.usagePayload,
    assistantText: state.assistantText,
    sawFirstToken: state.sawFirstToken,
  };
}

function maybeBlockSlowModel(
  model: ProxyModel,
  input: {
    usagePayload: Record<string, unknown> | null;
    durationMs: number;
    requestId: string;
    requestType: "proxy" | "playground";
    upstreamRequestId?: string | null;
  },
): void {
  if (!model.slowStickyEnabled || model.stickyFallbackSeconds <= 0) {
    return;
  }

  if (input.durationMs < model.slowStickyMinCompletionSeconds * 1000) {
    return;
  }

  const usage = extractUsage(input.usagePayload);
  if (usage.outputTokens <= 0) {
    return;
  }

  const avgTokensPerSecond = usage.outputTokens / (input.durationMs / 1000);
  if (avgTokensPerSecond >= model.slowStickyMinTokensPerSecond) {
    return;
  }

  blockModel(model.id, model.stickyFallbackSeconds);
  logInfo("proxy.model_blocked_for_slow_completion", {
    requestId: input.requestId,
    requestType: input.requestType,
    modelId: model.id,
    modelName: model.displayName,
    upstreamRequestId: input.upstreamRequestId || null,
    outputTokens: usage.outputTokens,
    durationMs: input.durationMs,
    avgTokensPerSecond: Number(avgTokensPerSecond.toFixed(2)),
    minTokensPerSecond: model.slowStickyMinTokensPerSecond,
    minCompletionSeconds: model.slowStickyMinCompletionSeconds,
    stickyFallbackSeconds: model.stickyFallbackSeconds,
  });
}

async function recordUsageLog(
  prisma: PrismaClient,
  model: ProxyModel,
  input: {
    requestId: string;
    requestType: "proxy" | "playground";
    proxyKeyId: string | null;
    success: boolean;
    statusCode: number;
    requestPayload: PrismaTypes.InputJsonValue | null;
    responsePayload: PrismaTypes.InputJsonValue | null;
    errorMessage?: string;
    upstreamRequestId?: string | null;
    durationMs?: number;
    isFallback?: boolean;
    isStickyFallback?: boolean;
    originalModelId?: string | null;
    fallbackChain?: string[];
    retryCount?: number;
  },
) {
  const usage =
    input.responsePayload && typeof input.responsePayload === "object"
      ? extractUsage(input.responsePayload as Record<string, unknown>)
      : { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };

  await prisma.usageLog.create({
    data: {
      requestId: input.requestId,
      requestType: input.requestType,
      success: input.success,
      statusCode: input.statusCode,
      inputTokens: usage.inputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      outputTokens: usage.outputTokens,
      totalCost: computeCost(model, usage),
      durationMs: input.durationMs ?? null,
      requestPayload: input.requestPayload ?? Prisma.JsonNull,
      responsePayload: input.responsePayload ?? Prisma.JsonNull,
      errorMessage: input.errorMessage || null,
      upstreamRequestId: input.upstreamRequestId || null,
      isFallback: input.isFallback ?? false,
      isStickyFallback: input.isStickyFallback ?? false,
      originalModelId: input.originalModelId ?? null,
      fallbackChain: input.fallbackChain ?? [],
      retryCount: input.retryCount ?? 0,
      completedAt: new Date(),
      proxyKeyId: input.proxyKeyId,
      proxyModelId: model.id,
    },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Helper function to attempt a single request
async function attemptChatCompletion(
  prisma: PrismaClient,
  input: {
    body: Record<string, unknown>;
    model: ProxyModel;
    proxyKeyId: string | null;
    requestType: "proxy" | "playground";
  },
): Promise<{
  response: Response;
  success: boolean;
  errorMessage?: string;
  upstreamRequestId?: string | null;
  abortController: AbortController;
}> {
  const abortController = new AbortController();

  try {
    const providerApiKey = await decryptSecret(
      input.model.providerApiKeyEncrypted,
    );
    const shouldStream = Boolean(input.body.stream);

    const requestBody: Record<string, unknown> = {
      ...(input.model.customParams &&
          typeof input.model.customParams === "object"
        ? (input.model.customParams as Record<string, unknown>)
        : {}),
      ...input.body,
      model: input.model.upstreamModelName,
    };

    // Apply OCR if needed
    if (
      Array.isArray(requestBody.messages) && input.model.interceptImagesWithOcr
    ) {
      requestBody.messages = await applyOcrToMessages(
        prisma,
        requestBody.messages as Array<
          { role: "system" | "user" | "assistant"; content: unknown }
        >,
      );
    }

    if (shouldStream) {
      const existingStreamOptions = requestBody.stream_options &&
          typeof requestBody.stream_options === "object"
        ? (requestBody.stream_options as Record<string, unknown>)
        : {};
      requestBody.stream_options = {
        ...existingStreamOptions,
        include_usage: true,
      };
    }

    const upstreamResponse = await fetch(
      `${input.model.providerBaseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${providerApiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: abortController.signal,
      },
    );

    const upstreamRequestId = upstreamResponse.headers.get("x-request-id");

    if (!upstreamResponse.ok) {
      const errorText = await upstreamResponse.text();
      return {
        response: upstreamResponse,
        success: false,
        errorMessage: errorText,
        upstreamRequestId,
        abortController,
      };
    }

    return {
      response: upstreamResponse,
      success: true,
      upstreamRequestId,
      abortController,
    };
  } catch (error) {
    return {
      response: new Response(
        JSON.stringify({
          error: "Upstream fetch failed",
          details: error instanceof Error
            ? error.message
            : "Unknown upstream fetch error",
        }),
        { status: 502, headers: { "content-type": "application/json" } },
      ),
      success: false,
      errorMessage: error instanceof Error
        ? error.message
        : "Failed to reach upstream provider",
      abortController,
    };
  }
}

async function prepareStreamingResponse(input: {
  upstreamResponse: Response;
  abortController: AbortController;
}): Promise<PreparedStreamingResponse> {
  const body = input.upstreamResponse.body;
  if (!body) {
    return {
      ok: false,
      statusCode: 502,
      errorMessage: "Empty upstream stream body",
    };
  }

  const decoder = new TextDecoder();
  const reader = body.getReader();
  const state = createStreamInspectionState();

  let completeStream: (result: StreamInspectionResult) => void = () =>
    undefined;
  let failStream: (error: unknown) => void = () => undefined;
  const completion = new Promise<StreamInspectionResult>((resolve, reject) => {
    completeStream = resolve;
    failStream = reject;
  });

  const proxyStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            const result = finalizeStreamInspection(state, decoder);
            completeStream(result);
            controller.close();
            return;
          }

          controller.enqueue(value);
          state.buffer += decoder.decode(value, { stream: true });
          inspectSseBuffer(state);
        }
      } catch (error) {
        const streamError = error instanceof Error
          ? error
          : new Error("Failed to proxy upstream stream");
        failStream(streamError);
        controller.error(streamError);
      } finally {
        reader.releaseLock();
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } catch {
        // Ignore cancellation errors from already-closed streams.
      }
    },
  });

  const response = new Response(proxyStream, {
    status: input.upstreamResponse.status,
    headers: new Headers(input.upstreamResponse.headers),
  });

  const cancelStream = async (reason: string) => {
    input.abortController.abort(reason);
    try {
      await reader.cancel(reason);
    } catch {
      // Ignore cancellation errors after aborting the upstream request.
    }
  };

  return { ok: true, response, completion, cancelStream };
}

function createAttemptPath(
  model: ProxyModel,
  path?: AttemptPathNode[],
): AttemptPathNode[] {
  if (path?.length) {
    return path;
  }
  return [{ id: model.id, name: model.displayName }];
}

function appendAttemptPath(
  path: AttemptPathNode[],
  model: ProxyModel,
): AttemptPathNode[] | null {
  if (path.some((node) => node.id === model.id)) {
    return null;
  }
  return [...path, { id: model.id, name: model.displayName }];
}

function pathToFallbackChain(path: AttemptPathNode[]): string[] {
  return path.map((node) => node.name);
}

async function getActiveFallbackModel(
  prisma: PrismaClient,
  fallbackModelId: string,
): Promise<ProxyModel | null> {
  const fallbackModel = await prisma.proxyModel.findUnique({
    where: { id: fallbackModelId },
  });

  if (!fallbackModel || !fallbackModel.isActive) {
    return null;
  }

  return fallbackModel;
}

function createExecutionFailure(
  model: ProxyModel,
  failure: AttemptFailure,
  path: AttemptPathNode[],
  responseError = "Upstream provider error",
  responseDetails?: string,
): ExecutionFailure {
  return {
    ok: false,
    model,
    statusCode: failure.statusCode,
    errorMessage: failure.errorMessage || responseDetails ||
      "Unknown upstream provider error",
    upstreamRequestId: failure.upstreamRequestId || null,
    fallbackChain: pathToFallbackChain(path),
    responseError,
    responseDetails,
  };
}

function wrapExhaustedFailure(
  failure: ExecutionFailure,
): ExecutionFailure {
  return {
    ...failure,
    responseError: "All retry attempts failed",
    responseDetails: failure.errorMessage,
  };
}

async function attemptModelExecution(
  prisma: PrismaClient,
  input: {
    body: Record<string, unknown>;
    model: ProxyModel;
    proxyKeyId: string | null;
    requestType: "proxy" | "playground";
  },
  path: AttemptPathNode[],
): Promise<ExecutionResult> {
  const attemptStartTime = Date.now();
  const result = await attemptChatCompletion(prisma, input);
  const upstreamRequestId = result.upstreamRequestId || null;

  if (!result.success) {
    return createExecutionFailure(input.model, {
      statusCode: result.response.status,
      errorMessage: result.errorMessage,
      upstreamRequestId,
    }, path);
  }

  if (!input.body.stream) {
    const responsePayload = (await result.response.json()) as Record<
      string,
      unknown
    >;
    return {
      ok: true,
      kind: "json",
      model: input.model,
      statusCode: result.response.status,
      responsePayload,
      upstreamRequestId,
      fallbackChain: pathToFallbackChain(path),
      attemptStartTime,
    };
  }

  const preparedResponse = await prepareStreamingResponse({
    upstreamResponse: result.response,
    abortController: result.abortController,
  });
  if (!preparedResponse.ok) {
    return createExecutionFailure(input.model, {
      statusCode: preparedResponse.statusCode,
      errorMessage: preparedResponse.errorMessage,
      upstreamRequestId,
    }, path);
  }

  return {
    ok: true,
    kind: "stream",
    model: input.model,
    statusCode: preparedResponse.response.status,
    response: preparedResponse.response,
    completion: preparedResponse.completion.then((streamResult) => ({
      ...streamResult,
      model: input.model,
      statusCode: preparedResponse.response.status,
      upstreamRequestId,
      fallbackChain: pathToFallbackChain(path),
      attemptStartTime,
    })),
    upstreamRequestId,
    fallbackChain: pathToFallbackChain(path),
    attemptStartTime,
    cancelStream: preparedResponse.cancelStream,
  };
}

async function retryAfterFailure(
  prisma: PrismaClient,
  input: {
    body: Record<string, unknown>;
    model: ProxyModel;
    proxyKeyId: string | null;
    requestType: "proxy" | "playground";
  },
  fallbackContext: FallbackContext,
  path: AttemptPathNode[],
  initialResult: ExecutionFailure,
): Promise<ExecutionResult> {
  const delayMs = input.model.fallbackDelaySeconds * 1000;

  if (!input.model.fallbackModelId) {
    let lastFailure = initialResult;

    for (
      let retryAttempt = 1;
      retryAttempt <= input.model.maxRetries;
      retryAttempt += 1
    ) {
      logError(
        "proxy.retrying_same_model",
        new Error(lastFailure.errorMessage),
        {
          requestId: fallbackContext.requestId,
          requestType: input.requestType,
          modelName: input.model.displayName,
          retryAttempt,
          maxRetries: input.model.maxRetries,
          fallbackChain: pathToFallbackChain(path),
          statusCode: lastFailure.statusCode,
        },
      );

      fallbackContext.totalRetryCount += 1;
      await sleep(delayMs);

      const retryResult = await attemptModelExecution(prisma, input, path);
      if (retryResult.ok) {
        return retryResult;
      }
      lastFailure = retryResult;
    }

    logError(
      "proxy.all_fallbacks_exhausted",
      new Error(lastFailure.errorMessage),
      {
        requestId: fallbackContext.requestId,
        requestType: input.requestType,
        modelName: input.model.displayName,
        totalRetryCount: fallbackContext.totalRetryCount,
        maxRetries: input.model.maxRetries,
        fallbackChain: lastFailure.fallbackChain,
        statusCode: lastFailure.statusCode,
      },
    );

    return wrapExhaustedFailure(lastFailure);
  }

  if (input.model.stickyFallbackSeconds > 0) {
    blockModel(input.model.id, input.model.stickyFallbackSeconds);
  }

  const fallbackModel = await getActiveFallbackModel(
    prisma,
    input.model.fallbackModelId,
  );
  if (!fallbackModel) {
    logError(
      "proxy.fallback_model_unavailable",
      new Error("Fallback model not found or inactive"),
      {
        requestId: fallbackContext.requestId,
        fallbackModelId: input.model.fallbackModelId,
      },
    );
    return wrapExhaustedFailure(createExecutionFailure(
      input.model,
      {
        statusCode: initialResult.statusCode,
        errorMessage: initialResult.errorMessage ||
          "Fallback model unavailable",
        upstreamRequestId: initialResult.upstreamRequestId,
      },
      path,
    ));
  }

  const fallbackPath = appendAttemptPath(path, fallbackModel);
  if (!fallbackPath) {
    logError(
      "proxy.fallback_cycle_detected",
      new Error("Fallback cycle detected"),
      {
        requestId: fallbackContext.requestId,
        requestType: input.requestType,
        fallbackChain: pathToFallbackChain(path),
        attemptedFallbackModelId: fallbackModel.id,
        attemptedFallbackModelName: fallbackModel.displayName,
      },
    );

    return createExecutionFailure(
      input.model,
      {
        statusCode: 500,
        errorMessage: `Fallback cycle detected at ${fallbackModel.displayName}`,
        upstreamRequestId: null,
      },
      path,
      "Fallback cycle detected",
    );
  }

  let lastFailure: ExecutionFailure = initialResult;
  for (
    let retryAttempt = 1;
    retryAttempt <= input.model.maxRetries;
    retryAttempt += 1
  ) {
    logError("proxy.falling_back", new Error(lastFailure.errorMessage), {
      requestId: fallbackContext.requestId,
      requestType: input.requestType,
      fromModel: input.model.displayName,
      toModel: fallbackModel.displayName,
      retryAttempt,
      maxRetries: input.model.maxRetries,
      totalRetryCount: fallbackContext.totalRetryCount,
      fallbackChain: pathToFallbackChain(fallbackPath),
    });

    fallbackContext.totalRetryCount += 1;
    await sleep(delayMs);

    const fallbackResult = await executeRetryTarget(
      prisma,
      {
        ...input,
        model: fallbackModel,
      },
      fallbackContext,
      fallbackPath,
    );
    if (fallbackResult.ok) {
      return fallbackResult;
    }
    lastFailure = fallbackResult;
  }

  logError(
    "proxy.all_fallbacks_exhausted",
    new Error(lastFailure.errorMessage),
    {
      requestId: fallbackContext.requestId,
      requestType: input.requestType,
      modelName: input.model.displayName,
      totalRetryCount: fallbackContext.totalRetryCount,
      maxRetries: input.model.maxRetries,
      fallbackChain: lastFailure.fallbackChain,
      statusCode: lastFailure.statusCode,
    },
  );

  return wrapExhaustedFailure(lastFailure);
}

async function pipeStreamResult(
  controller: ReadableStreamDefaultController<Uint8Array>,
  result: Extract<ExecutionSuccess, { kind: "stream" }>,
): Promise<StreamCompletionResult> {
  const body = result.response.body;
  if (!body) {
    throw new Error("Empty upstream stream body");
  }

  const reader = body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      controller.enqueue(value);
    }
  } finally {
    reader.releaseLock();
  }

  return await result.completion;
}

async function pipePrimaryStreamUntilFirstChunk(input: {
  controller: ReadableStreamDefaultController<Uint8Array>;
  result: Extract<ExecutionSuccess, { kind: "stream" }>;
  timeoutMs: number;
  timeoutMessage: string;
}): Promise<
  | { kind: "completed"; completion: StreamCompletionResult }
  | { kind: "timeout" }
  | { kind: "failed"; error: Error }
> {
  const body = input.result.response.body;
  if (!body) {
    return { kind: "failed", error: new Error("Empty upstream stream body") };
  }

  const reader = body.getReader();
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<{ kind: "timeout" }>((resolve) => {
    timeoutHandle = setTimeout(
      () => resolve({ kind: "timeout" }),
      Math.max(0, input.timeoutMs),
    );
  });
  const firstReadResult = await Promise.race([
    reader.read().then((result) => ({ kind: "read" as const, result })),
    timeoutPromise,
  ]).catch((error) => ({
    kind: "failed" as const,
    error: error instanceof Error
      ? error
      : new Error("Failed to proxy upstream stream"),
  }));
  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
  }

  try {
    if (firstReadResult.kind === "timeout") {
      await reader.cancel(input.timeoutMessage).catch(() => undefined);
      await input.result.cancelStream?.(input.timeoutMessage);
      void input.result.completion.catch(() => undefined);
      return { kind: "timeout" };
    }

    if (firstReadResult.kind === "failed") {
      return { kind: "failed", error: firstReadResult.error };
    }

    if (firstReadResult.result.done) {
      const completion = await input.result.completion;
      if (completion.assistantText.length > 0 || completion.usagePayload) {
        return { kind: "completed", completion };
      }
      return {
        kind: "failed",
        error: new Error("Upstream stream completed before any streamed bytes"),
      };
    }

    input.controller.enqueue(firstReadResult.result.value);

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      input.controller.enqueue(value);
    }
  } finally {
    reader.releaseLock();
  }

  return { kind: "completed", completion: await input.result.completion };
}

function createFirstTokenFailure(
  model: ProxyModel,
  path: AttemptPathNode[],
  upstreamRequestId: string | null,
  errorMessage: string,
  statusCode = 504,
): ExecutionFailure {
  return createExecutionFailure(model, {
    statusCode,
    errorMessage,
    upstreamRequestId,
  }, path);
}

function wrapStreamingExecutionWithFallback(
  prisma: PrismaClient,
  input: {
    body: Record<string, unknown>;
    model: ProxyModel;
    proxyKeyId: string | null;
    requestType: "proxy" | "playground";
  },
  fallbackContext: FallbackContext,
  path: AttemptPathNode[],
  initialResult: Extract<ExecutionSuccess, { kind: "stream" }>,
): ExecutionSuccess {
  const timeoutMessage =
    `No streamed token received within ${input.model.firstTokenTimeoutSeconds} seconds`;
  let activeCancel = initialResult.cancelStream;

  let completeStream: (result: StreamCompletionResult) => void = () =>
    undefined;
  let failStream: (error: unknown) => void = () => undefined;
  const completion = new Promise<StreamCompletionResult>((resolve, reject) => {
    completeStream = resolve;
    failStream = reject;
  });

  const response = new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          const remainingMs = (input.model.firstTokenTimeoutSeconds * 1000) -
            (Date.now() - initialResult.attemptStartTime);

          if (remainingMs > 0) {
            const primaryOutcome = await pipePrimaryStreamUntilFirstChunk({
              controller,
              result: initialResult,
              timeoutMs: remainingMs,
              timeoutMessage,
            });

            if (primaryOutcome.kind === "completed") {
              completeStream(primaryOutcome.completion);
              controller.close();
              return;
            }

            const failure = primaryOutcome.kind === "timeout"
              ? createFirstTokenFailure(
                input.model,
                path,
                initialResult.upstreamRequestId,
                timeoutMessage,
              )
              : createFirstTokenFailure(
                input.model,
                path,
                initialResult.upstreamRequestId,
                primaryOutcome.error.message,
                502,
              );

            const retryResult = await retryAfterFailure(
              prisma,
              input,
              fallbackContext,
              path,
              failure,
            );
            if (!retryResult.ok) {
              throw new Error(retryResult.errorMessage);
            }
            if (retryResult.kind !== "stream") {
              throw new Error("Expected a streamed fallback response");
            }

            activeCancel = retryResult.cancelStream;
            completeStream(await pipeStreamResult(controller, retryResult));
            controller.close();
            return;
          }

          await initialResult.cancelStream?.(timeoutMessage);
          const retryResult = await retryAfterFailure(
            prisma,
            input,
            fallbackContext,
            path,
            createFirstTokenFailure(
              input.model,
              path,
              initialResult.upstreamRequestId,
              timeoutMessage,
            ),
          );
          if (!retryResult.ok) {
            throw new Error(retryResult.errorMessage);
          }
          if (retryResult.kind !== "stream") {
            throw new Error("Expected a streamed fallback response");
          }

          activeCancel = retryResult.cancelStream;
          completeStream(await pipeStreamResult(controller, retryResult));
          controller.close();
        } catch (error) {
          failStream(error);
          controller.error(
            error instanceof Error
              ? error
              : new Error("Failed to proxy upstream stream"),
          );
        }
      },
      async cancel(reason) {
        const message = reason instanceof Error
          ? reason.message
          : typeof reason === "string"
          ? reason
          : "Client cancelled stream";
        await activeCancel?.(message);
      },
    }),
    {
      status: initialResult.response.status,
      headers: new Headers(initialResult.response.headers),
    },
  );

  return {
    ...initialResult,
    response,
    completion,
    cancelStream: activeCancel,
  };
}

async function executeRetryTarget(
  prisma: PrismaClient,
  input: {
    body: Record<string, unknown>;
    model: ProxyModel;
    proxyKeyId: string | null;
    requestType: "proxy" | "playground";
  },
  fallbackContext: FallbackContext,
  path: AttemptPathNode[],
): Promise<ExecutionResult> {
  if (isModelBlocked(input.model.id)) {
    const blockExpiry = stickyBlocks.get(input.model.id);
    logInfo("proxy.model_sticky_blocked", {
      requestId: fallbackContext.requestId,
      modelId: input.model.id,
      modelName: input.model.displayName,
      blockedUntil: blockExpiry ? new Date(blockExpiry).toISOString() : null,
      fallbackModelId: input.model.fallbackModelId,
    });

    if (input.model.fallbackModelId) {
      const fallbackModel = await getActiveFallbackModel(
        prisma,
        input.model.fallbackModelId,
      );
      if (fallbackModel) {
        const fallbackPath = appendAttemptPath(path, fallbackModel);
        if (!fallbackPath) {
          logError(
            "proxy.fallback_cycle_detected",
            new Error("Fallback cycle detected"),
            {
              requestId: fallbackContext.requestId,
              requestType: input.requestType,
              fallbackChain: pathToFallbackChain(path),
              attemptedFallbackModelId: fallbackModel.id,
              attemptedFallbackModelName: fallbackModel.displayName,
            },
          );

          return createExecutionFailure(
            input.model,
            {
              statusCode: 500,
              errorMessage:
                `Fallback cycle detected at ${fallbackModel.displayName}`,
              upstreamRequestId: null,
            },
            path,
            "Fallback cycle detected",
          );
        }

        fallbackContext.isStickyFallback = true;

        logInfo("proxy.using_sticky_fallback", {
          requestId: fallbackContext.requestId,
          requestType: input.requestType,
          blockedModel: input.model.displayName,
          fallbackModel: fallbackModel.displayName,
          fallbackChain: pathToFallbackChain(fallbackPath),
          totalRetryCount: fallbackContext.totalRetryCount,
        });

        return executeRetryTarget(
          prisma,
          {
            ...input,
            model: fallbackModel,
          },
          fallbackContext,
          fallbackPath,
        );
      }
    }

    logError(
      "proxy.model_blocked_no_fallback",
      new Error("Model is temporarily blocked and has no fallback"),
      {
        requestId: fallbackContext.requestId,
        modelId: input.model.id,
        modelName: input.model.displayName,
        blockedUntil: blockExpiry ? new Date(blockExpiry).toISOString() : null,
      },
    );

    return createExecutionFailure(
      input.model,
      {
        statusCode: 503,
        errorMessage:
          "Model is temporarily blocked (sticky fallback) and no fallback model available",
        upstreamRequestId: null,
      },
      path,
      "Model temporarily unavailable",
      "This model is temporarily blocked after consecutive failures. Please try again later.",
    );
  }

  const initialResult = await attemptModelExecution(prisma, input, path);
  if (
    initialResult.ok &&
    initialResult.kind === "stream" &&
    input.model.firstTokenTimeoutEnabled &&
    input.model.maxRetries > 0 &&
    initialResult.cancelStream
  ) {
    return wrapStreamingExecutionWithFallback(
      prisma,
      input,
      fallbackContext,
      path,
      initialResult,
    );
  }

  if (initialResult.ok || input.model.maxRetries <= 0) {
    return initialResult;
  }

  return retryAfterFailure(prisma, input, fallbackContext, path, initialResult);
}

export async function forwardChatCompletion(
  prisma: PrismaClient,
  input: {
    body: Record<string, unknown>;
    model: ProxyModel;
    proxyKeyId: string | null;
    requestType: "proxy" | "playground";
  },
  fallbackContext?: FallbackContext,
): Promise<Response> {
  const requestStartTime = fallbackContext?.requestStartTime ?? Date.now();
  const logging = await getLoggingSettings(prisma);
  const requestId = fallbackContext?.requestId ?? crypto.randomUUID();

  if (!fallbackContext) {
    fallbackContext = {
      requestId,
      requestStartTime,
      originalModelId: input.model.id,
      originalModelName: input.model.displayName,
      totalRetryCount: 0,
    };

    logInfo("proxy.forward_start", {
      requestId,
      requestType: input.requestType,
      modelId: input.model.id,
      modelName: input.model.displayName,
      upstreamModel: input.model.upstreamModelName,
      maxRetries: input.model.maxRetries,
      fallbackDelaySeconds: input.model.fallbackDelaySeconds,
      hasFallbackModel: !!input.model.fallbackModelId,
      ...summarizeMessages(input.body.messages),
    });
  }

  const executionResult = await executeRetryTarget(
    prisma,
    input,
    fallbackContext,
    createAttemptPath(input.model),
  );

  if (!executionResult.ok) {
    await recordUsageLog(prisma, executionResult.model, {
      requestId,
      requestType: input.requestType,
      proxyKeyId: input.proxyKeyId,
      success: false,
      statusCode: executionResult.statusCode,
      requestPayload: logging.logPayloads
        ? (input.body as PrismaTypes.InputJsonValue)
        : null,
      responsePayload: logging.logPayloads
        ? ({
          error: executionResult.errorMessage,
        } as PrismaTypes.InputJsonValue)
        : null,
      errorMessage: executionResult.errorMessage,
      upstreamRequestId: executionResult.upstreamRequestId,
      durationMs: Date.now() - requestStartTime,
      isFallback: fallbackContext.totalRetryCount > 0 ||
        fallbackContext.isStickyFallback || false,
      isStickyFallback: fallbackContext.isStickyFallback || false,
      originalModelId:
        fallbackContext.totalRetryCount > 0 || fallbackContext.isStickyFallback
          ? fallbackContext.originalModelId
          : null,
      fallbackChain: executionResult.fallbackChain,
      retryCount: fallbackContext.totalRetryCount,
    });

    const responseBody: Record<string, unknown> = {
      error: executionResult.responseError,
      details: executionResult.responseDetails || executionResult.errorMessage,
    };
    if (executionResult.responseError === "All retry attempts failed") {
      responseBody.fallbackChain = executionResult.fallbackChain;
    }

    return Response.json(responseBody, { status: executionResult.statusCode });
  }

  if (fallbackContext.totalRetryCount > 0) {
    logInfo("proxy.request_succeeded_after_fallback", {
      requestId,
      modelName: executionResult.model.displayName,
      totalRetryCount: fallbackContext.totalRetryCount,
      fallbackChain: executionResult.fallbackChain,
    });
  }

  if (executionResult.kind === "json") {
    const attemptDurationMs = Date.now() - executionResult.attemptStartTime;
    await recordUsageLog(prisma, executionResult.model, {
      requestId,
      requestType: input.requestType,
      proxyKeyId: input.proxyKeyId,
      success: true,
      statusCode: executionResult.statusCode,
      requestPayload: logging.logPayloads
        ? (input.body as PrismaTypes.InputJsonValue)
        : null,
      responsePayload: executionResult
        .responsePayload as PrismaTypes.InputJsonValue,
      upstreamRequestId: executionResult.upstreamRequestId,
      durationMs: Date.now() - requestStartTime,
      isFallback: fallbackContext.totalRetryCount > 0 ||
        fallbackContext.isStickyFallback || false,
      isStickyFallback: fallbackContext.isStickyFallback || false,
      originalModelId:
        fallbackContext.totalRetryCount > 0 || fallbackContext.isStickyFallback
          ? fallbackContext.originalModelId
          : null,
      fallbackChain: executionResult.fallbackChain,
      retryCount: fallbackContext.totalRetryCount,
    });
    maybeBlockSlowModel(executionResult.model, {
      usagePayload: executionResult.responsePayload,
      durationMs: attemptDurationMs,
      requestId,
      requestType: input.requestType,
      upstreamRequestId: executionResult.upstreamRequestId,
    });

    return Response.json(executionResult.responsePayload, {
      status: executionResult.statusCode,
    });
  }

  void executionResult.completion
    .then(async ({
      usagePayload,
      assistantText,
      model,
      upstreamRequestId,
      fallbackChain,
      attemptStartTime,
      statusCode,
    }) => {
      const attemptDurationMs = Date.now() - attemptStartTime;
      logInfo("proxy.stream_complete", {
        requestId,
        requestType: input.requestType,
        modelName: model.displayName,
        upstreamRequestId,
        usage: usagePayload?.usage || null,
        assistantTextLength: assistantText.length,
        totalRetryCount: fallbackContext!.totalRetryCount,
      });
      await recordUsageLog(prisma, model, {
        requestId,
        requestType: input.requestType,
        proxyKeyId: input.proxyKeyId,
        success: true,
        statusCode,
        requestPayload: logging.logPayloads
          ? (input.body as PrismaTypes.InputJsonValue)
          : null,
        responsePayload: logging.logPayloads
          ? ({
            usage: usagePayload?.usage || null,
            assistantText,
          } as PrismaTypes.InputJsonValue)
          : ((usagePayload || {}) as PrismaTypes.InputJsonValue),
        upstreamRequestId,
        durationMs: Date.now() - requestStartTime,
        isFallback: fallbackContext!.totalRetryCount > 0 ||
          fallbackContext!.isStickyFallback || false,
        isStickyFallback: fallbackContext!.isStickyFallback || false,
        originalModelId: fallbackContext!.totalRetryCount > 0 ||
            fallbackContext!.isStickyFallback
          ? fallbackContext!.originalModelId
          : null,
        fallbackChain,
        retryCount: fallbackContext!.totalRetryCount,
      });
      maybeBlockSlowModel(model, {
        usagePayload,
        durationMs: attemptDurationMs,
        requestId,
        requestType: input.requestType,
        upstreamRequestId,
      });
    })
    .catch(async (error) => {
      logError("proxy.stream_inspection_failed", error, {
        requestId,
        requestType: input.requestType,
        modelName: executionResult.model.displayName,
        upstreamRequestId: executionResult.upstreamRequestId,
      });
      await recordUsageLog(prisma, executionResult.model, {
        requestId,
        requestType: input.requestType,
        proxyKeyId: input.proxyKeyId,
        success: false,
        statusCode: 502,
        requestPayload: logging.logPayloads
          ? (input.body as PrismaTypes.InputJsonValue)
          : null,
        responsePayload: null,
        errorMessage: error instanceof Error
          ? error.message
          : "Failed to inspect stream",
        upstreamRequestId: executionResult.upstreamRequestId,
        durationMs: Date.now() - requestStartTime,
        isFallback: fallbackContext!.totalRetryCount > 0 ||
          fallbackContext!.isStickyFallback || false,
        isStickyFallback: fallbackContext!.isStickyFallback || false,
        originalModelId: fallbackContext!.totalRetryCount > 0 ||
            fallbackContext!.isStickyFallback
          ? fallbackContext!.originalModelId
          : null,
        fallbackChain: executionResult.fallbackChain,
        retryCount: fallbackContext!.totalRetryCount,
      });
    });

  return executionResult.response;
}
