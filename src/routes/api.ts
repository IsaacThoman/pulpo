import { Hono } from "hono";
import prismaPackage from "npm:@prisma/client";
import type { Prisma as PrismaTypes } from "npm:@prisma/client";
import { getEncoding } from "npm:js-tiktoken";
import { z } from "npm:zod";
import { config } from "../config.ts";
import { db } from "../db.ts";
import {
  buildExpiredSessionCookie,
  buildSessionCookie,
  decryptSecret,
  generateProxyKeySecret,
  generateSessionToken,
  hashPassword,
  parseCookieHeader,
  sha256Hex,
  verifyPassword,
} from "../lib/security.ts";
import {
  fetchProviderModels,
  forwardChatCompletion,
  persistModelInput,
  persistProviderInput,
  toAdminProviderJson,
  toAdminProxyKeyJson,
  toAdminProxyModelJson,
  toAdminSimModelJson,
} from "../services/proxy.ts";
import {
  createMigrationSnapshot,
  importMigrationSnapshot,
  migrationSnapshotSchema,
} from "../services/migration.ts";
import {
  getAdminOcrSettings,
  getLoggingSettings,
  getRefreshSettings,
  saveLoggingSettings,
  saveOcrSettings,
  saveRefreshSettings,
} from "../services/settings.ts";

const { Prisma } = prismaPackage;

const credentialsSchema = z.object({
  username: z.string().trim().min(3),
  password: z.string().min(8),
});

const proxyKeyCreateSchema = z.object({
  name: z.string().trim().min(1),
  isActive: z.boolean().default(true),
});

const proxyKeyUpdateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  isActive: z.boolean().optional(),
});

const modelSchema = z.object({
  displayName: z.string().trim().min(1),
  description: z.string().optional().default(""),
  providerId: z.string().trim().optional().nullable(),
  providerBaseUrl: z.string().optional().default(""),
  providerApiKey: z.string().optional().default(""),
  upstreamModelName: z.string().trim().min(1),
  providerProtocol: z.enum(["chat_completions", "responses"]).default(
    "responses",
  ),
  reasoningSummaryMode: z.enum(["off", "auto", "concise", "detailed"]).default(
    "off",
  ),
  reasoningOutputMode: z.enum(["off", "think_tags", "reasoning_content"])
    .default("off"),
  interceptImagesWithOcr: z.boolean().default(false),
  customParams: z.unknown().default({}),
  inputCostPerMillion: z.coerce.number().min(0).default(0),
  cachedInputCostPerMillion: z.coerce.number().min(0).default(0),
  outputCostPerMillion: z.coerce.number().min(0).default(0),
  includeCostInUsage: z.boolean().default(false),
  isActive: z.boolean().default(true),
  // Fallback configuration
  fallbackModelId: z.string().trim().optional().nullable(),
  maxRetries: z.coerce.number().min(0).max(10).default(0),
  fallbackDelaySeconds: z.coerce.number().min(0).max(300).default(3),
  stickyFallbackSeconds: z.coerce.number().min(0).max(3600).default(0),
  firstTokenTimeoutEnabled: z.boolean().default(false),
  firstTokenTimeoutSeconds: z.coerce.number().min(1).max(300).default(10),
  slowStickyEnabled: z.boolean().default(false),
  slowStickyMinTokensPerSecond: z.coerce.number().positive().max(1000).default(
    5,
  ),
  slowStickyMinCompletionSeconds: z.coerce.number().min(1).max(3600).default(
    30,
  ),
}).superRefine((data, ctx) => {
  if (
    data.providerProtocol === "chat_completions" &&
    data.reasoningOutputMode !== "off"
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Reasoning output modes require the Responses protocol",
      path: ["reasoningOutputMode"],
    });
  }

  if (
    data.reasoningOutputMode !== "off" && data.reasoningSummaryMode === "off"
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Reasoning summaries must be enabled to expose reasoning output",
      path: ["reasoningSummaryMode"],
    });
  }

  if (data.providerId?.trim()) {
    if (
      data.maxRetries === 0 &&
      (data.firstTokenTimeoutEnabled || data.slowStickyEnabled)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Retry/fallback must be enabled to use fallback triggers",
        path: ["maxRetries"],
      });
    }
    if (data.slowStickyEnabled && data.stickyFallbackSeconds <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Sticky block seconds must be greater than 0 to enable slow sticky fallback",
        path: ["stickyFallbackSeconds"],
      });
    }
    return;
  }

  const baseUrl = data.providerBaseUrl.trim();
  if (!baseUrl) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provider base URL is required for custom providers",
      path: ["providerBaseUrl"],
    });
    return;
  }

  try {
    new URL(baseUrl);
  } catch {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provider base URL must be a valid URL",
      path: ["providerBaseUrl"],
    });
  }

  if (
    data.maxRetries === 0 &&
    (data.firstTokenTimeoutEnabled || data.slowStickyEnabled)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Retry/fallback must be enabled to use fallback triggers",
      path: ["maxRetries"],
    });
  }

  if (data.slowStickyEnabled && data.stickyFallbackSeconds <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Sticky block seconds must be greater than 0 to enable slow sticky fallback",
      path: ["stickyFallbackSeconds"],
    });
  }
});

const providerSchema = z.object({
  name: z.string().trim().min(1),
  baseUrl: z.string().url(),
  apiKey: z.string().optional().default(""),
});

