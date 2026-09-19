import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  COMMERCE_FOUNDATION_CUTOVER_SINGLETON_ID,
  CommerceFoundationCutoverBlockedError,
  CommerceFoundationCutoverStateError,
  CommerceFoundationCutoverTransitionError,
  CommerceFoundationWriterModeError,
  assertFoundationInventoryWriterAllowed,
  assertLegacyDrainFinalizerAllowed,
  assertLegacyInteractiveMutationAllowed,
  commerceInventoryWriterRoute,
  getCommerceFoundationCutoverState,
  isFoundationInventoryWriterMode,
  transitionCommerceFoundationCutover,
} from "../commerce-foundation-cutover";
import { foundationTestDatabaseUrl } from "./local-url";
import { closeOrDeleteMemberAccount } from "../member-account-lifecycle";
import { createMember, createStoreItem } from "./fixtures";

let prisma: PrismaClient;

async function resetSingleton() {
  await prisma.$executeRaw`
    INSERT INTO "commerce_foundation_cutover" ("id", "mode", "updated_at")
    VALUES (${COMMERCE_FOUNDATION_CUTOVER_SINGLETON_ID}, 'LEGACY', CURRENT_TIMESTAMP)
    ON CONFLICT ("id") DO UPDATE SET
      "mode" = 'LEGACY',
      "frozen_at" = NULL,
      "backfilled_at" = NULL,
      "foundation_at" = NULL,
      "unfrozen_at" = NULL,
      "engine_sha" = NULL,
      "manifest_hash" = NULL,
      "updated_at" = CURRENT_TIMESTAMP
  `;
}

beforeAll(() => {
  const url = foundationTestDatabaseUrl();
  prisma = new PrismaClient({
    datasources: { db: { url } },
    log: ["error"],
  });
});

afterEach(async () => {
  await resetSingleton();
});

afterAll(async () => {
  await prisma?.$disconnect();
});

