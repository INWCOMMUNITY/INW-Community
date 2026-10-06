import { PrismaClient } from "../node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client/index.js";

const prisma = new PrismaClient();
const shopId = "gid://shopify/Shop/80890036260";
const shopDomain = "jpuhtv-df.myshopify.com";

const rows = await prisma.shopifyConnection.findMany({
  where: {
    OR: [{ shopId }, { shopDomain }, { shopDomain: "northwestcommunity.myshopify.com" }],
  },
  select: {
    id: true,
    memberId: true,
    shopDomain: true,
    shopId: true,
    generation: true,
    status: true,
    primaryLocationId: true,
    connectedAt: true,
    disconnectedAt: true,
    createdAt: true,
    grantedScopes: true,
  },
  orderBy: { createdAt: "desc" },
});
console.log(
  JSON.stringify(
    {
      connectionCount: rows.length,
      rows: rows.map((r) => ({
        id: r.id,
        memberId: r.memberId,
        shopDomain: r.shopDomain,
        shopId: r.shopId,
        generation: r.generation,
        status: r.status,
        primaryLocationId: r.primaryLocationId,
        connectedAt: r.connectedAt,
        disconnectedAt: r.disconnectedAt,
        createdAt: r.createdAt,
        scopeCount: r.grantedScopes ? r.grantedScopes.split(",").length : 0,
      })),
    },
    null,
    2
  )
);

const states = await prisma.shopifyOAuthState.findMany({
  where: {
    OR: [
      { shopDomain: "northwestcommunity.myshopify.com" },
      { shopDomain: "jpuhtv-df.myshopify.com" },
      { nonce: { startsWith: "2e7fe1b5" } },
    ],
  },
  select: {
    id: true,
    nonce: true,
    shopDomain: true,
    memberId: true,
    consumedAt: true,
    expiresAt: true,
    createdAt: true,
  },
  orderBy: { createdAt: "desc" },
  take: 20,
});
console.log(
  JSON.stringify(
    {
      oauthStates: states.map((s) => ({
        noncePrefix: s.nonce.slice(0, 8),
        shopDomain: s.shopDomain,
        memberId: s.memberId,
        consumed: Boolean(s.consumedAt),
        consumedAt: s.consumedAt,
        createdAt: s.createdAt,
      })),
    },
    null,
    2
  )
);

await prisma.$disconnect();
