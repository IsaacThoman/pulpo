import prismaPackage from "@prisma/client";
import type { Prisma as PrismaTypes, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { decryptSecret, encryptSecret } from "../lib/security.ts";
import {
  getLoggingSettings,
  getRefreshSettings,
  getStoredOcrSettings,
} from "./settings.ts";

const { Prisma } = prismaPackage;

const migrationProxyKeySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  keyHash: z.string().min(1),
  prefix: z.string().min(1),
  lastFour: z.string().min(1),
  isActive: z.boolean(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  lastUsedAt: z.string().min(1).nullable(),
});

const migrationProviderSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  baseUrl: z.string().url(),
  apiKey: z.string(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

const migrationProxyModelSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string(),
  providerId: z.string().min(1).nullable(),
  providerBaseUrl: z.string().url(),
  providerApiKey: z.string(),
  upstreamModelName: z.string().min(1),
  providerProtocol: z.enum(["chat_completions", "responses"]),
  reasoningSummaryMode: z.enum(["off", "auto", "concise", "detailed"]),
  reasoningOutputMode: z.enum(["off", "think_tags", "reasoning_content"]),
  interceptImagesWithOcr: z.boolean(),
  customParams: z.unknown(),
  inputCostPerMillion: z.number(),
  cachedInputCostPerMillion: z.number(),
  outputCostPerMillion: z.number(),
  includeCostInUsage: z.boolean(),
  isActive: z.boolean(),
  fallbackModelId: z.string().min(1).nullable(),
  maxRetries: z.number().int().min(0),
  fallbackDelaySeconds: z.number().int().min(0),
  stickyFallbackSeconds: z.number().int().min(0),
  firstTokenTimeoutEnabled: z.boolean(),
  firstTokenTimeoutSeconds: z.number().int().min(1),
  slowStickyEnabled: z.boolean(),
  slowStickyMinTokensPerSecond: z.number().positive(),
  slowStickyMinCompletionSeconds: z.number().int().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

const migrationSimSegmentSchema = z.union([
  z.object({
    type: z.literal("delay"),
    delayMs: z.number().int().min(0),
  }),
  z.object({
    type: z.literal("text"),
    content: z.string().min(1),
    ratePerSecond: z.number().positive(),
    unit: z.enum(["char", "token"]),
    maxUpdatesPerSecond: z.number().int().min(1),
  }),
]);

const migrationSimModelSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string(),
  isActive: z.boolean(),
  exposeInModels: z.boolean(),
  segments: z.array(migrationSimSegmentSchema),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

const migrationUsageLogSchema = z.object({
  id: z.string().min(1),
  requestId: z.string().min(1),
  requestType: z.string().min(1),
  success: z.boolean(),
  statusCode: z.number().int(),
  inputTokens: z.number().int(),
  cachedInputTokens: z.number().int(),
  outputTokens: z.number().int(),
  totalCost: z.number(),
  durationMs: z.number().int().nullable(),
  requestPayload: z.unknown().nullable(),
  responsePayload: z.unknown().nullable(),
  errorMessage: z.string().nullable(),
  upstreamRequestId: z.string().nullable(),
  isFallback: z.boolean(),
  isStickyFallback: z.boolean(),
  originalModelId: z.string().nullable(),
  fallbackChain: z.array(z.string()),
  retryCount: z.number().int().min(0),
  isRetryAttempt: z.boolean(),
  createdAt: z.string().min(1),
  completedAt: z.string().min(1).nullable(),
  proxyKeyId: z.string().nullable(),
  proxyModelId: z.string().nullable(),
  simModelId: z.string().nullable(),
});

const migrationSettingsSchema = z.object({
  logging: z.object({
    logPayloads: z.boolean(),
    payloadRetention: z.enum([
      "1_hour",
      "24_hours",
      "7_days",
      "30_days",
      "90_days",
      "indefinite",
    ]),
  }),
  ocr: z.object({
    enabled: z.boolean(),
    providerId: z.string(),
    providerBaseUrl: z.string().url(),
    apiKey: z.string(),
    model: z.string().min(1),
    systemPrompt: z.string().min(1),
    cacheEnabled: z.boolean(),
    cacheTtlSeconds: z.number().int().min(60),
  }),
  refresh: z.object({
    enabled: z.boolean(),
    intervalSeconds: z.number().int().min(5),
  }),
});

export const migrationSnapshotSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string().min(1),
  includeUsageHistory: z.boolean(),
  data: z.object({
    proxyKeys: z.array(migrationProxyKeySchema),
    providers: z.array(migrationProviderSchema),
    proxyModels: z.array(migrationProxyModelSchema),
    simModels: z.array(migrationSimModelSchema),
    settings: migrationSettingsSchema,
    usageLogs: z.array(migrationUsageLogSchema).optional(),
  }),
});

