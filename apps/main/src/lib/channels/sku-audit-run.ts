import { prisma } from "database";
import { getMemberConnectionContextWithError } from "./connection";
import { syncStoreItemSelect, toSyncStoreItem } from "./store-item";
import type { ChannelConnectionContext, ChannelProvider } from "./types";
import { isChannelProvider } from "./types";
import {
  attachChannelHits,
  auditCatalog,
  classifyChannelForItem,
  emptyLiveStatus,
  finishSkuAuditReport,
  type SkuAuditExtraRemote,
  type SkuAuditLiveStatus,
  type SkuAuditReport,
  type SkuAuditUnit,
} from "./sku-audit";
import { hydrateLinkSkus } from "./sku-audit-live";

const LIVE_CONCURRENCY = 2;

export type RunSkuAuditOpts = {
  memberId: string;
  live?: boolean;
  provider?: ChannelProvider | null;
  storeItemId?: string | null;
};

async function mapPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) return;
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i;
      i += 1;
      const item = items[idx];
      if (item !== undefined) await fn(item);
    }
  });
  await Promise.all(workers);
}

export async function runSkuAudit(opts: RunSkuAuditOpts): Promise<SkuAuditReport> {
  const provider = opts.provider && isChannelProvider(opts.provider) ? opts.provider : null;
  const storeItemId = opts.storeItemId?.trim() || null;
  const live = opts.live === true;

  const rows = await prisma.storeItem.findMany({
    where: {
      memberId: opts.memberId,
      ...(storeItemId ? { id: storeItemId } : {}),
    },
    select: {
      ...syncStoreItemSelect,
      channelLinks: {
        where: {
          syncEnabled: true,
          ...(provider ? { provider } : {}),
        },
        select: {
          provider: true,
          externalListingId: true,
          linkOrigin: true,
        },
      },
    },
  });

  let units: SkuAuditUnit[] = auditCatalog(
    rows.map((r) => ({ id: r.id, title: r.title, sku: r.sku, variants: r.variants }))
  );
  const extras: SkuAuditExtraRemote[] = [];
  const hydrateErrors: SkuAuditReport["hydrateErrors"] = [];

  if (!live) {
    return finishSkuAuditReport({
      live: false,
      units,
      extras,
      hydrateErrors,
      liveStatus: emptyLiveStatus(false),
    });
  }

  type Job = {
    storeItemId: string;
    title: string;
    provider: ChannelProvider;
    externalListingId: string;
    linkOrigin: string | null;
  };
  const jobs: Job[] = [];
  for (const row of rows) {
    for (const link of row.channelLinks) {
      if (!isChannelProvider(link.provider)) continue;
      jobs.push({
        storeItemId: row.id,
        title: row.title,
        provider: link.provider,
        externalListingId: link.externalListingId,
        linkOrigin: link.linkOrigin,
      });
    }
  }

  const providerLinkCounts = new Map<ChannelProvider, number>();
  for (const job of jobs) {
    providerLinkCounts.set(job.provider, (providerLinkCounts.get(job.provider) ?? 0) + 1);
  }
  const uniqueProviders = [...providerLinkCounts.keys()];

  const ctxByProvider = new Map<ChannelProvider, ChannelConnectionContext | null>();
  const skipReasons = new Map<ChannelProvider, string>();
  await Promise.all(
    uniqueProviders.map(async (p) => {
      const { ctx, error } = await getMemberConnectionContextWithError(opts.memberId, p);
      ctxByProvider.set(p, ctx);
      if (!ctx) {
        skipReasons.set(p, error ?? `Connect your ${p} account in Sync Stores.`);
      }
    })
  );

  const providersChecked: ChannelProvider[] = uniqueProviders.filter((p) => Boolean(ctxByProvider.get(p)));
  const providersSkipped: SkuAuditLiveStatus["providersSkipped"] = uniqueProviders
    .filter((p) => !ctxByProvider.get(p))
    .map((p) => ({
      provider: p,
      reason: skipReasons.get(p) ?? `Connect your ${p} account in Sync Stores.`,
      linkCount: providerLinkCounts.get(p) ?? 0,
    }));

  for (const skip of providersSkipped) {
    const linkWord = skip.linkCount === 1 ? "link" : "links";
    hydrateErrors.push({
      storeItemId: "",
      provider: skip.provider,
      error: `${skip.reason} (${skip.linkCount} leftover listing ${linkWord} skipped.)`,
    });
  }

  const itemById = new Map(rows.map((r) => [r.id, r]));
  const catalogByItem = new Map<string, SkuAuditUnit[]>();
  for (const u of units) {
    const list = catalogByItem.get(u.storeItemId) ?? [];
    list.push(u);
    catalogByItem.set(u.storeItemId, list);
  }

  type HydrateResult = {
    job: Job;
    classified: ReturnType<typeof classifyChannelForItem> | null;
  };
  const hydrateResults: HydrateResult[] = [];
  const runnableJobs = jobs.filter((j) => ctxByProvider.get(j.provider));

  await mapPool(runnableJobs, LIVE_CONCURRENCY, async (job) => {
    const ctx = ctxByProvider.get(job.provider);
    if (!ctx) return;
    const row = itemById.get(job.storeItemId);
    if (!row) return;
    const item = toSyncStoreItem(row);
    const hydrated = await hydrateLinkSkus({
      ctx,
      provider: job.provider,
      externalListingId: job.externalListingId,
      item,
      linkOrigin: job.linkOrigin,
    });
    if (hydrated.error) {
      hydrateErrors.push({
        storeItemId: job.storeItemId,
        provider: job.provider,
        error: hydrated.error,
      });
    }
    const itemUnits = catalogByItem.get(job.storeItemId) ?? [];
    const classified = classifyChannelForItem({
      units: itemUnits.map((u) => ({ ...u, channels: [] })),
      remoteRows: hydrated.rows,
      provider: job.provider,
      expectedEbayPushSkus: hydrated.expectedEbayPushSkus,
    });
    hydrateResults.push({ job, classified });
  });

  for (const result of hydrateResults) {
    if (!result.classified) continue;
    units = attachChannelHits(units, result.job.storeItemId, result.classified);
    extras.push(...result.classified.extras);
  }

  const listingsHydrated = new Set(hydrateResults.map((r) => r.job.storeItemId)).size;
  const liveStatus: SkuAuditLiveStatus = {
    attempted: true,
    providersChecked,
    providersSkipped,
    listingsHydrated,
  };

  return finishSkuAuditReport({ live: true, units, extras, hydrateErrors, liveStatus });
}

/** Catalog-only compact summary for diagnose routes (never hits channel APIs). */
export async function catalogSkuAuditCompact(
  opts: Omit<RunSkuAuditOpts, "live">
): Promise<SkuAuditReport["compact"]> {
  const report = await runSkuAudit({ ...opts, live: false });
  return report.compact;
}

export async function tryCatalogSkuAuditCompact(
  opts: Omit<RunSkuAuditOpts, "live">
): Promise<SkuAuditReport["compact"] | undefined> {
  try {
    return await catalogSkuAuditCompact(opts);
  } catch (e) {
    console.warn("[sku-audit] catalog compact failed", { error: String(e) });
    return undefined;
  }
}