const loggingSchema = z.object({
  logPayloads: z.boolean(),
  payloadRetention: z.enum(["1_hour", "24_hours", "7_days", "30_days", "90_days", "indefinite"]),
});

const ocrSchema = z.object({
  enabled: z.boolean(),
  providerId: z.string().optional().default(""),
  providerBaseUrl: z.string().url().optional().default(""),
  apiKey: z.string().optional().default(""),
  model: z.string().trim().min(1),
  systemPrompt: z.string().trim().min(1),
  cacheEnabled: z.boolean(),
  cacheTtlSeconds: z.coerce.number().int().min(60).max(24 * 60 * 60),
}).refine((data) => {
  // If no providerId is selected, providerBaseUrl is required
  if (!data.providerId && !data.providerBaseUrl) {
    return false;
  }
  return true;
}, {
  message:
    "Provider base URL is required when not using a pre-defined provider",
  path: ["providerBaseUrl"],
});

const refreshSchema = z.object({
  enabled: z.boolean(),
  intervalSeconds: z.coerce.number().int().min(5).max(300),
});

const migrationImportSchema = z.object({
  includeUsageHistory: z.boolean().default(false),
  backup: migrationSnapshotSchema,
});

const providerModelsSchema = z.object({
  providerBaseUrl: z.string().url(),
  apiKey: z.string().trim().min(1),
});

const simSegmentSchema = z.union([
  z.object({
    type: z.literal("delay"),
    delayMs: z.coerce.number().int().min(0).max(600000),
  }),
  z.object({
    type: z.literal("text"),
    content: z.string().min(1),
    ratePerSecond: z.coerce.number().positive().max(10000),
    unit: z.enum(["char", "token"]).default("char"),
    maxUpdatesPerSecond: z.coerce.number().int().min(1).max(120).default(10),
  }),
]);

const simModelSchema = z.object({
  displayName: z.string().trim().min(1),
  description: z.string().optional().default(""),
  isActive: z.boolean().default(true),
  exposeInModels: z.boolean().default(false),
  segments: z.array(simSegmentSchema).min(1),
});

const proxyMessageRoleSchema = z.enum([
  "developer",
  "system",
  "user",
  "assistant",
]);

const proxyChatSchema = z
  .object({
    model: z.string().trim().min(1),
    messages: z.array(
      z.object({
        role: proxyMessageRoleSchema,
        content: z.unknown(),
      }),
    ),
    stream: z.boolean().optional().default(false),
  })
  .passthrough();

const simTokenizer = getEncoding("o200k_base");

function getSimCompletionTokenCount(segments: SimSegment[]): number {
  return segments.reduce((total, segment) => {
    if (segment.type !== "text" || !segment.content) {
      return total;
    }
    return total + simTokenizer.encode(segment.content).length;
  }, 0);
}

function buildSimChunk(
  input: {
    requestId: string;
    created: number;
    model: string;
    delta?: Record<string, unknown>;
    finishReason: string | null;
    usage?: Record<string, unknown>;
  },
): string {
  return `data: ${
    JSON.stringify({
      id: `sim-${input.requestId}`,
      object: "chat.completion.chunk",
      created: input.created,
      model: input.model,
      choices: [{
        index: 0,
        delta: input.delta ?? {},
        finish_reason: input.finishReason,
      }],
      ...(input.usage ? { usage: input.usage } : {}),
    })
  }\n\n`;
}

async function recordSimUsageLog(input: {
  requestId: string;
  proxyKeyId: string | null;
  simModelId: string;
  requestPayload: Record<string, unknown> | null;
  responsePayload: Record<string, unknown> | null;
  success: boolean;
  statusCode: number;
  outputTokens: number;
  durationMs: number;
  errorMessage?: string;
}): Promise<void> {
  await db.usageLog.create({
    data: {
      requestId: input.requestId,
      requestType: "proxy",
      success: input.success,
      statusCode: input.statusCode,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: input.outputTokens,
      totalCost: 0,
      durationMs: input.durationMs,
      requestPayload:
        (input.requestPayload ?? prismaPackage.Prisma.JsonNull) as never,
      responsePayload:
        (input.responsePayload ?? prismaPackage.Prisma.JsonNull) as never,
      errorMessage: input.errorMessage || null,
      completedAt: new Date(),
      proxyKeyId: input.proxyKeyId,
      simModelId: input.simModelId,
    },
  });
}