export type MigrationSnapshot = z.infer<typeof migrationSnapshotSchema>;

type SimModelClient = {
  simModel: {
    findMany: (args: unknown) => Promise<unknown[]>;
    deleteMany: (args?: unknown) => Promise<unknown>;
    createMany: (args: unknown) => Promise<unknown>;
    upsert: (args: unknown) => Promise<unknown>;
  };
};

function parseDate(value: string | null): Date | null {
  if (!value) {
    return null;
  }
  return new Date(value);
}

export function parseMigrationSnapshot(value: unknown): MigrationSnapshot {
  return migrationSnapshotSchema.parse(value);
}

export async function createMigrationSnapshot(
  prisma: PrismaClient,
  includeUsageHistory: boolean,
): Promise<MigrationSnapshot> {
  const simClient = prisma as unknown as SimModelClient;
  const [
    proxyKeys,
    providers,
    proxyModels,
    simModels,
    logging,
    refresh,
    storedOcr,
    usageLogs,
  ] = await Promise.all([
    prisma.proxyKey.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.provider.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.proxyModel.findMany({ orderBy: { createdAt: "asc" } }),
    simClient.simModel.findMany({ orderBy: { createdAt: "asc" } }),
    getLoggingSettings(prisma),
    getRefreshSettings(prisma),
    getStoredOcrSettings(prisma),
    includeUsageHistory
      ? prisma.usageLog.findMany({ orderBy: { createdAt: "asc" } })
      : [],
  ]);

  const providersWithSecrets = await Promise.all(
    providers.map(async (provider) => ({
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKeyEncrypted
        ? await decryptSecret(provider.apiKeyEncrypted)
        : "",
      createdAt: provider.createdAt.toISOString(),
      updatedAt: provider.updatedAt.toISOString(),
    })),
  );

  const modelsWithSecrets = await Promise.all(
    proxyModels.map(async (model) => ({
      id: model.id,
      displayName: model.displayName,
      description: model.description || "",
      providerId: model.providerId,
      providerBaseUrl: model.providerBaseUrl,
      providerApiKey: model.providerId
        ? ""
        : model.providerApiKeyEncrypted
        ? await decryptSecret(model.providerApiKeyEncrypted)
        : "",
      upstreamModelName: model.upstreamModelName,
      providerProtocol: model.providerProtocol as
        | "chat_completions"
        | "responses",
      reasoningSummaryMode: model.reasoningSummaryMode as
        | "off"
        | "auto"
        | "concise"
        | "detailed",
      reasoningOutputMode: model.reasoningOutputMode as
        | "off"
        | "think_tags"
        | "reasoning_content",
      interceptImagesWithOcr: model.interceptImagesWithOcr,
      customParams: model.customParams || {},
      inputCostPerMillion: Number(model.inputCostPerMillion),
      cachedInputCostPerMillion: Number(model.cachedInputCostPerMillion),
      outputCostPerMillion: Number(model.outputCostPerMillion),
      includeCostInUsage: model.includeCostInUsage,
      isActive: model.isActive,
      fallbackModelId: model.fallbackModelId,
      maxRetries: model.maxRetries,
      fallbackDelaySeconds: model.fallbackDelaySeconds,
      stickyFallbackSeconds: model.stickyFallbackSeconds,
      firstTokenTimeoutEnabled: model.firstTokenTimeoutEnabled,
      firstTokenTimeoutSeconds: model.firstTokenTimeoutSeconds,
      slowStickyEnabled: model.slowStickyEnabled,
      slowStickyMinTokensPerSecond: model.slowStickyMinTokensPerSecond,
      slowStickyMinCompletionSeconds: model.slowStickyMinCompletionSeconds,
      createdAt: model.createdAt.toISOString(),
      updatedAt: model.updatedAt.toISOString(),
    })),
  );

  const ocrApiKey = storedOcr.providerId
    ? ""
    : storedOcr.apiKeyEncrypted
    ? await decryptSecret(storedOcr.apiKeyEncrypted)
    : "";

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    includeUsageHistory,
    data: {
      proxyKeys: proxyKeys.map((key) => ({
        id: key.id,
        name: key.name,
        keyHash: key.keyHash,
        prefix: key.prefix,
        lastFour: key.lastFour,
        isActive: key.isActive,
        createdAt: key.createdAt.toISOString(),
        updatedAt: key.updatedAt.toISOString(),
        lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
      })),
      providers: providersWithSecrets,
      proxyModels: modelsWithSecrets,
      simModels: (simModels as Array<{
        id: string;
        displayName: string;
        description: string | null;
        isActive: boolean;
        exposeInModels: boolean;
        segments: unknown;
        createdAt: Date;
        updatedAt: Date;
      }>).map((model) => ({
        id: model.id,
        displayName: model.displayName,
        description: model.description || "",
        isActive: model.isActive,
        exposeInModels: model.exposeInModels,
        segments: model
          .segments as MigrationSnapshot["data"]["simModels"][number][
            "segments"
          ],
        createdAt: model.createdAt.toISOString(),
        updatedAt: model.updatedAt.toISOString(),
      })),
      settings: {
        logging,
        ocr: {
          enabled: storedOcr.enabled,
          providerId: storedOcr.providerId,
          providerBaseUrl: storedOcr.providerBaseUrl,
          apiKey: ocrApiKey,
          model: storedOcr.model,
          systemPrompt: storedOcr.systemPrompt,
          cacheEnabled: storedOcr.cacheEnabled,
          cacheTtlSeconds: storedOcr.cacheTtlSeconds,
        },
        refresh,
      },
      ...(includeUsageHistory
        ? {
          usageLogs: usageLogs.map((log) => ({
            id: log.id,
            requestId: log.requestId,
            requestType: log.requestType,
            success: log.success,
            statusCode: log.statusCode,
            inputTokens: log.inputTokens,
            cachedInputTokens: log.cachedInputTokens,
            outputTokens: log.outputTokens,
            totalCost: Number(log.totalCost),
            durationMs: log.durationMs,
            requestPayload: log.requestPayload as
              | Record<string, unknown>
              | null,
            responsePayload: log.responsePayload as
              | Record<string, unknown>
              | null,
            errorMessage: log.errorMessage,
            upstreamRequestId: log.upstreamRequestId,
            isFallback: log.isFallback,
            isStickyFallback: log.isStickyFallback,
            originalModelId: log.originalModelId,
            fallbackChain: log.fallbackChain,
            retryCount: log.retryCount,
            isRetryAttempt: log.isRetryAttempt,
            createdAt: log.createdAt.toISOString(),
            completedAt: log.completedAt?.toISOString() ?? null,
            proxyKeyId: log.proxyKeyId,
            proxyModelId: log.proxyModelId,
            simModelId: log.simModelId,
          })),
        }
        : {}),
    },
  };
}

