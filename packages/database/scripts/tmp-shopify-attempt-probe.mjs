import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const SHOP_GID = 'gid://shopify/Shop/80890036260';
const ATTEMPT = '2e7fe1b5';
const DOMAINS = ['jpuhtv-df.myshopify.com', 'northwestcommunity.myshopify.com'];

function safe(row) {
  if (!row) return null;
  return {
    id: row.id,
    memberId: row.memberId,
    shopDomain: row.shopDomain,
    shopId: row.shopId,
    generation: row.generation,
    status: row.status,
    primaryLocationId: row.primaryLocationId ?? null,
    connectedAt: row.connectedAt,
    disconnectedAt: row.disconnectedAt ?? null,
  };
}

async function main() {
  const keys = Object.keys(prisma).filter((k) => /shopify/i.test(k));
  console.log('prisma_shopify_keys', keys.join(','));

  const byGid = await prisma.shopifyConnection.findMany({
    where: { shopId: SHOP_GID },
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
    },
    orderBy: { generation: 'desc' },
    take: 20,
  });
  console.log('connections_by_gid', JSON.stringify(byGid.map(safe), null, 2));

  const byDomain = await prisma.shopifyConnection.findMany({
    where: { shopDomain: { in: DOMAINS } },
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
    },
    orderBy: { generation: 'desc' },
    take: 20,
  });
  console.log('connections_by_domain', JSON.stringify(byDomain.map(safe), null, 2));

  const states = await prisma.shopifyOAuthState.findMany({
    where: { nonce: { startsWith: ATTEMPT } },
    select: {
      nonce: true,
      shopDomain: true,
      memberId: true,
      consumedAt: true,
      createdAt: true,
      expiresAt: true,
    },
    take: 10,
  });
  console.log(
    'oauth_states',
    JSON.stringify(
      states.map((s) => ({
        prefix: s.nonce.slice(0, 8),
        shopDomain: s.shopDomain,
        memberId: s.memberId,
        consumed: Boolean(s.consumedAt),
        consumedAt: s.consumedAt,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
      })),
      null,
      2,
    ),
  );

  // Recent oauth states around callback window for same shops
  const windowStart = new Date('2026-09-26T00:40:00.000Z');
  const windowEnd = new Date('2026-09-26T00:55:00.000Z');
  const recentStates = await prisma.shopifyOAuthState.findMany({
    where: {
      shopDomain: { in: DOMAINS },
      createdAt: { gte: windowStart, lte: windowEnd },
    },
    select: {
      nonce: true,
      shopDomain: true,
      memberId: true,
      consumedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  console.log(
    'oauth_states_window',
    JSON.stringify(
      recentStates.map((s) => ({
        prefix: s.nonce.slice(0, 8),
        shopDomain: s.shopDomain,
        memberId: s.memberId,
        consumed: Boolean(s.consumedAt),
        consumedAt: s.consumedAt,
        createdAt: s.createdAt,
      })),
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error('PROBE_FAILED', e?.message || e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