async function streamSimCharacters(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  input: {
    content: string;
    ratePerSecond: number;
    maxUpdatesPerSecond: number;
    requestId: string;
    created: number;
    model: string;
  },
): Promise<void> {
  const chars = Array.from(input.content);
  const chunkSize = Math.max(
    1,
    Math.ceil(input.ratePerSecond / input.maxUpdatesPerSecond),
  );
  const start = Date.now();

  for (let i = 0; i < chars.length; i += chunkSize) {
    const chunk = chars.slice(i, i + chunkSize).join("");
    controller.enqueue(
      encoder.encode(
        buildSimChunk({
          requestId: input.requestId,
          created: input.created,
          model: input.model,
          delta: { content: chunk },
          finishReason: null,
        }),
      ),
    );

    const emittedCount = Math.min(i + chunkSize, chars.length);
    const nextAt = start +
      Math.round((emittedCount * 1000) / input.ratePerSecond);
    const waitMs = nextAt - Date.now();
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

async function streamSimTokens(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  input: {
    content: string;
    ratePerSecond: number;
    maxUpdatesPerSecond: number;
    requestId: string;
    created: number;
    model: string;
  },
): Promise<void> {
  const tokens = simTokenizer.encode(input.content);
  const chunkSize = Math.max(
    1,
    Math.ceil(input.ratePerSecond / input.maxUpdatesPerSecond),
  );
  const start = Date.now();

  for (let i = 0; i < tokens.length; i += chunkSize) {
    const decoded = simTokenizer.decode(tokens.slice(i, i + chunkSize));
    if (decoded) {
      controller.enqueue(
        encoder.encode(
          buildSimChunk({
            requestId: input.requestId,
            created: input.created,
            model: input.model,
            delta: { content: decoded },
            finishReason: null,
          }),
        ),
      );
    }

    const emittedCount = Math.min(i + chunkSize, tokens.length);
    const nextAt = start +
      Math.round((emittedCount * 1000) / input.ratePerSecond);
    const waitMs = nextAt - Date.now();
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

async function getAdminFromRequest(request: Request) {
  const cookies = parseCookieHeader(request.headers.get("cookie"));
  const sessionToken = cookies[config.sessionCookieName];
  if (!sessionToken) {
    return null;
  }

  const tokenHash = await sha256Hex(sessionToken);
  const session = await db.adminSession.findUnique({
    where: { tokenHash },
    include: {
      adminUser: true,
    },
  });

  if (!session || session.expiresAt <= new Date()) {
    return null;
  }

  return session.adminUser;
}

async function summarizeUsage(
  days: number,
  recentPage: number,
  recentPageSize: number,
) {
  const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const usageWindow = {
    createdAt: {
      gte: start,
    },
  };
  const totalRecentItems = await db.usageLog.count({
    where: usageWindow,
  });
  const totalRecentPages = Math.max(
    1,
    Math.ceil(totalRecentItems / recentPageSize),
  );
  const currentRecentPage = Math.min(
    Math.max(recentPage, 1),
    totalRecentPages,
  );

  const [summaryLogs, recentLogs] = await Promise.all([
    db.usageLog.findMany({
      where: usageWindow,
      select: {
        success: true,
        inputTokens: true,
        cachedInputTokens: true,
        outputTokens: true,
        totalCost: true,
        createdAt: true,
        proxyKeyId: true,
        proxyModelId: true,
        simModelId: true,
        isRetryAttempt: true,
        proxyKey: {
          select: {
            name: true,
          },
        },
        proxyModel: {
          select: {
            displayName: true,
          },
        },
        simModel: {
          select: {
            displayName: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    }),
    db.usageLog.findMany({
      where: usageWindow,
      include: {
        proxyKey: true,
        proxyModel: true,
        simModel: true,
      },
      orderBy: {
        createdAt: "desc",
      },
      skip: (currentRecentPage - 1) * recentPageSize,
      take: recentPageSize,
    }),
  ]);
  type UsageSummaryLog = (typeof summaryLogs)[number];
  const requestLogs = summaryLogs.filter((log: UsageSummaryLog) =>
    !log.isRetryAttempt
  );

  const totals = {
    requests: requestLogs.length,
    successfulRequests:
      requestLogs.filter((log: UsageSummaryLog) => log.success).length,
    inputTokens: requestLogs.reduce(
      (sum: number, log: UsageSummaryLog) => sum + log.inputTokens,
      0,
    ),
    cachedInputTokens: requestLogs.reduce(
      (sum: number, log: UsageSummaryLog) => sum + log.cachedInputTokens,
      0,
    ),
    outputTokens: requestLogs.reduce(
      (sum: number, log: UsageSummaryLog) => sum + log.outputTokens,
      0,
    ),
    totalCost: Number(
      requestLogs.reduce(
        (sum: number, log: UsageSummaryLog) => sum + Number(log.totalCost),
        0,
      ).toFixed(8),
    ),
  };

  const byKey = Object.values(
    requestLogs.reduce<
      Record<string, {
        keyId: string;
        name: string;
        requests: number;
        totalCost: number;
        inputTokens: number;
        outputTokens: number;
      }>
    >((
      accumulator: Record<string, {
        keyId: string;
        name: string;
        requests: number;
        totalCost: number;
        inputTokens: number;
        outputTokens: number;
      }>,
      log: UsageSummaryLog,
    ) => {
      if (!log.proxyKeyId || !log.proxyKey) {
        return accumulator;
      }

      accumulator[log.proxyKeyId] ||= {
        keyId: log.proxyKeyId,
        name: log.proxyKey.name,
        requests: 0,
        totalCost: 0,
        inputTokens: 0,
        outputTokens: 0,
      };

      accumulator[log.proxyKeyId].requests += 1;
      accumulator[log.proxyKeyId].totalCost = Number(
        (accumulator[log.proxyKeyId].totalCost + Number(log.totalCost)).toFixed(
          8,
        ),
      );
      accumulator[log.proxyKeyId].inputTokens += log.inputTokens;
      accumulator[log.proxyKeyId].outputTokens += log.outputTokens;
      return accumulator;
    }, {}),
  ) as Array<{
    keyId: string;
    name: string;
    requests: number;
    totalCost: number;
    inputTokens: number;
    outputTokens: number;
  }>;
  byKey.sort((left, right) => right.totalCost - left.totalCost);

  const byModel = Object.values(
    requestLogs.reduce<
      Record<string, {
        modelId: string;
        name: string;
        requests: number;
        totalCost: number;
        inputTokens: number;
        outputTokens: number;
      }>
    >((
      accumulator: Record<string, {
        modelId: string;
        name: string;
        requests: number;
        totalCost: number;
        inputTokens: number;
        outputTokens: number;
      }>,
      log: UsageSummaryLog,
    ) => {
      const effectiveModelId = log.proxyModelId || log.simModelId;
      const effectiveModelName = log.proxyModel?.displayName ||
        log.simModel?.displayName || null;

      if (!effectiveModelId || !effectiveModelName) {
        return accumulator;
      }

      accumulator[effectiveModelId] ||= {
        modelId: effectiveModelId,
        name: effectiveModelName,
        requests: 0,
        totalCost: 0,
        inputTokens: 0,
        outputTokens: 0,
      };

      accumulator[effectiveModelId].requests += 1;
      accumulator[effectiveModelId].totalCost = Number(
        (accumulator[effectiveModelId].totalCost + Number(log.totalCost))
          .toFixed(8),
      );
      accumulator[effectiveModelId].inputTokens += log.inputTokens;
      accumulator[effectiveModelId].outputTokens += log.outputTokens;
      return accumulator;
    }, {}),
  ) as Array<{
    modelId: string;
    name: string;
    requests: number;
    totalCost: number;
    inputTokens: number;
    outputTokens: number;
  }>;
  byModel.sort((left, right) => right.totalCost - left.totalCost);

  const daily = Object.values(
    requestLogs.reduce<
      Record<string, {
        day: string;
        requests: number;
        totalCost: number;
      }>
    >((
      accumulator: Record<string, {
        day: string;
        requests: number;
        totalCost: number;
      }>,
      log: UsageSummaryLog,
    ) => {
      const day = log.createdAt.toISOString().slice(0, 10);
      accumulator[day] ||= {
        day,
        requests: 0,
        totalCost: 0,
      };
      accumulator[day].requests += 1;
      accumulator[day].totalCost = Number(
        (accumulator[day].totalCost + Number(log.totalCost)).toFixed(8),
      );
      return accumulator;
    }, {}),
  ) as Array<{
    day: string;
    requests: number;
    totalCost: number;
  }>;
  daily.sort((left, right) => left.day.localeCompare(right.day));

  const originalModelIds = Array.from(
    new Set(
      recentLogs.flatMap((log) =>
        log.originalModelId ? [log.originalModelId] : []
      ),
    ),
  );
  const originalModels = originalModelIds.length > 0
    ? await db.proxyModel.findMany({
      where: {
        id: {
          in: originalModelIds,
        },
      },
      select: {
        id: true,
        displayName: true,
      },
    })
    : [];
  const originalModelNameById = new Map(
    originalModels.map((model) => [model.id, model.displayName]),
  );

  return {
    totals,
    byKey,
    byModel,
    daily,
    recent: recentLogs.map((log) => ({
      id: log.id,
      requestType: log.requestType,
      success: log.success,
      statusCode: log.statusCode,
      inputTokens: log.inputTokens,
      cachedInputTokens: log.cachedInputTokens,
      outputTokens: log.outputTokens,
      totalCost: Number(log.totalCost),
      errorMessage: log.errorMessage,
      createdAt: log.createdAt,
      keyName: log.proxyKey?.name || null,
      modelName: log.proxyModel?.displayName || log.simModel?.displayName ||
        null,
      requestPayload: log.requestPayload,
      responsePayload: log.responsePayload,
      durationMs: log.durationMs,
      // Fallback/retry tracking
      isFallback: log.isFallback,
      isStickyFallback: log.isStickyFallback,
      originalModelName: log.originalModelId
        ? originalModelNameById.get(log.originalModelId) || null
        : null,
      fallbackChain: log.fallbackChain || [],
      retryCount: log.retryCount || 0,
      isRetryAttempt: log.isRetryAttempt || false,
    })),
    recentPagination: {
      page: currentRecentPage,
      pageSize: recentPageSize,
      totalItems: totalRecentItems,
      totalPages: totalRecentPages,
    },
  };
}

function parseCustomParams(raw: unknown): PrismaTypes.InputJsonValue {
  if (!raw) {
    return {};
  }

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) {
      return {};
    }
    return JSON.parse(trimmed) as PrismaTypes.InputJsonValue;
  }

  if (typeof raw === "object") {
    return raw as PrismaTypes.InputJsonValue;
  }

  throw new Error("Custom params must be an object or valid JSON");
}

export const api = new Hono<{
  Variables: {
    proxyKeyId: string;
  };
}>();

api.get("/health", (c) => c.json({ status: "ok" }));

api.get("/api/setup/status", async (c) => {
  const adminCount = await db.adminUser.count();
  return c.json({
    needsSetup: adminCount === 0,
  });
});

api.post("/api/setup", async (c) => {
  const adminCount = await db.adminUser.count();
  if (adminCount > 0) {
    return c.json({ error: "Setup has already been completed" }, 409);
  }

  const parsed = credentialsSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const { hash, salt } = await hashPassword(parsed.data.password);
  const admin = await db.adminUser.create({
    data: {
      username: parsed.data.username,
      passwordHash: hash,
      passwordSalt: salt,
    },
  });

  const session = await generateSessionToken();
  await db.adminSession.create({
    data: {
      adminUserId: admin.id,
      tokenHash: session.tokenHash,
      expiresAt: new Date(Date.now() + config.sessionTtlHours * 60 * 60 * 1000),
    },
  });

  c.header(
    "set-cookie",
    buildSessionCookie(session.token, config.sessionTtlHours * 60 * 60),
  );
  return c.json({
    admin: {
      id: admin.id,
      username: admin.username,
    },
  });
});

api.post("/api/admin/login", async (c) => {
  const parsed = credentialsSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const admin = await db.adminUser.findUnique({
    where: { username: parsed.data.username },
  });
  if (!admin) {
    return c.json({ error: "Invalid credentials" }, 401);
  }

  const validPassword = await verifyPassword(
    parsed.data.password,
    admin.passwordHash,
    admin.passwordSalt,
  );
  if (!validPassword) {
    return c.json({ error: "Invalid credentials" }, 401);
  }

  const session = await generateSessionToken();
  await db.adminSession.create({
    data: {
      adminUserId: admin.id,
      tokenHash: session.tokenHash,
      expiresAt: new Date(Date.now() + config.sessionTtlHours * 60 * 60 * 1000),
    },
  });

  c.header(
    "set-cookie",
    buildSessionCookie(session.token, config.sessionTtlHours * 60 * 60),
  );
  return c.json({
    admin: {
      id: admin.id,
      username: admin.username,
    },
  });
});

api.post("/api/admin/logout", async (c) => {
  const cookies = parseCookieHeader(c.req.header("cookie"));
  const sessionToken = cookies[config.sessionCookieName];
  if (sessionToken) {
    const tokenHash = await sha256Hex(sessionToken);
    await db.adminSession.deleteMany({
      where: { tokenHash },
    });
  }
  c.header("set-cookie", buildExpiredSessionCookie());
  return c.json({ ok: true });
});

api.use("/api/admin/*", async (c, next) => {
  const admin = await getAdminFromRequest(c.req.raw);
  if (!admin) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  await next();
});

api.get("/api/admin/me", async (c) => {
  const admin = await getAdminFromRequest(c.req.raw);
  return c.json({
    admin: admin
      ? {
        id: admin.id,
        username: admin.username,
      }
      : null,
  });
});

api.get("/api/admin/proxy-keys", async (c) => {
  const keys = await db.proxyKey.findMany({
    orderBy: { createdAt: "desc" },
  });
  return c.json({
    items: keys.map(toAdminProxyKeyJson),
  });
});

api.post("/api/admin/proxy-keys", async (c) => {
  const parsed = proxyKeyCreateSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const secret = await generateProxyKeySecret();
  const created = await db.proxyKey.create({
    data: {
      name: parsed.data.name,
      isActive: parsed.data.isActive,
      keyHash: secret.keyHash,
      prefix: secret.prefix,
      lastFour: secret.lastFour,
    },
  });

  return c.json({
    item: toAdminProxyKeyJson(created),
    plainTextKey: secret.plainText,
  });
});

api.patch("/api/admin/proxy-keys/:id", async (c) => {
  const parsed = proxyKeyUpdateSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const updated = await db.proxyKey.update({
    where: { id: c.req.param("id") },
    data: parsed.data,
  });
  return c.json({
    item: toAdminProxyKeyJson(updated),
  });
});

api.post("/api/admin/proxy-keys/:id/rotate", async (c) => {
  const secret = await generateProxyKeySecret();
  const updated = await db.proxyKey.update({
    where: { id: c.req.param("id") },
    data: {
      keyHash: secret.keyHash,
      prefix: secret.prefix,
      lastFour: secret.lastFour,
    },
  });
  return c.json({
    item: toAdminProxyKeyJson(updated),
    plainTextKey: secret.plainText,
  });
});

api.delete("/api/admin/proxy-keys/:id", async (c) => {
  await db.proxyKey.delete({
    where: { id: c.req.param("id") },
  });
  return c.json({ ok: true });
});

api.get("/api/admin/providers", async (c) => {
  const providers = await db.provider.findMany({
    include: {
      _count: {
        select: {
          proxyModels: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  return c.json({
    items: providers.map(toAdminProviderJson),
  });
});

api.post("/api/admin/providers", async (c) => {
  const parsed = providerSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  try {
    const created = await persistProviderInput(db, parsed.data);
    return c.json({
      item: toAdminProviderJson(created),
    });
  } catch (error) {
    return c.json(
      {
        error: error instanceof Error
          ? error.message
          : "Unable to create provider",
      },
      400,
    );
  }
});

api.patch("/api/admin/providers/:id", async (c) => {
  const parsed = providerSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  try {
    const updated = await persistProviderInput(
      db,
      parsed.data,
      c.req.param("id"),
    );
    return c.json({
      item: toAdminProviderJson(updated),
    });
  } catch (error) {
    return c.json(
      {
        error: error instanceof Error
          ? error.message
          : "Unable to update provider",
      },
      400,
    );
  }
});

api.delete("/api/admin/providers/:id", async (c) => {
  const providerId = c.req.param("id");
  const modelCount = await db.proxyModel.count({
    where: { providerId },
  });

  if (modelCount > 0) {
    return c.json(
      {
        error: `Provider is still used by ${modelCount} model${
          modelCount === 1 ? "" : "s"
        }`,
      },
      400,
    );
  }

  await db.provider.delete({
    where: { id: providerId },
  });
  return c.json({ ok: true });
});

api.get("/api/admin/providers/:id/api-key", async (c) => {
  const provider = await db.provider.findUnique({
    where: { id: c.req.param("id") },
  });

  if (!provider) {
    return c.json({ error: "Provider not found" }, 404);
  }

  if (!provider.apiKeyEncrypted) {
    return c.json({ key: null });
  }

  try {
    const key = await decryptSecret(provider.apiKeyEncrypted);
    return c.json({ key });
  } catch {
    return c.json({ error: "Failed to decrypt key" }, 500);
  }
});

api.post("/api/admin/providers/:id/models", async (c) => {
  const provider = await db.provider.findUnique({
    where: { id: c.req.param("id") },
  });

  if (!provider) {
    return c.json({ error: "Provider not found" }, 404);
  }

  const apiKey = provider.apiKeyEncrypted
    ? await decryptSecret(provider.apiKeyEncrypted)
    : "";

  if (!apiKey) {
    return c.json({ error: "Provider API key is not configured" }, 400);
  }

  const models = await fetchProviderModels(provider.baseUrl, apiKey);
  return c.json({ items: models });
});

api.get("/api/admin/models", async (c) => {
  const models = await db.proxyModel.findMany({
    include: {
      provider: {
        select: {
          name: true,
        },
      },
      fallbackModel: {
        select: {
          displayName: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  return c.json({
    items: models.map(toAdminProxyModelJson),
  });
});

api.post("/api/admin/models/provider-models", async (c) => {
  const parsed = providerModelsSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const models = await fetchProviderModels(
    parsed.data.providerBaseUrl,
    parsed.data.apiKey,
  );
  return c.json({ items: models });
});

api.post("/api/admin/models", async (c) => {
  const body = await c.req.json();
  const parsed = modelSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  try {
    const created = await persistModelInput(db, {
      ...parsed.data,
      customParams: parseCustomParams(parsed.data.customParams),
    });
    return c.json({
      item: toAdminProxyModelJson(created),
    });
  } catch (error) {
    return c.json(
      {
        error: error instanceof Error
          ? error.message
          : "Unable to create model",
      },
      400,
    );
  }
});

api.patch("/api/admin/models/:id", async (c) => {
  const body = await c.req.json();
  const parsed = modelSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  try {
    const updated = await persistModelInput(
      db,
      {
        ...parsed.data,
        customParams: parseCustomParams(parsed.data.customParams),
      },
      c.req.param("id"),
    );
    return c.json({
      item: toAdminProxyModelJson(updated),
    });
  } catch (error) {
    return c.json(
      {
        error: error instanceof Error
          ? error.message
          : "Unable to update model",
      },
      400,
    );
  }
});

api.delete("/api/admin/models/:id", async (c) => {
  await db.proxyModel.delete({
    where: { id: c.req.param("id") },
  });
  return c.json({ ok: true });
});

// SimModels CRUD
api.get("/api/admin/sim-models", async (c) => {
  const simModels = await (db as unknown as {
    simModel: { findMany: (args: unknown) => Promise<unknown[]> };
  }).simModel.findMany({
    orderBy: { createdAt: "desc" },
  });
  return c.json({
    items: (simModels as unknown[]).map((model) =>
      toAdminSimModelJson(
        model as {
          id: string;
          displayName: string;
          description: string | null;
          isActive: boolean;
          exposeInModels: boolean;
          segments: unknown;
          createdAt: Date;
          updatedAt: Date;
        },
      )
    ),
  });
});

api.post("/api/admin/sim-models", async (c) => {
  const parsed = simModelSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  try {
    const created = await (db as unknown as {
      simModel: { create: (args: unknown) => Promise<unknown> };
    }).simModel.create({
      data: parsed.data,
    });
    return c.json({
      item: toAdminSimModelJson(
        created as {
          id: string;
          displayName: string;
          description: string | null;
          isActive: boolean;
          exposeInModels: boolean;
          segments: unknown;
          createdAt: Date;
          updatedAt: Date;
        },
      ),
    });
  } catch (error) {
    return c.json(
      {
        error: error instanceof Error
          ? error.message
          : "Unable to create simulation model",
      },
      400,
    );
  }
});

api.patch("/api/admin/sim-models/:id", async (c) => {
  const parsed = simModelSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  try {
    const updated = await (db as unknown as {
      simModel: { update: (args: unknown) => Promise<unknown> };
    }).simModel.update({
      where: { id: c.req.param("id") },
      data: parsed.data,
    });
    return c.json({
      item: toAdminSimModelJson(
        updated as {
          id: string;
          displayName: string;
          description: string | null;
          isActive: boolean;
          exposeInModels: boolean;
          segments: unknown;
          createdAt: Date;
          updatedAt: Date;
        },
      ),
    });
  } catch (error) {
    return c.json(
      {
        error: error instanceof Error
          ? error.message
          : "Unable to update simulation model",
      },
      400,
    );
  }
});

api.delete("/api/admin/sim-models/:id", async (c) => {
  await (db as unknown as {
    simModel: { delete: (args: unknown) => Promise<unknown> };
  }).simModel.delete({
    where: { id: c.req.param("id") },
  });
  return c.json({ ok: true });
});

api.get("/api/admin/models/:id/provider-key", async (c) => {
  const model = await db.proxyModel.findUnique({
    where: { id: c.req.param("id") },
  });

  if (!model) {
    return c.json({ error: "Model not found" }, 404);
  }

  if (!model.providerApiKeyEncrypted) {
    return c.json({ key: null });
  }

  try {
    const key = await decryptSecret(model.providerApiKeyEncrypted);
    return c.json({ key });
  } catch {
    return c.json({ error: "Failed to decrypt key" }, 500);
  }
});

api.get("/api/admin/settings/logging", async (c) => {
  return c.json(await getLoggingSettings(db));
});

api.put("/api/admin/settings/logging", async (c) => {
  const parsed = loggingSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  return c.json(await saveLoggingSettings(db, parsed.data));
});

api.get("/api/admin/settings/ocr", async (c) => {
  return c.json(await getAdminOcrSettings(db));
});

api.put("/api/admin/settings/ocr", async (c) => {
  const parsed = ocrSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  return c.json(await saveOcrSettings(db, parsed.data));
});

api.get("/api/admin/settings/refresh", async (c) => {
  return c.json(await getRefreshSettings(db));
});

api.put("/api/admin/settings/refresh", async (c) => {
  const parsed = refreshSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  return c.json(await saveRefreshSettings(db, parsed.data));
});

api.get("/api/admin/migration/export", async (c) => {
  const includeUsageHistory = c.req.query("includeUsageHistory") === "true";
  const snapshot = await createMigrationSnapshot(db, includeUsageHistory);
  const exportedAt = snapshot.exportedAt.replaceAll(':', '-');
  c.header("content-type", "application/json; charset=utf-8");
  c.header(
    "content-disposition",
    `attachment; filename="pulpo-migration-${exportedAt}.json"`,
  );
  return c.body(`${JSON.stringify(snapshot, null, 2)}\n`);
});

api.post("/api/admin/migration/import", async (c) => {
  const parsed = migrationImportSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  try {
    return c.json(
      await importMigrationSnapshot(
        db,
        parsed.data.backup,
        parsed.data.includeUsageHistory,
      ),
    );
  } catch (error) {
    return c.json(
      {
        error: error instanceof Error
          ? error.message
          : "Unable to import migration backup",
      },
      400,
    );
  }
});

api.get("/api/admin/usage/summary", async (c) => {
  const days = Number.parseInt(c.req.query("days") || "30", 10);
  const page = Number.parseInt(c.req.query("page") || "1", 10);
  const pageSize = Number.parseInt(c.req.query("pageSize") || "50", 10);
  const normalizedDays = Number.isFinite(days) ? days : 30;
  const normalizedPage = Number.isFinite(page) && page > 0 ? page : 1;
  const normalizedPageSize = Number.isFinite(pageSize)
    ? Math.min(Math.max(pageSize, 10), 200)
    : 50;
  return c.json(
    await summarizeUsage(
      normalizedDays,
      normalizedPage,
      normalizedPageSize,
    ),
  );
});

api.post("/api/admin/playground/chat", async (c) => {
  const body = await c.req.json();
  const parsed = proxyChatSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const model = await db.proxyModel.findUnique({
    where: { id: parsed.data.model },
  });

  if (!model || !model.isActive) {
    return c.json({ error: "Selected model is unavailable" }, 404);
  }

  return forwardChatCompletion(db, {
    body: {
      ...body,
      model: model.displayName,
    },
    model,
    proxyKeyId: null,
    requestType: "playground",
  });
});

async function authenticateProxyKey(headerValue?: string | null) {
  if (!headerValue?.startsWith("Bearer ")) {
    return null;
  }

  const secret = headerValue.slice(7).trim();
  if (!secret) {
    return null;
  }

  const keyHash = await sha256Hex(secret);
  const proxyKey = await db.proxyKey.findUnique({
    where: { keyHash },
  });

  if (!proxyKey || !proxyKey.isActive) {
    return null;
  }

  await db.proxyKey.update({
    where: { id: proxyKey.id },
    data: {
      lastUsedAt: new Date(),
    },
  });

  return proxyKey;
}

api.use("/v1/*", async (c, next) => {
  const proxyKey = await authenticateProxyKey(c.req.header("authorization"));
  if (!proxyKey) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  c.set("proxyKeyId", proxyKey.id);
  await next();
});

api.get("/v1/models", async (c) => {
  const [models, simModels] = await Promise.all([
    db.proxyModel.findMany({
      where: { isActive: true },
      orderBy: { displayName: "asc" },
    }),
    (db as unknown as {
      simModel: { findMany: (args: unknown) => Promise<unknown[]> };
    }).simModel.findMany({
      where: { isActive: true, exposeInModels: true },
      orderBy: { displayName: "asc" },
    }),
  ]);

  const allModels = [
    ...models.map((model: (typeof models)[number]) => ({
      id: model.displayName,
      object: "model" as const,
      created: Math.floor(model.createdAt.getTime() / 1000),
      owned_by: "proxy",
    })),
    ...(simModels as unknown[]).map((model: unknown) => {
      const m = model as { displayName: string; createdAt: Date };
      return {
        id: m.displayName,
        object: "model" as const,
        created: Math.floor(m.createdAt.getTime() / 1000),
        owned_by: "simulation",
      };
    }),
  ];

  return c.json({
    object: "list",
    data: allModels,
  });
});

api.post("/v1/chat/completions", async (c) => {
  const body = await c.req.json();
  const parsed = proxyChatSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  // Check for simulation model first
  const simModel = await (db as unknown as {
    simModel: { findFirst: (args: unknown) => Promise<unknown> };
  }).simModel.findFirst({
    where: {
      displayName: parsed.data.model,
      isActive: true,
    },
  });

  if (simModel) {
    return handleSimModelChat(
      simModel as { id: string; displayName: string; segments: unknown },
      parsed.data,
      c.get("proxyKeyId"),
    );
  }

  const model = await db.proxyModel.findFirst({
    where: {
      displayName: parsed.data.model,
      isActive: true,
    },
  });

  if (!model) {
    return c.json({ error: "Unknown model" }, 404);
  }

  return forwardChatCompletion(db, {
    body,
    model,
    proxyKeyId: c.get("proxyKeyId"),
    requestType: "proxy",
  });
});

// SimModel streaming handler
type SimSegment =
  | { type: "delay"; delayMs: number }
  | {
    type: "text";
    content: string;
    ratePerSecond: number;
    unit: "char" | "token";
    maxUpdatesPerSecond: number;
  };

async function handleSimModelChat(
  simModel: { id: string; displayName: string; segments: unknown },
  request: Record<string, unknown>,
  _proxyKeyId: string | null,
): Promise<Response> {
  const segments = simModel.segments as SimSegment[];
  const shouldStream = Boolean(request.stream);
  const requestId = crypto.randomUUID();
  const created = Math.floor(Date.now() / 1000);
  const completionTokens = getSimCompletionTokenCount(segments);
  const requestStart = Date.now();
  const logging = await getLoggingSettings(db);

  if (!shouldStream) {
    const fullContent = segments
      .filter((s) => s.type === "text")
      .map((s) => (s as { content: string }).content)
      .join("");

    await recordSimUsageLog({
      requestId,
      proxyKeyId: _proxyKeyId,
      simModelId: simModel.id,
      requestPayload: logging.logPayloads ? request : null,
      responsePayload: logging.logPayloads
        ? ({
          usage: {
            prompt_tokens: 0,
            completion_tokens: completionTokens,
            total_tokens: completionTokens,
          },
          assistantText: fullContent,
        } as Record<string, unknown>)
        : ({
          usage: {
            prompt_tokens: 0,
            completion_tokens: completionTokens,
            total_tokens: completionTokens,
          },
        } as Record<string, unknown>),
      success: true,
      statusCode: 200,
      outputTokens: completionTokens,
      durationMs: Date.now() - requestStart,
    });

    return Response.json({
      id: `sim-${requestId}`,
      object: "chat.completion",
      created,
      model: simModel.displayName,
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: fullContent,
        },
        finish_reason: "stop",
      }],
      usage: {
        prompt_tokens: 0,
        completion_tokens: completionTokens,
        total_tokens: completionTokens,
      },
    });
  }

  const includeUsage = Boolean(
    bodyHasIncludeUsage(request),
  );

  // Streaming: process segments with delays and throttling
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();

      controller.enqueue(
        encoder.encode(
          buildSimChunk({
            requestId,
            created,
            model: simModel.displayName,
            delta: { role: "assistant" },
            finishReason: null,
          }),
        ),
      );

      for (const segment of segments) {
        if (segment.type === "delay") {
          await new Promise((resolve) => setTimeout(resolve, segment.delayMs));
          continue;
        }

        if (segment.unit === "token") {
          await streamSimTokens(controller, encoder, {
            content: segment.content,
            ratePerSecond: segment.ratePerSecond,
            maxUpdatesPerSecond: segment.maxUpdatesPerSecond ?? 10,
            requestId,
            created,
            model: simModel.displayName,
          });
        } else {
          await streamSimCharacters(controller, encoder, {
            content: segment.content,
            ratePerSecond: segment.ratePerSecond,
            maxUpdatesPerSecond: segment.maxUpdatesPerSecond ?? 10,
            requestId,
            created,
            model: simModel.displayName,
          });
        }
      }

      if (includeUsage) {
        controller.enqueue(
          encoder.encode(
            buildSimChunk({
              requestId,
              created,
              model: simModel.displayName,
              finishReason: null,
              usage: {
                prompt_tokens: 0,
                completion_tokens: completionTokens,
                total_tokens: completionTokens,
              },
            }),
          ),
        );
      }

      controller.enqueue(
        encoder.encode(
          buildSimChunk({
            requestId,
            created,
            model: simModel.displayName,
            finishReason: "stop",
          }),
        ),
      );
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));

      await recordSimUsageLog({
        requestId,
        proxyKeyId: _proxyKeyId,
        simModelId: simModel.id,
        requestPayload: logging.logPayloads ? request : null,
        responsePayload: logging.logPayloads
          ? ({
            usage: {
              prompt_tokens: 0,
              completion_tokens: completionTokens,
              total_tokens: completionTokens,
            },
            assistantText: segments
              .filter((segment) => segment.type === "text")
              .map((segment) => segment.content)
              .join(""),
          } as Record<string, unknown>)
          : ({
            usage: {
              prompt_tokens: 0,
              completion_tokens: completionTokens,
              total_tokens: completionTokens,
            },
          } as Record<string, unknown>),
        success: true,
        statusCode: 200,
        outputTokens: completionTokens,
        durationMs: Date.now() - requestStart,
      });

      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

function bodyHasIncludeUsage(body: Record<string, unknown>): boolean {
  const streamOptions = body.stream_options;
  if (!streamOptions || typeof streamOptions !== "object") {
    return false;
  }

  return Boolean((streamOptions as Record<string, unknown>).include_usage);
}
