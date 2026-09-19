import type { CommerceFoundationCutoverMode, Prisma, PrismaClient } from "@prisma/client";

export const COMMERCE_FOUNDATION_CUTOVER_SINGLETON_ID = "singleton";

export const COMMERCE_FOUNDATION_CUTOVER_MODES = [
  "LEGACY",
  "FROZEN",
  "BACKFILLING",
  "FOUNDATION",
  "UNFROZEN",
] as const satisfies readonly CommerceFoundationCutoverMode[];

export type CommerceFoundationCutoverWriterClass = "interactive" | "drain";

export type CommerceFoundationCutoverState = {
  id: typeof COMMERCE_FOUNDATION_CUTOVER_SINGLETON_ID;
  mode: CommerceFoundationCutoverMode;
  frozenAt: Date | null;
  backfilledAt: Date | null;
  foundationAt: Date | null;
  unfrozenAt: Date | null;
  engineSha: string | null;
  manifestHash: string | null;
  updatedAt: Date;
};

export const INVENTORY_CUTOVER_FROZEN_ERROR = "inventory_cutover_frozen" as const;

export class CommerceFoundationCutoverBlockedError extends Error {
  readonly code = INVENTORY_CUTOVER_FROZEN_ERROR;
  readonly retryable = true as const;
  readonly httpStatus = 503 as const;
  readonly mode: CommerceFoundationCutoverMode;
  readonly writerClass: CommerceFoundationCutoverWriterClass;

  constructor(opts: { mode: CommerceFoundationCutoverMode; writerClass: CommerceFoundationCutoverWriterClass }) {
    super("Commerce foundation inventory cutover is blocking this mutation");
    this.name = "CommerceFoundationCutoverBlockedError";
    this.mode = opts.mode;
    this.writerClass = opts.writerClass;
  }
}

export class CommerceFoundationCutoverStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommerceFoundationCutoverStateError";
  }
}

export class CommerceFoundationCutoverTransitionError extends Error {
  readonly from: CommerceFoundationCutoverMode;
  readonly to: CommerceFoundationCutoverMode;

  constructor(from: CommerceFoundationCutoverMode, to: CommerceFoundationCutoverMode, detail?: string) {
    super(detail ?? `Illegal commerce foundation cutover transition ${from} → ${to}`);
    this.name = "CommerceFoundationCutoverTransitionError";
    this.from = from;
    this.to = to;
  }
}

export type CommerceFoundationCutoverClient = {
  commerceFoundationCutover: {
    findUnique: PrismaClient["commerceFoundationCutover"]["findUnique"];
    update: PrismaClient["commerceFoundationCutover"]["update"];
  };
  $queryRaw: Prisma.TransactionClient["$queryRaw"];
};

export type CommerceFoundationCutoverPrisma = CommerceFoundationCutoverClient & {
  $transaction: PrismaClient["$transaction"];
};

const MODE_SET = new Set<string>(COMMERCE_FOUNDATION_CUTOVER_MODES);

function isKnownMode(mode: string): mode is CommerceFoundationCutoverMode {
  return MODE_SET.has(mode);
}

function blocked(mode: CommerceFoundationCutoverMode, writerClass: CommerceFoundationCutoverWriterClass): never {
  throw new CommerceFoundationCutoverBlockedError({ mode, writerClass });
}

/** Stripe Checkout Session / PI `created` unix seconds already present on the Stripe object. */
export function durableStartedAtFromUnixSeconds(created: number | null | undefined): Date | null {
  if (typeof created !== "number" || !Number.isFinite(created) || created <= 0) return null;
  return new Date(created * 1000);
}

export async function getCommerceFoundationCutoverState(
  db: CommerceFoundationCutoverClient
): Promise<CommerceFoundationCutoverState> {
  const row = await db.commerceFoundationCutover.findUnique({
    where: { id: COMMERCE_FOUNDATION_CUTOVER_SINGLETON_ID },
  });
  if (!row) {
    throw new CommerceFoundationCutoverStateError(
      "Commerce foundation cutover singleton is missing; refuse to assume LEGACY"
    );
  }
  if (!isKnownMode(row.mode)) {
    throw new CommerceFoundationCutoverStateError(
      "Commerce foundation cutover singleton has an unknown mode"
    );
  }
  return {
    id: COMMERCE_FOUNDATION_CUTOVER_SINGLETON_ID,
    mode: row.mode,
    frozenAt: row.frozenAt,
    backfilledAt: row.backfilledAt,
    foundationAt: row.foundationAt,
    unfrozenAt: row.unfrozenAt,
    engineSha: row.engineSha,
    manifestHash: row.manifestHash,
    updatedAt: row.updatedAt,
  };
}

export class CommerceFoundationWriterModeError extends Error {
  readonly mode: CommerceFoundationCutoverMode;

  constructor(mode: CommerceFoundationCutoverMode) {
    super(`Foundation inventory writers are not allowed in ${mode}`);
    this.name = "CommerceFoundationWriterModeError";
    this.mode = mode;
  }
}

export function isFoundationInventoryWriterMode(mode: CommerceFoundationCutoverMode): boolean {
  return mode === "FOUNDATION" || mode === "UNFROZEN";
}

/** Explicit writer routing. Never treat non-LEGACY as foundation. */
export function commerceInventoryWriterRoute(
  mode: CommerceFoundationCutoverMode
): "legacy" | "foundation" | "blocked" {
  if (mode === "LEGACY") return "legacy";
  if (isFoundationInventoryWriterMode(mode)) return "foundation";
  return "blocked";
}