export async function importMigrationSnapshot(
  prisma: PrismaClient,
  snapshot: MigrationSnapshot,
  includeUsageHistory: boolean,
): Promise<{
  importedAt: string;
  usageHistoryReplaced: boolean;
  counts: {
    proxyKeys: number;
    providers: number;
    proxyModels: number;
    simModels: number;
    usageLogs: number;
    settings: number;
  };
}> {
  if (includeUsageHistory && !snapshot.includeUsageHistory) {
    throw new Error("This backup file does not include usage history");
  }

  const providerIds = new Set(
    snapshot.data.providers.map((provider) => provider.id),
  );
  const modelIds = new Set(snapshot.data.proxyModels.map((model) => model.id));

  for (const model of snapshot.data.proxyModels) {
    if (model.providerId && !providerIds.has(model.providerId)) {
      throw new Error(
        `Model "${model.displayName}" references a missing provider`,
      );
    }
    if (model.fallbackModelId && !modelIds.has(model.fallbackModelId)) {
      throw new Error(
        `Model "${model.displayName}" references a missing fallback model`,
      );
    }
  }

  if (
    snapshot.data.settings.ocr.providerId &&
    !providerIds.has(snapshot.data.settings.ocr.providerId)
  ) {
    throw new Error("OCR settings reference a missing provider");
  }

  const encryptedProviders = await Promise.all(
    snapshot.data.providers.map(async (provider) => ({
      ...provider,
      apiKeyEncrypted: provider.apiKey
        ? await encryptSecret(provider.apiKey)
        : "",
    })),
  );
  const encryptedProviderKeys = new Map(
    encryptedProviders.map((
      provider,
    ) => [provider.id, provider.apiKeyEncrypted]),
  );

  const encryptedModels = await Promise.all(
    snapshot.data.proxyModels.map(async (model) => ({
      ...model,
      providerApiKeyEncrypted: model.providerId
        ? encryptedProviderKeys.get(model.providerId) || ""
        : model.providerApiKey
        ? await encryptSecret(model.providerApiKey)
        : "",
    })),
  );

  const ocrApiKeyEncrypted = snapshot.data.settings.ocr.providerId
    ? ""
    : snapshot.data.settings.ocr.apiKey
    ? await encryptSecret(snapshot.data.settings.ocr.apiKey)
    : "";

  const proxyKeyData = snapshot.data.proxyKeys.map((key) => ({
    id: key.id,
    name: key.name,
    keyHash: key.keyHash,
    prefix: key.prefix,
    lastFour: key.lastFour,
    isActive: key.isActive,
    createdAt: new Date(key.createdAt),
    updatedAt: new Date(key.updatedAt),
    lastUsedAt: parseDate(key.lastUsedAt),
  }));

  const providerData = encryptedProviders.map((provider) => ({
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    apiKeyEncrypted: provider.apiKeyEncrypted,
    createdAt: new Date(provider.createdAt),
    updatedAt: new Date(provider.updatedAt),
  }));

  const modelData = encryptedModels.map((model) => ({
    id: model.id,
    displayName: model.displayName,
    description: model.description || null,
    providerId: model.providerId,
    providerBaseUrl: model.providerBaseUrl,
    providerApiKeyEncrypted: model.providerApiKeyEncrypted,
    upstreamModelName: model.upstreamModelName,
    providerProtocol: model.providerProtocol,
    reasoningSummaryMode: model.reasoningSummaryMode,
    reasoningOutputMode: model.reasoningOutputMode,
    interceptImagesWithOcr: model.interceptImagesWithOcr,
    customParams: model.customParams as PrismaTypes.InputJsonValue,
    inputCostPerMillion: model.inputCostPerMillion,
    cachedInputCostPerMillion: model.cachedInputCostPerMillion,
    outputCostPerMillion: model.outputCostPerMillion,
    includeCostInUsage: model.includeCostInUsage,
    isActive: model.isActive,
    fallbackModelId: null,
    maxRetries: model.maxRetries,
    fallbackDelaySeconds: model.fallbackDelaySeconds,
    stickyFallbackSeconds: model.stickyFallbackSeconds,
    firstTokenTimeoutEnabled: model.firstTokenTimeoutEnabled,
    firstTokenTimeoutSeconds: model.firstTokenTimeoutSeconds,
    slowStickyEnabled: model.slowStickyEnabled,
    slowStickyMinTokensPerSecond: model.slowStickyMinTokensPerSecond,
    slowStickyMinCompletionSeconds: model.slowStickyMinCompletionSeconds,
    createdAt: new Date(model.createdAt),
    updatedAt: new Date(model.updatedAt),
  }));

  const simModelData = snapshot.data.simModels.map((model) => ({
    id: model.id,
    displayName: model.displayName,
    description: model.description || null,
    isActive: model.isActive,
    exposeInModels: model.exposeInModels,
    segments: model.segments,
    createdAt: new Date(model.createdAt),
    updatedAt: new Date(model.updatedAt),
  }));

  await prisma.$transaction(async (tx) => {
    const txWithSimModels = tx as typeof tx & SimModelClient;

    if (includeUsageHistory) {
      await tx.usageLog.deleteMany({});
      await tx.proxyModel.deleteMany({});
      await txWithSimModels.simModel.deleteMany({});
      await tx.provider.deleteMany({});
      await tx.proxyKey.deleteMany({});

      if (proxyKeyData.length > 0) {
        await tx.proxyKey.createMany({ data: proxyKeyData });
      }

      if (providerData.length > 0) {
        await tx.provider.createMany({ data: providerData });
      }

      if (modelData.length > 0) {
        await tx.proxyModel.createMany({ data: modelData });
      }

      if (simModelData.length > 0) {
        await txWithSimModels.simModel.createMany({ data: simModelData });
      }
    } else {
      for (const key of proxyKeyData) {
        await tx.proxyKey.upsert({
          where: { id: key.id },
          update: key,
          create: key,
        });
      }

      for (const provider of providerData) {
        await tx.provider.upsert({
          where: { id: provider.id },
          update: provider,
          create: provider,
        });
      }

      for (const model of modelData) {
        await tx.proxyModel.upsert({
          where: { id: model.id },
          update: model,
          create: model,
        });
      }

      for (const simModel of simModelData) {
        await txWithSimModels.simModel.upsert({
          where: { id: simModel.id },
          update: simModel,
          create: simModel,
        });
      }
    }

    for (const model of encryptedModels) {
      await tx.proxyModel.update({
        where: { id: model.id },
        data: { fallbackModelId: model.fallbackModelId },
      });
    }

    if (!includeUsageHistory) {
      if (modelData.length > 0) {
        await tx.proxyModel.deleteMany({
          where: { id: { notIn: modelData.map((model) => model.id) } },
        });
      } else {
        await tx.proxyModel.deleteMany({});
      }

      if (simModelData.length > 0) {
        await txWithSimModels.simModel.deleteMany({
          where: { id: { notIn: simModelData.map((model) => model.id) } },
        });
      } else {
        await txWithSimModels.simModel.deleteMany({});
      }

      if (providerData.length > 0) {
        await tx.provider.deleteMany({
          where: { id: { notIn: providerData.map((provider) => provider.id) } },
        });
      } else {
        await tx.provider.deleteMany({});
      }

      if (proxyKeyData.length > 0) {
        await tx.proxyKey.deleteMany({
          where: { id: { notIn: proxyKeyData.map((key) => key.id) } },
        });
      } else {
        await tx.proxyKey.deleteMany({});
      }
    }

    await tx.appSetting.upsert({
      where: { key: "logging" },
      update: {
        value: snapshot.data.settings.logging as PrismaTypes.InputJsonValue,
      },
      create: {
        key: "logging",
        value: snapshot.data.settings.logging as PrismaTypes.InputJsonValue,
      },
    });

    await tx.appSetting.upsert({
      where: { key: "ocr" },
      update: {
        value: {
          enabled: snapshot.data.settings.ocr.enabled,
          providerId: snapshot.data.settings.ocr.providerId,
          providerBaseUrl: snapshot.data.settings.ocr.providerBaseUrl,
          apiKeyEncrypted: ocrApiKeyEncrypted,
          model: snapshot.data.settings.ocr.model,
          systemPrompt: snapshot.data.settings.ocr.systemPrompt,
          cacheEnabled: snapshot.data.settings.ocr.cacheEnabled,
          cacheTtlSeconds: snapshot.data.settings.ocr.cacheTtlSeconds,
        } as PrismaTypes.InputJsonValue,
      },
      create: {
        key: "ocr",
        value: {
          enabled: snapshot.data.settings.ocr.enabled,
          providerId: snapshot.data.settings.ocr.providerId,
          providerBaseUrl: snapshot.data.settings.ocr.providerBaseUrl,
          apiKeyEncrypted: ocrApiKeyEncrypted,
          model: snapshot.data.settings.ocr.model,
          systemPrompt: snapshot.data.settings.ocr.systemPrompt,
          cacheEnabled: snapshot.data.settings.ocr.cacheEnabled,
          cacheTtlSeconds: snapshot.data.settings.ocr.cacheTtlSeconds,
        } as PrismaTypes.InputJsonValue,
      },
    });

    await tx.appSetting.upsert({
      where: { key: "refresh" },
      update: {
        value: snapshot.data.settings.refresh as PrismaTypes.InputJsonValue,
      },
      create: {
        key: "refresh",
        value: snapshot.data.settings.refresh as PrismaTypes.InputJsonValue,
      },
    });

    if (
      includeUsageHistory && snapshot.data.usageLogs &&
      snapshot.data.usageLogs.length > 0
    ) {
      await tx.usageLog.createMany({
        data: snapshot.data.usageLogs.map((log) => ({
          id: log.id,
          requestId: log.requestId,
          requestType: log.requestType,
          success: log.success,
          statusCode: log.statusCode,
          inputTokens: log.inputTokens,
          cachedInputTokens: log.cachedInputTokens,
          outputTokens: log.outputTokens,
          totalCost: log.totalCost,
          durationMs: log.durationMs,
          requestPayload: (log.requestPayload ??
            Prisma.JsonNull) as PrismaTypes.InputJsonValue,
          responsePayload: (log.responsePayload ??
            Prisma.JsonNull) as PrismaTypes.InputJsonValue,
          errorMessage: log.errorMessage,
          upstreamRequestId: log.upstreamRequestId,
          isFallback: log.isFallback,
          isStickyFallback: log.isStickyFallback,
          originalModelId: log.originalModelId,
          fallbackChain: log.fallbackChain,
          retryCount: log.retryCount,
          isRetryAttempt: log.isRetryAttempt,
          createdAt: new Date(log.createdAt),
          completedAt: parseDate(log.completedAt),
          proxyKeyId: log.proxyKeyId,
          proxyModelId: log.proxyModelId,
          simModelId: log.simModelId,
        })),
      });
    }
  });

  return {
    importedAt: new Date().toISOString(),
    usageHistoryReplaced: includeUsageHistory,
    counts: {
      proxyKeys: snapshot.data.proxyKeys.length,
      providers: snapshot.data.providers.length,
      proxyModels: snapshot.data.proxyModels.length,
      simModels: snapshot.data.simModels.length,
      usageLogs: includeUsageHistory ? snapshot.data.usageLogs?.length ?? 0 : 0,
      settings: 3,
    },
  };
}
