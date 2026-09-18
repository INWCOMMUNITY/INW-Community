import { PrismaClient } from "@prisma/client";

declare global {
  var prisma: PrismaClient | undefined;
}

/**
 * Single Prisma client: **TCP** to Postgres (Neon pooled `DATABASE_URL`, Railway, Vercel Node, local).
 * We do not use `@prisma/adapter-neon` / `@neondatabase/serverless` here — that stack uses WebSockets
 * and breaks in many Node hosts (`WebSocket … undefined`, `fetch failed`).
 */
const isDev = process.env.NODE_ENV === "development";

const logOpt: ("query" | "error" | "warn")[] = isDev
  ? ["query", "error", "warn"]
  : ["error"];

function prismaHasShippingOptionCost(client: PrismaClient): boolean {
  const rdm = (
    client as {
      _runtimeDataModel?: { models?: Record<string, { fields?: Record<string, unknown> | unknown[] }> };
    }
  )._runtimeDataModel;
  const fields = rdm?.models?.ShippingOption?.fields;
  if (!fields) return false;
  if (Array.isArray(fields)) {
    return fields.some((f) => f && typeof f === "object" && (f as { name?: string }).name === "shippingCostCents");
  }
  return "shippingCostCents" in fields;
}

const prismaClient = (() => {
  const existing = globalThis.prisma;
  // After adding models/fields, a cached PrismaClient from before `prisma generate`
  // is missing delegates or columns — recreate it.
  if (
    existing &&
    typeof (existing as { shippingOption?: unknown }).shippingOption !== "undefined" &&
    typeof (existing as { listingFeedCollection?: unknown }).listingFeedCollection !== "undefined" &&
    typeof (existing as { cronJobLock?: unknown }).cronJobLock !== "undefined" &&
    typeof (existing as { storeVariant?: unknown }).storeVariant !== "undefined" &&
    typeof (existing as { inventoryState?: unknown }).inventoryState !== "undefined" &&
    typeof (existing as { inventoryEvent?: unknown }).inventoryEvent !== "undefined" &&
    typeof (existing as { checkoutAttempt?: unknown }).checkoutAttempt !== "undefined" &&
    typeof (existing as { inventoryReservation?: unknown }).inventoryReservation !== "undefined" &&
    typeof (existing as { stripeEventEvidence?: unknown }).stripeEventEvidence !== "undefined" &&
    typeof (existing as { refundOperation?: unknown }).refundOperation !== "undefined" &&
    typeof (existing as { transferOperation?: unknown }).transferOperation !== "undefined" &&
    typeof (existing as { commerceFoundationCutover?: unknown }).commerceFoundationCutover !== "undefined" &&
    prismaHasShippingOptionCost(existing)
  ) {
    return existing;
  }
  if (existing) {
    void existing.$disconnect().catch(() => {});
  }

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

  const client = new PrismaClient(options as any);

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
if (process.env.NODE_ENV !== "production") globalThis.prisma = prismaClient;

export * from "@prisma/client";
export {
  closeOrDeleteMemberAccount,
  durableCommerceFinancialNone,
} from "./member-account-lifecycle";
export type { MemberAccountLifecycleResult } from "./member-account-lifecycle";
export {
  COMMERCE_FOUNDATION_CUTOVER_SINGLETON_ID,
  CommerceFoundationCutoverBlockedError,
  CommerceFoundationCutoverStateError,
  INVENTORY_CUTOVER_FROZEN_ERROR,
  assertLegacyDrainFinalizerAllowed,
  assertLegacyInteractiveMutationAllowed,
  durableStartedAtFromUnixSeconds,
  getCommerceFoundationCutoverState,
  isCommerceFoundationCutoverBlockedError,
} from "./commerce-foundation-cutover";
export type { CommerceFoundationCutoverState, CommerceFoundationCutoverWriterClass } from "./commerce-foundation-cutover";