describe("commerce foundation cutover singleton", () => {
  it("exists after migration in LEGACY with null freeze metadata", async () => {
    const state = await getCommerceFoundationCutoverState(prisma);
    expect(state.id).toBe("singleton");
    expect(state.mode).toBe("LEGACY");
    expect(state.frozenAt).toBeNull();
    expect(state.backfilledAt).toBeNull();
    expect(state.foundationAt).toBeNull();
    expect(state.unfrozenAt).toBeNull();
    expect(state.engineSha).toBeNull();
    expect(state.manifestHash).toBeNull();
  });

  it("rejects a second singleton id via CHECK", async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "commerce_foundation_cutover" ("id","mode","updated_at") VALUES ('other','LEGACY', CURRENT_TIMESTAMP)`
      )
    ).rejects.toThrow();
  });

  it("hard-errors when the singleton row is missing", async () => {
    await prisma.commerceFoundationCutover.delete({
      where: { id: COMMERCE_FOUNDATION_CUTOVER_SINGLETON_ID },
    });
    await expect(getCommerceFoundationCutoverState(prisma)).rejects.toBeInstanceOf(
      CommerceFoundationCutoverStateError
    );
  });

  it("hard-errors on an unknown mode", async () => {
    const fake = {
      commerceFoundationCutover: {
        findUnique: async () => ({
          id: "singleton",
          mode: "NOT_A_MODE",
          frozenAt: null,
          backfilledAt: null,
          foundationAt: null,
          unfrozenAt: null,
          engineSha: null,
          manifestHash: null,
          updatedAt: new Date(),
        }),
        update: async () => {
          throw new Error("unused");
        },
      },
      $queryRaw: async () => [],
    };
    await expect(getCommerceFoundationCutoverState(fake as never)).rejects.toBeInstanceOf(
      CommerceFoundationCutoverStateError
    );
  });
});

describe("commerce foundation cutover transitions", () => {
  it("LEGACY → FROZEN sets frozenAt", async () => {
    const before = Date.now() - 1000;
    const state = await transitionCommerceFoundationCutover(prisma, { to: "FROZEN" });
    expect(state.mode).toBe("FROZEN");
    expect(state.frozenAt).toBeInstanceOf(Date);
    expect(state.frozenAt!.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("FROZEN → LEGACY is allowed before backfill and clears freeze metadata", async () => {
    await transitionCommerceFoundationCutover(prisma, { to: "FROZEN" });
    const state = await transitionCommerceFoundationCutover(prisma, { to: "LEGACY" });
    expect(state.mode).toBe("LEGACY");
    expect(state.frozenAt).toBeNull();
    expect(state.engineSha).toBeNull();
    expect(state.manifestHash).toBeNull();
  });

  it("FROZEN → BACKFILLING requires engineSha + manifestHash", async () => {
    await transitionCommerceFoundationCutover(prisma, { to: "FROZEN" });
    await expect(transitionCommerceFoundationCutover(prisma, { to: "BACKFILLING" })).rejects.toBeInstanceOf(
      CommerceFoundationCutoverTransitionError
    );
    await expect(
      transitionCommerceFoundationCutover(prisma, {
        to: "BACKFILLING",
        engineSha: "   ",
        manifestHash: "abc",
      })
    ).rejects.toBeInstanceOf(CommerceFoundationCutoverTransitionError);
    const state = await transitionCommerceFoundationCutover(prisma, {
      to: "BACKFILLING",
      engineSha: "sha-1",
      manifestHash: "manifest-1",
    });
    expect(state.mode).toBe("BACKFILLING");
    expect(state.engineSha).toBe("sha-1");
    expect(state.manifestHash).toBe("manifest-1");
  });

  it("BACKFILLING → FOUNDATION sets backfilledAt and foundationAt without clearing hashes", async () => {
    await transitionCommerceFoundationCutover(prisma, { to: "FROZEN" });
    await transitionCommerceFoundationCutover(prisma, {
      to: "BACKFILLING",
      engineSha: "sha-1",
      manifestHash: "manifest-1",
    });
    const state = await transitionCommerceFoundationCutover(prisma, { to: "FOUNDATION" });
    expect(state.mode).toBe("FOUNDATION");
    expect(state.backfilledAt).toBeInstanceOf(Date);
    expect(state.foundationAt).toBeInstanceOf(Date);
    expect(state.engineSha).toBe("sha-1");
    expect(state.manifestHash).toBe("manifest-1");
  });

  it("FOUNDATION → UNFROZEN sets unfrozenAt", async () => {
    await transitionCommerceFoundationCutover(prisma, { to: "FROZEN" });
    await transitionCommerceFoundationCutover(prisma, {
      to: "BACKFILLING",
      engineSha: "sha-1",
      manifestHash: "manifest-1",
    });
    await transitionCommerceFoundationCutover(prisma, { to: "FOUNDATION" });
    const state = await transitionCommerceFoundationCutover(prisma, { to: "UNFROZEN" });
    expect(state.mode).toBe("UNFROZEN");
    expect(state.unfrozenAt).toBeInstanceOf(Date);
  });

  it("rejects illegal jumps and does not treat them as success", async () => {
    await expect(transitionCommerceFoundationCutover(prisma, { to: "FOUNDATION" })).rejects.toBeInstanceOf(
      CommerceFoundationCutoverTransitionError
    );
    expect((await getCommerceFoundationCutoverState(prisma)).mode).toBe("LEGACY");
  });

  it("rejects FOUNDATION → LEGACY and UNFROZEN → LEGACY", async () => {
    await transitionCommerceFoundationCutover(prisma, { to: "FROZEN" });
    await transitionCommerceFoundationCutover(prisma, {
      to: "BACKFILLING",
      engineSha: "sha-1",
      manifestHash: "manifest-1",
    });
    await transitionCommerceFoundationCutover(prisma, { to: "FOUNDATION" });
    await expect(transitionCommerceFoundationCutover(prisma, { to: "LEGACY" })).rejects.toBeInstanceOf(
      CommerceFoundationCutoverTransitionError
    );
    await transitionCommerceFoundationCutover(prisma, { to: "UNFROZEN" });
    await expect(transitionCommerceFoundationCutover(prisma, { to: "LEGACY" })).rejects.toBeInstanceOf(
      CommerceFoundationCutoverTransitionError
    );
  });

  it("rejects repeating an already-applied transition", async () => {
    await transitionCommerceFoundationCutover(prisma, { to: "FROZEN" });
    await expect(transitionCommerceFoundationCutover(prisma, { to: "FROZEN" })).rejects.toBeInstanceOf(
      CommerceFoundationCutoverTransitionError
    );
  });

  it("serializes concurrent transitions with the singleton row lock", async () => {
    const url = foundationTestDatabaseUrl();
    const a = new PrismaClient({ datasources: { db: { url } }, log: ["error"] });
    const b = new PrismaClient({ datasources: { db: { url } }, log: ["error"] });
    try {
      const results = await Promise.allSettled([
        transitionCommerceFoundationCutover(a, { to: "FROZEN" }),
        transitionCommerceFoundationCutover(b, { to: "FROZEN" }),
      ]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
        CommerceFoundationCutoverTransitionError
      );
      expect((await getCommerceFoundationCutoverState(prisma)).mode).toBe("FROZEN");
    } finally {
      await a.$disconnect();
      await b.$disconnect();
    }
  });
});

describe("legacy writer class gates", () => {
  it("interactive writers are allowed only in LEGACY", async () => {
    await expect(assertLegacyInteractiveMutationAllowed(prisma)).resolves.toBeUndefined();
    await transitionCommerceFoundationCutover(prisma, { to: "FROZEN" });
    await expect(assertLegacyInteractiveMutationAllowed(prisma)).rejects.toBeInstanceOf(
      CommerceFoundationCutoverBlockedError
    );
    await transitionCommerceFoundationCutover(prisma, {
      to: "BACKFILLING",
      engineSha: "sha-1",
      manifestHash: "manifest-1",
    });
    await expect(assertLegacyInteractiveMutationAllowed(prisma)).rejects.toMatchObject({
      code: "inventory_cutover_frozen",
      retryable: true,
      httpStatus: 503,
    });
    await transitionCommerceFoundationCutover(prisma, { to: "FOUNDATION" });
    await expect(assertLegacyInteractiveMutationAllowed(prisma)).rejects.toBeInstanceOf(
      CommerceFoundationCutoverBlockedError
    );
    await transitionCommerceFoundationCutover(prisma, { to: "UNFROZEN" });
    await expect(assertLegacyInteractiveMutationAllowed(prisma)).rejects.toBeInstanceOf(
      CommerceFoundationCutoverBlockedError
    );
  });

  it("drain writers: LEGACY always; FROZEN only with durable startedAt before frozenAt", async () => {
    const started = new Date("2026-01-01T00:00:00.000Z");
    await expect(assertLegacyDrainFinalizerAllowed(prisma, started)).resolves.toBeUndefined();

    const frozen = await transitionCommerceFoundationCutover(prisma, { to: "FROZEN" });
    const pre = new Date(frozen.frozenAt!.getTime() - 1000);
    const post = new Date(frozen.frozenAt!.getTime() + 1000);
    await expect(assertLegacyDrainFinalizerAllowed(prisma, pre)).resolves.toBeUndefined();
    await expect(assertLegacyDrainFinalizerAllowed(prisma, post)).rejects.toBeInstanceOf(
      CommerceFoundationCutoverBlockedError
    );
    await expect(assertLegacyDrainFinalizerAllowed(prisma, frozen.frozenAt)).rejects.toBeInstanceOf(
      CommerceFoundationCutoverBlockedError
    );
    await expect(assertLegacyDrainFinalizerAllowed(prisma, null)).rejects.toBeInstanceOf(
      CommerceFoundationCutoverBlockedError
    );

    await transitionCommerceFoundationCutover(prisma, {
      to: "BACKFILLING",
      engineSha: "sha-1",
      manifestHash: "manifest-1",
    });
    await expect(assertLegacyDrainFinalizerAllowed(prisma, pre)).rejects.toBeInstanceOf(
      CommerceFoundationCutoverBlockedError
    );
    await transitionCommerceFoundationCutover(prisma, { to: "FOUNDATION" });
    await expect(assertLegacyDrainFinalizerAllowed(prisma, pre)).rejects.toBeInstanceOf(
      CommerceFoundationCutoverBlockedError
    );
    await transitionCommerceFoundationCutover(prisma, { to: "UNFROZEN" });
    await expect(assertLegacyDrainFinalizerAllowed(prisma, pre)).rejects.toBeInstanceOf(
      CommerceFoundationCutoverBlockedError
    );
  });

  it("member close with listings fails atomically during FROZEN", async () => {
    const seller = await createMember(prisma, "cutover-close");
    const item = await createStoreItem(prisma, seller.id, "Freeze listing");
    await transitionCommerceFoundationCutover(prisma, { to: "FROZEN" });
    await expect(closeOrDeleteMemberAccount(prisma, seller.id)).rejects.toBeInstanceOf(
      CommerceFoundationCutoverBlockedError
    );
    const stillMember = await prisma.member.findUnique({ where: { id: seller.id } });
    expect(stillMember?.status).toBe("active");
    const stillItem = await prisma.storeItem.findUnique({ where: { id: item.id } });
    expect(stillItem?.status).toBe("active");
    expect(stillItem?.endedAt).toBeNull();
  });
});

describe("foundation inventory writer assertion", () => {
  it("allows FOUNDATION and UNFROZEN only", async () => {
    await expect(assertFoundationInventoryWriterAllowed(prisma)).rejects.toBeInstanceOf(
      CommerceFoundationWriterModeError
    );
    expect(commerceInventoryWriterRoute("LEGACY")).toBe("legacy");
    expect(commerceInventoryWriterRoute("FROZEN")).toBe("blocked");
    expect(commerceInventoryWriterRoute("BACKFILLING")).toBe("blocked");
    expect(commerceInventoryWriterRoute("FOUNDATION")).toBe("foundation");
    expect(commerceInventoryWriterRoute("UNFROZEN")).toBe("foundation");

    await transitionCommerceFoundationCutover(prisma, { to: "FROZEN" });
    await expect(assertFoundationInventoryWriterAllowed(prisma)).rejects.toBeInstanceOf(
      CommerceFoundationCutoverBlockedError
    );
    await transitionCommerceFoundationCutover(prisma, {
      to: "BACKFILLING",
      engineSha: "sha-1",
      manifestHash: "manifest-1",
    });
    await expect(assertFoundationInventoryWriterAllowed(prisma)).rejects.toBeInstanceOf(
      CommerceFoundationCutoverBlockedError
    );
    await transitionCommerceFoundationCutover(prisma, { to: "FOUNDATION" });
    const foundation = await assertFoundationInventoryWriterAllowed(prisma);
    expect(isFoundationInventoryWriterMode(foundation.mode)).toBe(true);
    await transitionCommerceFoundationCutover(prisma, { to: "UNFROZEN" });
    const unfrozen = await assertFoundationInventoryWriterAllowed(prisma);
    expect(unfrozen.mode).toBe("UNFROZEN");
  });
});
