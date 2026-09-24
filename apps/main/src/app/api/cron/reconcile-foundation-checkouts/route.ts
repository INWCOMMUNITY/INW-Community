import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import {
  CommerceFoundationCutoverStateError,
  foundationCheckoutReconciliationCronAllowed,
  getCommerceFoundationCutoverState,
  Prisma,
  prisma,
} from "database";
import { tryAcquireCronLock, releaseCronLock } from "@/lib/cron-job-lock";
import { reconcileFoundationCheckoutBatch } from "@/lib/stripe/reconcile-foundation-checkout-attempt";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LOCK_TTL_MS = 80_000;
const CUTOVER_TABLE = "commerce_foundation_cutover";
const CUTOVER_MODEL = "commercefoundationcutover";

function metaRelationName(meta: Record<string, unknown> | undefined): string | null {
  if (!meta) return null;
  for (const key of ["table", "modelName", "relation"] as const) {
    const value = meta[key];
    if (typeof value === "string" && value.trim()) {
      const last = value.replace(/"/g, "").split(".").pop();
      return last?.trim() || null;
    }
  }
  return null;
}

/** P2021 for the cutover table only. Other missing relations remain failures. */
function isMissingCommerceFoundationCutoverTable(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code !== "P2021") return false;
  const relation = metaRelationName(err.meta as Record<string, unknown> | undefined);
  if (relation) {
    const normalized = relation.toLowerCase();
    return normalized === CUTOVER_TABLE || normalized === CUTOVER_MODEL;
  }
  return new RegExp(`\\b${CUTOVER_TABLE}\\b`, "i").test(err.message);
}

function cutoverUnavailableResponse() {
  console.info("[cron/reconcile-foundation-checkouts] cutover unavailable; no-op");
  return NextResponse.json({ ok: true, skipped: "cutover_unavailable", inspected: 0, results: [] });
}

function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key?.startsWith("sk_")) return null;
  return new Stripe(key, { apiVersion: "2024-11-20.acacia" as "2023-10-16" });
}

async function run(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let mode: string | null = null;
  try {
    const cutover = await getCommerceFoundationCutoverState(prisma);
    mode = cutover.mode;
  } catch (err) {
    if (err instanceof CommerceFoundationCutoverStateError || isMissingCommerceFoundationCutoverTable(err)) {
      return cutoverUnavailableResponse();
    }
    throw err;
  }

  if (!foundationCheckoutReconciliationCronAllowed(mode)) {
    console.info("[cron/reconcile-foundation-checkouts] skipped", { mode });
    return NextResponse.json({ ok: true, skipped: `mode_${mode}`, mode, inspected: 0, results: [] });
  }

  const stripe = stripeClient();
  if (!stripe) {
    return NextResponse.json({ error: "Stripe is not configured" }, { status: 500 });
  }

  const lock = await tryAcquireCronLock("reconcile-foundation-checkouts", LOCK_TTL_MS);
  if (!lock.acquired) {
    return NextResponse.json({ ok: true, skipped: "lease_held" });
  }

  const started = Date.now();
  try {
    const batch = await reconcileFoundationCheckoutBatch({ prisma, stripe, mode });
    console.info("[cron/reconcile-foundation-checkouts]", {
      mode,
      inspected: batch.inspected,
      results: batch.results,
      durationMs: Date.now() - started,
    });
    return NextResponse.json({
      ok: true,
      mode,
      skipped: batch.skipped,
      inspected: batch.inspected,
      results: batch.results,
    });
  } catch (e) {
    console.error("[cron/reconcile-foundation-checkouts] error:", e);
    return NextResponse.json({ error: "Reconcile failed" }, { status: 500 });
  } finally {
    await releaseCronLock("reconcile-foundation-checkouts", lock.holderId, { durationMs: Date.now() - started });
  }
}

export async function POST(req: NextRequest) {
  return run(req);
}

export async function GET(req: NextRequest) {
  return run(req);
}
