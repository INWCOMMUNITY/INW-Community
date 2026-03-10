import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { Pool } from "@neondatabase/serverless";

declare global {
  var prisma: PrismaClient | undefined;
}

const isNeon =
  typeof process.env.DATABASE_URL === "string" &&
  process.env.DATABASE_URL.includes("neon.tech");

const isDev = process.env.NODE_ENV === "development";

const logOpt: ("query" | "error" | "warn")[] = isDev
  ? ["query", "error", "warn"]
  : ["error"];

const prismaClient = (() => {
  if (globalThis.prisma) return globalThis.prisma;

  const baseLog =
    isDev
      ? (["query", "error", "warn"] as const)
      : ([
          { emit: "event" as const, level: "error" as const },
        ] as const);

  const options = isDev
    ? { log: logOpt }
    : {
        log: baseLog,
      };

  let client: PrismaClient;
  if (isNeon && process.env.DATABASE_URL) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const adapter = new PrismaNeon(pool);
    client = new PrismaClient({ adapter, ...options } as any);
  } else {
    client = new PrismaClient(options as any);
  }

  const firstLog = baseLog[0];
  if (!isDev && Array.isArray(baseLog) && typeof firstLog === "object" && firstLog !== null && "emit" in firstLog && firstLog.emit === "event") {
    (client as any).$on("error", (e: unknown) => {
      let msg = "Prisma error (no details)";
      if (e != null && typeof e === "object" && "message" in e) {
        const m = (e as { message: unknown }).message;
        if (m != null && String(m).trim() !== "") msg = String(m);
      } else if (e != null && typeof e !== "object") {
        const s = String(e);
        if (s !== "undefined") msg = s;
      }
      console.error("[prisma:error]", msg);
    });
  }

  return client;
})();

export const prisma = prismaClient;
if (process.env.NODE_ENV !== "production") globalThis.prisma = prisma;

export * from "@prisma/client";
