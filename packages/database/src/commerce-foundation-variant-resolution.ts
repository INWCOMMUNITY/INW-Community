import type { Prisma, PrismaClient, StoreVariant } from "@prisma/client";
import { SIMPLE_FINGERPRINT } from "./foundation/backfill/types";
import { matrixFingerprint, optionFingerprint } from "./foundation/backfill/analyze";

export type FoundationDb = Prisma.TransactionClient | PrismaClient;

export class FoundationVariantResolutionError extends Error {
  readonly code = "variant_resolution_failed" as const;

  constructor(message: string) {
    super(message);
    this.name = "FoundationVariantResolutionError";
  }
}

export type ResolvedStoreVariant = Pick<
  StoreVariant,
  "id" | "memberId" | "storeItemId" | "status" | "isDefault" | "options" | "priceCents"
>;

function asOptionRecord(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const options: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const name = String(k ?? "").trim();
    const val = v != null ? String(v).trim() : "";
    if (name && val) options[name] = val;
  }
  return Object.keys(options).length > 0 ? options : null;
}

export function matrixSourceFingerprint(options: Record<string, string>): string {
  return matrixFingerprint(options);
}

export function selectionFingerprint(options: Record<string, string>): string {
  return optionFingerprint(options);
}

async function loadStoreItemKind(
  db: FoundationDb,
  storeItemId: string
): Promise<{ memberId: string; kind: "simple" | "matrix" }> {
  const item = await db.storeItem.findUnique({
    where: { id: storeItemId },
    select: { id: true, memberId: true, variants: true },
  });
  if (!item) {
    throw new FoundationVariantResolutionError(`StoreItem ${storeItemId} was not found`);
  }
  const variants = await db.storeVariant.findMany({
    where: { storeItemId },
    select: { id: true, isDefault: true, options: true },
  });
  if (variants.length === 0) {
    throw new FoundationVariantResolutionError(
      `StoreItem ${storeItemId} has no StoreVariant rows`
    );
  }
  const only = variants.length === 1 ? variants[0] : null;
  const optionKeys =
    only && only.options && typeof only.options === "object" && !Array.isArray(only.options)
      ? Object.keys(only.options as object)
      : [];
  const kind = only && only.isDefault && optionKeys.length === 0 ? "simple" : "matrix";
  return { memberId: item.memberId, kind };
}

export async function resolveSimpleDefaultVariant(
  db: FoundationDb,
  storeItemId: string,
  opts?: { requireActive?: boolean }
): Promise<ResolvedStoreVariant> {
  const defaults = await db.storeVariant.findMany({
    where: { storeItemId, isDefault: true },
  });
  if (defaults.length !== 1) {
    throw new FoundationVariantResolutionError(
      `StoreItem ${storeItemId} must have exactly one default Variant (found ${defaults.length})`
    );
  }
  const variant = defaults[0];
  if (variant.storeItemId !== storeItemId) {
    throw new FoundationVariantResolutionError("Default Variant does not belong to the StoreItem");
  }
  if (opts?.requireActive && variant.status !== "ACTIVE") {
    throw new FoundationVariantResolutionError("Default Variant is not ACTIVE");
  }
  return variant;
}

export async function resolveMatrixVariant(
  db: FoundationDb,
  storeItemId: string,
  input: { variantId?: string | null; optionJson?: unknown },
  opts?: { requireActive?: boolean }
): Promise<ResolvedStoreVariant> {
  if (input.variantId) {
    const variant = await db.storeVariant.findUnique({ where: { id: input.variantId } });
    if (!variant || variant.storeItemId !== storeItemId) {
      throw new FoundationVariantResolutionError("variantId does not belong to this StoreItem");
    }
    if (opts?.requireActive && variant.status !== "ACTIVE") {
      throw new FoundationVariantResolutionError("Variant is not ACTIVE");
    }
    return variant;
  }

  const options = asOptionRecord(input.optionJson);
  if (!options) {
    throw new FoundationVariantResolutionError("MATRIX selection requires variantId or option JSON");
  }
  const fingerprint = matrixSourceFingerprint(options);
  const map = await db.variantBackfillMap.findUnique({
    where: { storeItemId_sourceFingerprint: { storeItemId, sourceFingerprint: fingerprint } },
  });
  let variantId = map?.variantId ?? null;
  if (!variantId) {
    const variants = await db.storeVariant.findMany({ where: { storeItemId } });
    const matches = variants.filter((v) => {
      const rec = asOptionRecord(v.options);
      return rec != null && matrixSourceFingerprint(rec) === fingerprint;
    });
    if (matches.length !== 1) {
      throw new FoundationVariantResolutionError(
        matches.length === 0
          ? `No VariantBackfillMap or native Variant for fingerprint ${fingerprint}`
          : `Ambiguous native Variant match for fingerprint ${fingerprint}`
      );
    }
    variantId = matches[0].id;
  }
  const variant = await db.storeVariant.findUnique({ where: { id: variantId } });
  if (!variant || variant.storeItemId !== storeItemId) {
    throw new FoundationVariantResolutionError("Mapped Variant does not belong to this StoreItem");
  }
  if (opts?.requireActive && variant.status !== "ACTIVE") {
    throw new FoundationVariantResolutionError("Mapped Variant is not ACTIVE");
  }
  return variant;
}

/**
 * Resolve a checkout/cart line to a StoreVariant.
 * SIMPLE: explicit variantId or the single default.
 * MATRIX: explicit variantId, else option JSON through VariantBackfillMap.
 */
export async function resolveCheckoutVariant(
  db: FoundationDb,
  storeItemId: string,
  input: { variantId?: string | null; optionJson?: unknown },
  opts?: { requireActive?: boolean }
): Promise<ResolvedStoreVariant> {
  const meta = await loadStoreItemKind(db, storeItemId);
  if (input.variantId) {
    const variant = await db.storeVariant.findUnique({ where: { id: input.variantId } });
    if (!variant || variant.storeItemId !== storeItemId) {
      throw new FoundationVariantResolutionError("variantId does not belong to this StoreItem");
    }
    if (variant.memberId !== meta.memberId) {
      throw new FoundationVariantResolutionError("Variant member does not match StoreItem");
    }
    if (opts?.requireActive && variant.status !== "ACTIVE") {
      throw new FoundationVariantResolutionError("Variant is not ACTIVE");
    }
    return variant;
  }
  if (meta.kind === "simple") {
    return resolveSimpleDefaultVariant(db, storeItemId, opts);
  }
  return resolveMatrixVariant(db, storeItemId, { optionJson: input.optionJson }, opts);
}

export { SIMPLE_FINGERPRINT };
