import prismaPackage from "@prisma/client";
import type { PrismaClient as PrismaClientType } from "@prisma/client";

const { PrismaClient } = prismaPackage;

const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClientType;
};

export const db = globalForPrisma.prisma ??
  new PrismaClient({
    log: ["warn", "error"],
  });

if (Deno.env.get("DENO_ENV") !== "production") {
  globalForPrisma.prisma = db;
}
