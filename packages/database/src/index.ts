import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { Pool } from "@neondatabase/serverless";

declare global {
  var prisma: PrismaClient | undefined;
}

const isNeon =
  typeof process.env.DATABASE_URL === "string" &&
  process.env.DATABASE_URL.includes("neon.tech");

const logOpt: ("query" | "error" | "warn")[] =
  process.env.NODE_ENV === "development"
    ? ["query", "error", "warn"]
    : ["error"];

const prismaClient = (() => {
  if (globalThis.prisma) return globalThis.prisma;

  if (isNeon && process.env.DATABASE_URL) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const adapter = new PrismaNeon(pool);
    // adapter required for Neon serverless; Prisma 5 types may not expose it
    return new PrismaClient({ adapter, log: logOpt } as any);
  }

  return new PrismaClient({ log: logOpt });
})();

export const prisma = prismaClient;
if (process.env.NODE_ENV !== "production") globalThis.prisma = prisma;

export * from "@prisma/client";