/** CLASS 1: new interactive / automated listing mutations. LEGACY only. */
export async function assertLegacyInteractiveMutationAllowed(
  db: CommerceFoundationCutoverClient
): Promise<void> {
  const state = await getCommerceFoundationCutoverState(db);
  if (state.mode === "LEGACY") return;
  blocked(state.mode, "interactive");
}

/**
 * Foundation/M2 inventory writers. FOUNDATION and UNFROZEN only.
 * LEGACY is a hard integrity error (wrong writer). FROZEN/BACKFILLING are cutover blocks.
 */
export async function assertFoundationInventoryWriterAllowed(
  db: CommerceFoundationCutoverClient
): Promise<CommerceFoundationCutoverState> {
  const state = await getCommerceFoundationCutoverState(db);
  if (isFoundationInventoryWriterMode(state.mode)) return state;
  if (state.mode === "FROZEN" || state.mode === "BACKFILLING") {
    blocked(state.mode, "interactive");
  }
  throw new CommerceFoundationWriterModeError(state.mode);
}

/**
 * CLASS 2: paid-session / pending-order drain finalization.
 * LEGACY always. FROZEN only when `startedAt` is a durable timestamp strictly before `frozenAt`.
 */
export async function assertLegacyDrainFinalizerAllowed(
  db: CommerceFoundationCutoverClient,
  startedAt: Date | null | undefined
): Promise<void> {
  const state = await getCommerceFoundationCutoverState(db);
  if (state.mode === "LEGACY") return;
  if (state.mode === "FROZEN") {
    if (!state.frozenAt) blocked(state.mode, "drain");
    if (!(startedAt instanceof Date) || Number.isNaN(startedAt.getTime())) {
      blocked(state.mode, "drain");
    }
    if (startedAt.getTime() < state.frozenAt.getTime()) return;
    blocked(state.mode, "drain");
  }
  blocked(state.mode, "drain");
}

export type CommerceFoundationCutoverTransitionInput = {
  to: CommerceFoundationCutoverMode;
  engineSha?: string | null;
  manifestHash?: string | null;
};

async function lockSingleton(tx: CommerceFoundationCutoverClient): Promise<CommerceFoundationCutoverState> {
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "commerce_foundation_cutover" WHERE id = ${COMMERCE_FOUNDATION_CUTOVER_SINGLETON_ID} FOR UPDATE
  `;
  if (locked.length === 0) {
    throw new CommerceFoundationCutoverStateError(
      "Commerce foundation cutover singleton is missing; refuse to assume LEGACY"
    );
  }
  return getCommerceFoundationCutoverState(tx);
}

function requireNonEmptyHash(value: string | null | undefined, field: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    throw new CommerceFoundationCutoverTransitionError(
      "FROZEN",
      "BACKFILLING",
      `${field} is required to enter BACKFILLING`
    );
  }
  return trimmed;
}

/**
 * Internal operator helper. Tests may call this against disposable Postgres only.
 * Not a public API.
 */
export async function transitionCommerceFoundationCutover(
  prisma: CommerceFoundationCutoverPrisma,
  input: CommerceFoundationCutoverTransitionInput
): Promise<CommerceFoundationCutoverState> {
  return prisma.$transaction(async (tx) => {
    const current = await lockSingleton(tx);
    const now = new Date();
    const to = input.to;

    if (current.mode === "LEGACY" && to === "FROZEN") {
      await tx.commerceFoundationCutover.update({
        where: { id: COMMERCE_FOUNDATION_CUTOVER_SINGLETON_ID },
        data: { mode: "FROZEN", frozenAt: now },
      });
      return getCommerceFoundationCutoverState(tx);
    }

    if (current.mode === "FROZEN" && to === "LEGACY") {
      if (current.backfilledAt || current.foundationAt) {
        throw new CommerceFoundationCutoverTransitionError(
          current.mode,
          to,
          "FROZEN → LEGACY is only allowed before backfill/foundation mutation"
        );
      }
      await tx.commerceFoundationCutover.update({
        where: { id: COMMERCE_FOUNDATION_CUTOVER_SINGLETON_ID },
        data: {
          mode: "LEGACY",
          frozenAt: null,
          engineSha: null,
          manifestHash: null,
        },
      });
      return getCommerceFoundationCutoverState(tx);
    }

    if (current.mode === "FROZEN" && to === "BACKFILLING") {
      const engineSha = requireNonEmptyHash(input.engineSha, "engineSha");
      const manifestHash = requireNonEmptyHash(input.manifestHash, "manifestHash");
      await tx.commerceFoundationCutover.update({
        where: { id: COMMERCE_FOUNDATION_CUTOVER_SINGLETON_ID },
        data: { mode: "BACKFILLING", engineSha, manifestHash },
      });
      return getCommerceFoundationCutoverState(tx);
    }

    if (current.mode === "BACKFILLING" && to === "FOUNDATION") {
      await tx.commerceFoundationCutover.update({
        where: { id: COMMERCE_FOUNDATION_CUTOVER_SINGLETON_ID },
        data: { mode: "FOUNDATION", backfilledAt: now, foundationAt: now },
      });
      return getCommerceFoundationCutoverState(tx);
    }

    if (current.mode === "FOUNDATION" && to === "UNFROZEN") {
      await tx.commerceFoundationCutover.update({
        where: { id: COMMERCE_FOUNDATION_CUTOVER_SINGLETON_ID },
        data: { mode: "UNFROZEN", unfrozenAt: now },
      });
      return getCommerceFoundationCutoverState(tx);
    }

    throw new CommerceFoundationCutoverTransitionError(current.mode, to);
  });
}

export function isCommerceFoundationCutoverBlockedError(
  err: unknown
): err is CommerceFoundationCutoverBlockedError {
  return err instanceof CommerceFoundationCutoverBlockedError;
}
