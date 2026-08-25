import { describe, expect, it } from "vitest";
import { looksLikeHostedProdDatabase, shouldBlockDevChannelTokenWrites } from "./dev-prod-guard";

describe("looksLikeHostedProdDatabase", () => {
  it("detects Neon / Prisma / RDS hosts", () => {
    expect(looksLikeHostedProdDatabase("postgresql://user:pass@ep-foo.neon.tech/neondb")).toBe(true);
    expect(looksLikeHostedProdDatabase("postgres://x.db.prisma.io/db")).toBe(true);
    expect(looksLikeHostedProdDatabase("postgresql://localhost:5432/inw")).toBe(false);
  });
});

describe("shouldBlockDevChannelTokenWrites", () => {
  it("only blocks local development against hosted databases", () => {
    expect(shouldBlockDevChannelTokenWrites()).toBe(false);
  });
});
