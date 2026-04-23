import type { PrismaClient } from "@prisma/client";
import { decryptSecret, encryptSecret } from "../lib/security.ts";

export type LoggingSettings = {
  logPayloads: boolean;
  payloadRetention:
    | "1_hour"
    | "24_hours"
    | "7_days"
    | "30_days"
    | "90_days"
    | "indefinite";
};

type StoredOcrSettings = {
  enabled: boolean;
  providerId: string;
  providerBaseUrl: string;
  apiKeyEncrypted: string;
  model: string;
  systemPrompt: string;
  cacheEnabled: boolean;
  cacheTtlSeconds: number;
};

export type AdminOcrSettings = {
  enabled: boolean;
  providerId: string;
  providerBaseUrl: string;
  model: string;
  systemPrompt: string;
  cacheEnabled: boolean;
  cacheTtlSeconds: number;
  apiKeyConfigured: boolean;
};

export type OcrRuntimeSettings = {
  enabled: boolean;
  providerBaseUrl: string;
  model: string;
  systemPrompt: string;
  cacheEnabled: boolean;
  cacheTtlSeconds: number;
  apiKey: string;
};

const LOGGING_KEY = "logging";
const OCR_KEY = "ocr";
const REFRESH_KEY = "refresh";

const defaultLoggingSettings: LoggingSettings = {
  logPayloads: false,
  payloadRetention: "7_days",
};

const defaultOcrSettings: StoredOcrSettings = {
  enabled: false,
  providerId: "",
  providerBaseUrl: "https://api.openai.com/v1",
  apiKeyEncrypted: "",
  model: "gpt-4.1-mini",
  systemPrompt:
    "convert the image to markdown/latex if applicable, otherwise describe the non-text content part of the image in detail. if there is text present in the image, provide all of the text in the image, unabridged verbatim",
  cacheEnabled: true,
  cacheTtlSeconds: 3600,
};

const defaultRefreshSettings = {
  enabled: true,
  intervalSeconds: 30,
};

async function getSetting<T>(
  prisma: PrismaClient,
  key: string,
  fallback: T,
): Promise<T> {
  const setting = await prisma.appSetting.findUnique({
    where: { key },
  });

  if (!setting) {
    return fallback;
  }

  return {
    ...fallback,
    ...(setting.value as Record<string, unknown>),
  } as T;
}

async function upsertSetting<T>(
  prisma: PrismaClient,
  key: string,
  value: T,
): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key },
    update: { value: value as never },
    create: {
      key,
      value: value as never,
    },
  });
}

export function getLoggingSettings(
  prisma: PrismaClient,
): Promise<LoggingSettings> {
  return getSetting(prisma, LOGGING_KEY, defaultLoggingSettings);
}

export async function saveLoggingSettings(
  prisma: PrismaClient,
  settings: LoggingSettings,
): Promise<LoggingSettings> {
  const merged = {
    ...defaultLoggingSettings,
    ...settings,
  };
  await upsertSetting(prisma, LOGGING_KEY, merged);
  return merged;
}

export function getStoredOcrSettings(
  prisma: PrismaClient,
): Promise<StoredOcrSettings> {
  return getSetting(prisma, OCR_KEY, defaultOcrSettings);
}

export async function getAdminOcrSettings(
  prisma: PrismaClient,
): Promise<AdminOcrSettings> {
  const settings = await getStoredOcrSettings(prisma);

  // Resolve providerId to get effective providerBaseUrl
  let effectiveProviderBaseUrl = settings.providerBaseUrl;
  if (settings.providerId) {
    const provider = await prisma.provider.findUnique({
      where: { id: settings.providerId },
    });
    if (provider) {
      effectiveProviderBaseUrl = provider.baseUrl;
    }
  }

  return {
    enabled: settings.enabled,
    providerId: settings.providerId,
    providerBaseUrl: effectiveProviderBaseUrl,
    model: settings.model,
    systemPrompt: settings.systemPrompt,
    cacheEnabled: settings.cacheEnabled,
    cacheTtlSeconds: settings.cacheTtlSeconds,
    apiKeyConfigured: Boolean(settings.apiKeyEncrypted),
  };
}

export async function getOcrRuntimeSettings(
  prisma: PrismaClient,
): Promise<OcrRuntimeSettings> {
  const settings = await getStoredOcrSettings(prisma);

  // Resolve provider to get effective baseUrl and apiKey
  let effectiveProviderBaseUrl = settings.providerBaseUrl;
  let effectiveApiKey = settings.apiKeyEncrypted
    ? await decryptSecret(settings.apiKeyEncrypted)
    : "";

  if (settings.providerId) {
    const provider = await prisma.provider.findUnique({
      where: { id: settings.providerId },
    });
    if (provider) {
      effectiveProviderBaseUrl = provider.baseUrl;
      effectiveApiKey = await decryptSecret(provider.apiKeyEncrypted);
    }
  }

  return {
    enabled: settings.enabled,
    providerBaseUrl: effectiveProviderBaseUrl,
    model: settings.model,
    systemPrompt: settings.systemPrompt,
    cacheEnabled: settings.cacheEnabled,
    cacheTtlSeconds: settings.cacheTtlSeconds,
    apiKey: effectiveApiKey,
  };
}

export async function saveOcrSettings(
  prisma: PrismaClient,
  input: {
    enabled: boolean;
    providerId: string;
    providerBaseUrl: string;
    model: string;
    systemPrompt: string;
    cacheEnabled: boolean;
    cacheTtlSeconds: number;
    apiKey?: string;
  },
): Promise<AdminOcrSettings> {
  const existing = await getStoredOcrSettings(prisma);

  // Only save custom API key if using a custom provider
  let apiKeyEncrypted = existing.apiKeyEncrypted;
  if (!input.providerId && input.apiKey?.trim()) {
    apiKeyEncrypted = await encryptSecret(input.apiKey.trim());
  }

  const nextValue: StoredOcrSettings = {
    enabled: input.enabled,
    providerId: input.providerId || "",
    providerBaseUrl: input.providerBaseUrl.trim().replace(/\/+$/, ""),
    model: input.model.trim(),
    systemPrompt: input.systemPrompt.trim(),
    cacheEnabled: input.cacheEnabled,
    cacheTtlSeconds: input.cacheTtlSeconds,
    apiKeyEncrypted,
  };

  await upsertSetting(prisma, OCR_KEY, nextValue);
  return getAdminOcrSettings(prisma);
}

export type RefreshSettings = {
  enabled: boolean;
  intervalSeconds: number;
};

export function getRefreshSettings(
  prisma: PrismaClient,
): Promise<RefreshSettings> {
  return getSetting(prisma, REFRESH_KEY, defaultRefreshSettings);
}

export async function saveRefreshSettings(
  prisma: PrismaClient,
  settings: RefreshSettings,
): Promise<RefreshSettings> {
  const merged = {
    ...defaultRefreshSettings,
    ...settings,
  };
  await upsertSetting(prisma, REFRESH_KEY, merged);
  return merged;
}
