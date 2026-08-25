import { z } from "zod";
import type { RemoteListingSummary } from "./types";
import {
  getBatchImportJob,
  recordImportJobItem,
  saveImportJobSnapshots,
  setImportJobCurrentTitle,
  startBatchImportJob,
  type BatchImportJob,
  type ImportJobSnapshot,
} from "./batch-import";
import { withSkipMeta, type ImportSkipEntry, type ImportSuccessEntry } from "./import-skip";

export const importPostBodySchema = z.object({
  listingIds: z.array(z.string()).min(1, "Select at least one listing to import."),
  jobId: z.string().min(1).optional(),
});

export async function loadOwnedImportJob(
  jobId: string,
  memberId: string
): Promise<BatchImportJob | null> {
  const job = await getBatchImportJob(jobId);
  if (!job || job.memberId !== memberId) return null;
  return job;
}

export function listingToSnapshot(listing: RemoteListingSummary): ImportJobSnapshot {
  return {
    externalListingId: listing.externalListingId,
    title: listing.title,
    sku: listing.sku ?? null,
    description: listing.description,
    priceCents: listing.priceCents,
    quantity: listing.quantity,
    photos: listing.photos,
    category: listing.category ?? null,
    subcategory: listing.subcategory ?? null,
    remoteCategoryId: listing.remoteCategoryId ?? null,
    shippingCostCents: listing.shippingCostCents ?? null,
    remoteShippingProfileId: listing.remoteShippingProfileId ?? null,
    packageWeightOz: listing.packageWeightOz ?? null,
    packageLengthIn: listing.packageLengthIn ?? null,
    packageWidthIn: listing.packageWidthIn ?? null,
    packageHeightIn: listing.packageHeightIn ?? null,
    variants: listing.variants,
    aspects: listing.aspects,
    acceptOffers: listing.acceptOffers,
    minOfferCents: listing.minOfferCents ?? null,
  };
}

export function snapshotToListing(snapshot: ImportJobSnapshot): RemoteListingSummary {
  return {
    externalListingId: snapshot.externalListingId,
    title: snapshot.title,
    sku: snapshot.sku ?? null,
    description: snapshot.description ?? null,
    priceCents: snapshot.priceCents ?? 0,
    quantity: snapshot.quantity ?? 0,
    photos: snapshot.photos ?? [],
    category: snapshot.category ?? null,
    subcategory: snapshot.subcategory ?? null,
    remoteCategoryId: snapshot.remoteCategoryId ?? null,
    shippingCostCents: snapshot.shippingCostCents ?? null,
    remoteShippingProfileId: snapshot.remoteShippingProfileId ?? null,
    packageWeightOz: snapshot.packageWeightOz ?? null,
    packageLengthIn: snapshot.packageLengthIn ?? null,
    packageWidthIn: snapshot.packageWidthIn ?? null,
    packageHeightIn: snapshot.packageHeightIn ?? null,
    variants: snapshot.variants,
    aspects: snapshot.aspects,
    acceptOffers: snapshot.acceptOffers,
    minOfferCents: snapshot.minOfferCents ?? null,
  };
}

export async function ensureJobSnapshots(
  job: BatchImportJob,
  fetchMatched: (ids: string[]) => Promise<{ listings: RemoteListingSummary[]; unmatchedIds: string[] }>
): Promise<{ snapshots: ImportJobSnapshot[]; unmatchedIds: string[] }> {
  if (job.snapshots.length > 0 || job.unmatchedIds.length > 0) {
    return { snapshots: job.snapshots, unmatchedIds: job.unmatchedIds };
  }
  const ids = job.listingIds;
  const { listings, unmatchedIds } = await fetchMatched(ids);
  const snapshots = listings.map(listingToSnapshot);
  await saveImportJobSnapshots(job.id, snapshots, unmatchedIds);
  return { snapshots, unmatchedIds };
}

export async function notifyImportJobStart(jobId: string | undefined, title: string | null) {
  if (!jobId) return;
  const job = await getBatchImportJob(jobId);
  if (job?.status === "pending") {
    await startBatchImportJob(jobId);
  }
  await setImportJobCurrentTitle(jobId, title);
}

export async function notifyImportJobSuccess(
  jobId: string | undefined,
  imported: ImportSuccessEntry
) {
  if (!jobId) return;
  await recordImportJobItem(jobId, { success: true, imported });
}

export async function notifyImportJobSkip(jobId: string | undefined, skipped: ImportSkipEntry) {
  if (!jobId) return;
  await recordImportJobItem(jobId, { success: false, skipped: withSkipMeta(skipped) });
}

export async function loadListingsForImport(opts: {
  jobId?: string;
  memberId: string;
  listingIds: string[];
  fetchAll: () => Promise<RemoteListingSummary[]>;
}): Promise<{
  job: BatchImportJob | null;
  listings: RemoteListingSummary[];
  unmatchedIds: string[];
  loadError?: string;
}> {
  const job = opts.jobId ? await loadOwnedImportJob(opts.jobId, opts.memberId) : null;
  if (opts.jobId && !job) {
    return { job: null, listings: [], unmatchedIds: opts.listingIds, loadError: "Import job not found." };
  }

  try {
    if (job) {
      const captured = await ensureJobSnapshots(job, async (ids) => {
        const all = await opts.fetchAll();
        const listings = all.filter((l) => ids.includes(l.externalListingId));
        const unmatchedIds = ids.filter((id) => !listings.some((l) => l.externalListingId === id));
        return { listings, unmatchedIds };
      });
      const listings = captured.snapshots
        .map(snapshotToListing)
        .filter((l) => opts.listingIds.includes(l.externalListingId));
      const unmatchedIds = opts.listingIds.filter(
        (id) => !listings.some((l) => l.externalListingId === id)
      );
      return { job, listings, unmatchedIds };
    }

    const all = await opts.fetchAll();
    const listings = all.filter((l) => opts.listingIds.includes(l.externalListingId));
    const unmatchedIds = opts.listingIds.filter(
      (id) => !listings.some((l) => l.externalListingId === id)
    );
    return { job: null, listings, unmatchedIds };
  } catch (e) {
    const loadError = e instanceof Error ? e.message : String(e);
    return { job, listings: [], unmatchedIds: opts.listingIds, loadError };
  }
}
