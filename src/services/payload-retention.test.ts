import { assertEquals } from 'jsr:@std/assert@^1.0.14';
import prismaPackage from 'npm:@prisma/client';
import type { PrismaClient } from 'npm:@prisma/client';
import {
  clearExpiredDetailedPayloads,
  getPayloadRetentionCutoff,
} from './payload-retention.ts';

const { Prisma } = prismaPackage;

function createPrismaStub(payloadRetention: '1_hour' | '24_hours' | '7_days' | '30_days' | '90_days' | 'indefinite') {
  let updateManyCalls = 0;
  let lastUpdateArgs: unknown = null;

  const prisma = {
    appSetting: {
      findUnique: async () => ({
        value: {
          logPayloads: true,
          payloadRetention,
        },
      }),
    },
    usageLog: {
      updateMany: async (args: unknown) => {
        updateManyCalls += 1;
        lastUpdateArgs = args;
        return { count: 3 };
      },
    },
  } as unknown as PrismaClient;

  return {
    prisma,
    getUpdateManyCalls: () => updateManyCalls,
    getLastUpdateArgs: () => lastUpdateArgs,
  };
}

Deno.test('getPayloadRetentionCutoff returns null for indefinite retention', () => {
  const now = new Date('2026-04-21T12:00:00.000Z');

  assertEquals(getPayloadRetentionCutoff('indefinite', now), null);
});

Deno.test('getPayloadRetentionCutoff subtracts the selected retention window', () => {
  const now = new Date('2026-04-21T12:00:00.000Z');

  assertEquals(
    getPayloadRetentionCutoff('24_hours', now)?.toISOString(),
    '2026-04-20T12:00:00.000Z',
  );
  assertEquals(
    getPayloadRetentionCutoff('7_days', now)?.toISOString(),
    '2026-04-14T12:00:00.000Z',
  );
});

Deno.test('clearExpiredDetailedPayloads clears payloads older than the configured cutoff', async () => {
  const now = new Date('2026-04-21T12:00:00.000Z');
  const { prisma, getUpdateManyCalls, getLastUpdateArgs } = createPrismaStub('1_hour');

  const clearedCount = await clearExpiredDetailedPayloads(prisma, now);

  assertEquals(clearedCount, 3);
  assertEquals(getUpdateManyCalls(), 1);
  assertEquals(getLastUpdateArgs(), {
    where: {
      createdAt: { lt: new Date('2026-04-21T11:00:00.000Z') },
      OR: [
        { requestPayload: { not: Prisma.AnyNull } },
        { responsePayload: { not: Prisma.AnyNull } },
      ],
    },
    data: {
      requestPayload: Prisma.JsonNull,
      responsePayload: Prisma.JsonNull,
    },
  });
});

Deno.test('clearExpiredDetailedPayloads skips database updates for indefinite retention', async () => {
  const { prisma, getUpdateManyCalls } = createPrismaStub('indefinite');

  const clearedCount = await clearExpiredDetailedPayloads(prisma);

  assertEquals(clearedCount, 0);
  assertEquals(getUpdateManyCalls(), 0);
});
