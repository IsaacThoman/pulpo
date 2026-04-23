import { assertEquals } from "@std/assert";
import prismaPackage from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import {
  clearExpiredDetailedPayloads,
  getPayloadRetentionCutoff,
} from "./payload-retention.ts";

const { Prisma } = prismaPackage;

function createPrismaStub(
  payloadRetention:
    | "1_hour"
    | "24_hours"
    | "7_days"
    | "30_days"
    | "90_days"
    | "indefinite",
) {
  let findManyCalls = 0;
  let updateCalls = 0;
  let lastFindManyArgs: unknown = null;
  const updateArgs: unknown[] = [];

  const prisma = {
    appSetting: {
      findUnique: () => ({
        value: {
          logPayloads: true,
          payloadRetention,
        },
      }),
    },
    usageLog: {
      findMany: (args: unknown) => {
        findManyCalls += 1;
        lastFindManyArgs = args;
        return [
          {
            id: "log-1",
            requestPayload: { messages: [{ role: "user", content: "secret" }] },
            responsePayload: {
              id: "chatcmpl-1",
              object: "chat.completion",
              model: "test-model",
              choices: [{
                message: { role: "assistant", content: "secret answer" },
              }],
              usage: {
                prompt_tokens: 1,
                completion_tokens: 2,
                total_tokens: 3,
              },
            },
          },
          {
            id: "log-2",
            requestPayload: null,
            responsePayload: {
              usage: {
                prompt_tokens: 1,
                completion_tokens: 2,
                total_tokens: 3,
              },
            },
          },
        ];
      },
      update: (args: unknown) => {
        updateCalls += 1;
        updateArgs.push(args);
        return args;
      },
    },
  } as unknown as PrismaClient;

  return {
    prisma,
    getFindManyCalls: () => findManyCalls,
    getUpdateCalls: () => updateCalls,
    getLastFindManyArgs: () => lastFindManyArgs,
    getUpdateArgs: () => updateArgs,
  };
}

Deno.test("getPayloadRetentionCutoff returns null for indefinite retention", () => {
  const now = new Date("2026-04-21T12:00:00.000Z");

  assertEquals(getPayloadRetentionCutoff("indefinite", now), null);
});

Deno.test("getPayloadRetentionCutoff subtracts the selected retention window", () => {
  const now = new Date("2026-04-21T12:00:00.000Z");

  assertEquals(
    getPayloadRetentionCutoff("24_hours", now)?.toISOString(),
    "2026-04-20T12:00:00.000Z",
  );
  assertEquals(
    getPayloadRetentionCutoff("7_days", now)?.toISOString(),
    "2026-04-14T12:00:00.000Z",
  );
});

Deno.test("clearExpiredDetailedPayloads removes detailed payload fields older than the configured cutoff", async () => {
  const now = new Date("2026-04-21T12:00:00.000Z");
  const {
    prisma,
    getFindManyCalls,
    getUpdateCalls,
    getLastFindManyArgs,
    getUpdateArgs,
  } = createPrismaStub("1_hour");

  const clearedCount = await clearExpiredDetailedPayloads(prisma, now);

  assertEquals(clearedCount, 1);
  assertEquals(getFindManyCalls(), 1);
  assertEquals(getUpdateCalls(), 1);
  assertEquals(getLastFindManyArgs(), {
    where: {
      createdAt: { lt: new Date("2026-04-21T11:00:00.000Z") },
      OR: [
        { requestPayload: { not: Prisma.AnyNull } },
        { responsePayload: { not: Prisma.AnyNull } },
      ],
    },
    select: {
      id: true,
      requestPayload: true,
      responsePayload: true,
    },
  });
  assertEquals(getUpdateArgs(), [{
    where: {
      id: "log-1",
    },
    data: {
      requestPayload: Prisma.JsonNull,
      responsePayload: {
        id: "chatcmpl-1",
        object: "chat.completion",
        model: "test-model",
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
        choices: [],
      },
    },
  }]);
});

Deno.test("clearExpiredDetailedPayloads skips database updates for indefinite retention", async () => {
  const { prisma, getFindManyCalls, getUpdateCalls } = createPrismaStub(
    "indefinite",
  );

  const clearedCount = await clearExpiredDetailedPayloads(prisma);

  assertEquals(clearedCount, 0);
  assertEquals(getFindManyCalls(), 0);
  assertEquals(getUpdateCalls(), 0);
});
