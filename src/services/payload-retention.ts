import prismaPackage from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { logError, logInfo } from "../lib/logging.ts";
import {
  buildSummaryResponsePayload,
  hasDetailedPayloads,
} from "./payload-log-detail.ts";
import { getLoggingSettings, type LoggingSettings } from "./settings.ts";

const { Prisma } = prismaPackage;

const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;

const PAYLOAD_RETENTION_MS: Record<
  Exclude<LoggingSettings["payloadRetention"], "indefinite">,
  number
> = {
  "1_hour": 60 * 60 * 1000,
  "24_hours": 24 * 60 * 60 * 1000,
  "7_days": 7 * 24 * 60 * 60 * 1000,
  "30_days": 30 * 24 * 60 * 60 * 1000,
  "90_days": 90 * 24 * 60 * 60 * 1000,
};

export function getPayloadRetentionCutoff(
  retention: LoggingSettings["payloadRetention"],
  now = new Date(),
): Date | null {
  if (retention === "indefinite") {
    return null;
  }

  return new Date(now.getTime() - PAYLOAD_RETENTION_MS[retention]);
}

export async function clearExpiredDetailedPayloads(
  prisma: PrismaClient,
  now = new Date(),
): Promise<number> {
  const logging = await getLoggingSettings(prisma);
  const cutoff = getPayloadRetentionCutoff(logging.payloadRetention, now);

  if (!cutoff) {
    return 0;
  }

  const logs = await prisma.usageLog.findMany({
    where: {
      createdAt: { lt: cutoff },
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

  let clearedCount = 0;

  for (const log of logs) {
    if (!hasDetailedPayloads(log)) {
      continue;
    }

    const summarizedResponsePayload = buildSummaryResponsePayload(
      log.responsePayload,
    );
    await prisma.usageLog.update({
      where: {
        id: log.id,
      },
      data: {
        requestPayload: Prisma.JsonNull,
        responsePayload:
          (summarizedResponsePayload ?? Prisma.JsonNull) as never,
      },
    });
    clearedCount += 1;
  }

  return clearedCount;
}

export function startPayloadRetentionCleanup(prisma: PrismaClient): void {
  let cleanupRunning = false;

  const runCleanup = async () => {
    if (cleanupRunning) {
      return;
    }

    cleanupRunning = true;

    try {
      const clearedCount = await clearExpiredDetailedPayloads(prisma);
      if (clearedCount > 0) {
        logInfo("payload_retention_cleanup_cleared", { clearedCount });
      }
    } catch (error) {
      logError("payload_retention_cleanup_failed", error);
    } finally {
      cleanupRunning = false;
    }
  };

  void runCleanup();
  setInterval(() => {
    void runCleanup();
  }, CLEANUP_INTERVAL_MS);
}
