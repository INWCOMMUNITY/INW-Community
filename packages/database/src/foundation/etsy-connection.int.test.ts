import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMember } from "./fixtures";
import { foundationTestDatabaseUrl } from "./local-url";
import {
  consumeEtsyOAuthState,
  createEtsyOAuthState,
  disconnectEtsyConnection,
  getEtsyConnectionForMember,
  persistEtsyInstall,
  EtsyShopOwnershipConflictError,
} from "../etsy/connection";

let prisma: PrismaClient;

beforeAll(() => {
  prisma = new PrismaClient({
    datasources: { db: { url: foundationTestDatabaseUrl() } },
    log: ["error"],
  });
});

afterAll(async () => {
  await prisma?.$disconnect();
});

function installInput(memberId: string, shopId: string, etsyUserId = "1001", token = "cipher-access") {
  return {
    memberId,
    etsyUserId,
    shopId,
    shopName: `Shop ${shopId}`,
    accessTokenEncrypted: token,
    refreshTokenEncrypted: "cipher-refresh",
    accessTokenExpiresAt: new Date("2026-09-30T01:00:00Z"),
    refreshTokenExpiresAt: new Date("2026-12-29T00:00:00Z"),
    grantedScopes: "listings_r listings_w shops_r transactions_r",
  };
}

describe("etsy connection foundation", () => {
  it("enforces generation, one active row, ownership, and oauth consume-once", async () => {
    const sellerA = await createMember(prisma, "etsy-a");
    const sellerB = await createMember(prisma, "etsy-b");
    const shopId = `9${sellerA.id.replace(/\D/g, "").slice(-7) || "1234567"}`;

    const nonce = `d${sellerA.id}`.padEnd(64, "d").slice(0, 64);
    await createEtsyOAuthState(prisma, {
      nonce,
      memberId: sellerA.id,
      browserBindingHash: "a".repeat(64),
      codeVerifierEncrypted: "enc:verifier",
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(
      consumeEtsyOAuthState(prisma, { nonce, memberId: sellerA.id })
    ).resolves.toEqual({ status: "ok", codeVerifierEncrypted: "enc:verifier" });
    await expect(
      consumeEtsyOAuthState(prisma, { nonce, memberId: sellerA.id })
    ).resolves.toEqual({ status: "rejected" });

    const expiredNonce = `e${sellerA.id}`.padEnd(64, "e").slice(0, 64);
    await createEtsyOAuthState(prisma, {
      nonce: expiredNonce,
      memberId: sellerA.id,
      browserBindingHash: "b".repeat(64),
      codeVerifierEncrypted: "enc:expired",
      expiresAt: new Date("2020-01-01T00:00:00Z"),
    });
    await expect(
      consumeEtsyOAuthState(prisma, {
        nonce: expiredNonce,
        memberId: sellerA.id,
        now: new Date("2026-09-30T12:00:00Z"),
      })
    ).resolves.toEqual({ status: "rejected" });

    const first = await persistEtsyInstall(prisma, installInput(sellerA.id, shopId, "2001", "cipher-1"));
    expect(first.generation).toBe(1);
    expect(first.status).toBe("ACTIVE");

    const second = await persistEtsyInstall(prisma, installInput(sellerA.id, shopId, "2001", "cipher-2"));
    expect(second.generation).toBe(2);
    const previous = await getEtsyConnectionForMember(prisma, sellerA.id, first.id);
    expect(previous?.status).toBe("DISCONNECTED");

    await expect(
      persistEtsyInstall(prisma, installInput(sellerB.id, shopId, "2002", "cipher-b"))
    ).rejects.toBeInstanceOf(EtsyShopOwnershipConflictError);

    const disconnected = await disconnectEtsyConnection(prisma, {
      memberId: sellerA.id,
      connectionId: second.id,
    });
    expect(disconnected?.status).toBe("DISCONNECTED");
  });
});
