import { NextRequest, NextResponse } from "next/server";
import { prisma, Prisma } from "database";
import { z } from "zod";
import { getSessionForApi } from "@/lib/mobile-auth";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";
import { getMemberConnectionContext } from "@/lib/channels/connection";
import { getAdapter } from "@/lib/channels/registry";
import { migrateEbayListings, fetchEbayItemDetails } from "@/lib/channels/ebay/trading";
import { normalizeListingAspects } from "@/lib/listing-limits";
import { fetchAndCacheEbayInventoryAspects } from "@/lib/channels/ebay/inventory-aspects-cache";
import { normalizeEbayPhotoUrl } from "@/lib/channels/ebay/photos";
import { storeListingDescription, resolveImportCategory } from "@/lib/channels/import-listing";
import { seedCategoryMappingFromImport } from "@/lib/channels/category-resolver";
import { needsCategoryRepair } from "@/lib/channels/repair-categories";
import { splitEbayCategoryPath } from "@/lib/channels/ebay-category-aliases";
import { syncContentHash, syncMetaHash } from "@/lib/channels/sync-baseline";
import { variantsFingerprint, sumVariantQuantities } from "@/lib/channels/variant-sync";
import { describeEbayThrownError, ebayErrorActionHint } from "@/lib/channels/ebay/errors";
import { resolveEbayLegacyListingId, indexEbayRemoteListings } from "@/lib/channels/ebay/mapping";
import { attachShippingOptionOnImport, maybeImportShippingOptionsOnSync } from "@/lib/shipping-options";
import { withSkipMeta, type ImportSkipEntry, type ImportSuccessEntry } from "@/lib/channels/import-skip";
import {
  ensureJobSnapshots,
  importPostBodySchema,
  loadOwnedImportJob,
  notifyImportJobSkip,
  notifyImportJobStart,
  notifyImportJobSuccess,
  snapshotToListing,
} from "@/lib/channels/import-job-runtime";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function buildImportSummary(importedCount: number, skipped: ImportSkipEntry[]): string {
  const lines: string[] = [];
  if (importedCount > 0) {
    lines.push(`Imported ${importedCount} listing${importedCount === 1 ? "" : "s"}.`);
  } else {
    lines.push("No listings were imported.");
  }
  if (skipped.length > 0) {
    lines.push(`${skipped.length} skipped:`);
    for (const row of skipped) {
      const label = row.title ? `"${row.title}"` : row.externalListingId;
      lines.push(`• ${label} (${row.step}): ${row.reason}`);
      if (row.hint) lines.push(`  → ${row.hint}`);
    }
  }
  return lines.join("\n");
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
function uniqueSlug(base: string): string {
  return `${base || "ebay-item"}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function describeImportError(e: unknown): string {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    const target = Array.isArray(e.meta?.target)
      ? (e.meta?.target as string[]).join(",")
      : typeof e.meta?.target === "string"
        ? e.meta.target
        : undefined;
    const detail = e.message.split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? "";
    return `create_failed: ${e.code}${target ? ` (${target})` : ""} ${detail}`.slice(0, 300);
  }
  if (e instanceof Prisma.PrismaClientValidationError) {
    const detail = e.message.split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? e.message;
    return `create_failed: validation ${detail}`.slice(0, 300);
  }
  if (e instanceof Error) return `create_failed: ${e.message}`.slice(0, 300);
  return `create_failed: ${String(e)}`.slice(0, 300);
}

function resolveSelectedRemoteListings(
  allRemote: Awaited<ReturnType<ReturnType<typeof getAdapter>["listRemoteListings"]>>,
  listingIds: string[]
) {
  const index = indexEbayRemoteListings(allRemote);
  const out: typeof allRemote = [];
  const seen = new Set<string>();

  for (const requestedId of listingIds) {
    const trimmed = requestedId.trim();
    if (!trimmed) continue;

    const legacy = resolveEbayLegacyListingId(trimmed);
    const keys = [trimmed, legacy, legacy ? `inw${legacy}` : null].filter(Boolean) as string[];

    let found: (typeof allRemote)[number] | undefined;
    for (const key of keys) {
      found = index.get(key);
      if (found) break;
    }

    if (found && !seen.has(found.externalListingId)) {
      seen.add(found.externalListingId);
      out.push(found);
    }
  }

  return out;
}

async function attachEbayListingShippingOption(args: {
  memberId: string;
  storeItemId: string;
  remoteProfileId?: string | null;
  listing?: {
    packageWeightOz?: number | null;
    packageLengthIn?: number | null;
    packageWidthIn?: number | null;
    packageHeightIn?: number | null;
    shippingCostCents?: number | null;
  };
}) {
  await attachShippingOptionOnImport({
    memberId: args.memberId,
    storeItemId: args.storeItemId,
    source: "ebay",
    hint: {
      remoteProfileId: args.remoteProfileId?.trim() || null,
      weightOz: args.listing?.packageWeightOz ?? null,
      lengthIn: args.listing?.packageLengthIn ?? null,
      widthIn: args.listing?.packageWidthIn ?? null,
      heightIn: args.listing?.packageHeightIn ?? null,
      shippingCostCents: args.listing?.shippingCostCents ?? null,
    },
  }).catch((e) =>
    console.warn("[ebay import] attach shipping option failed", {
      storeItemId: args.storeItemId,
      error: String(e),
    })
  );
}

async function loadRemoteWithLinkState(userId: string) {
  const ctx = await getMemberConnectionContext(userId, "ebay");
  if (!ctx) {
    return { ctx: null, listings: [] as Awaited<ReturnType<ReturnType<typeof getAdapter>["listRemoteListings"]>> };
  }
  const listings = await getAdapter("ebay").listRemoteListings(ctx);

  const linked = await prisma.channelListingLink.findMany({
    where: { provider: "ebay", connectionId: ctx.id },
    select: { externalListingId: true, storeItemId: true, storeItem: { select: { id: true, title: true } } },
  });

  // Build maps for quick lookup
  const linkedByExternalId = new Map<string, string>(); // externalListingId → storeItemId
  const linkedByTitle = new Map<string, string>(); // lowercase title → storeItemId
  for (const l of linked) {
    linkedByExternalId.set(l.externalListingId, l.storeItemId);
    const title = l.storeItem?.title?.trim().toLowerCase();
    if (title) linkedByTitle.set(title, l.storeItemId);
  }

  // Check if a legacy listing ID is already linked and return the storeItemId.
  // After import, listings are stored with a migrated SKU like `inw${legacyId}`,
  // so we need to check both the raw legacy ID and the inw-prefixed version.
  const findLinkedStoreItemId = (externalId: string, title: string): string | null => {
    const legacyId = resolveEbayLegacyListingId(externalId) ?? externalId;
    if (linkedByExternalId.has(externalId)) {
      return linkedByExternalId.get(externalId)!;
    }
    if (linkedByExternalId.has(legacyId)) {
      return linkedByExternalId.get(legacyId)!;
    }
    if (linkedByExternalId.has(`inw${legacyId}`)) {
      return linkedByExternalId.get(`inw${legacyId}`)!;
    }
    // Check by title
    const normalizedTitle = title.trim().toLowerCase();
    if (linkedByTitle.has(normalizedTitle)) {
      return linkedByTitle.get(normalizedTitle)!;
    }
    return null;
  };

  return {
    ctx,
    listings: listings.map((l) => {
      const storeItemId = findLinkedStoreItemId(l.externalListingId, l.title);
      return {
        ...l,
        alreadyLinked: storeItemId !== null,
        storeItemId: storeItemId ?? undefined,
      };
    }),
  };
}

/** GET: preview the seller's eBay listings.
 * Query params:
 *   - autoRefresh=1: Automatically refresh all linked listings from eBay before returning
 */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ctx = await getMemberConnectionContext(userId, "ebay");
  if (!ctx) {
    return NextResponse.json({ error: "Connect your eBay account first.", code: "NOT_CONNECTED" }, { status: 400 });
  }

  const searchParams = req.nextUrl.searchParams;
  const autoRefresh = searchParams.get("autoRefresh") === "1";

  try {
    // Auto-refresh linked listings from eBay if requested
    let refreshResults: { updated: number; checked: number } | undefined;
    if (autoRefresh) {
      const { pullEbayUpdatesForConnection } = await import("@/lib/channels/ebay/pull-ebay-updates");
      const connection = await prisma.channelConnection.findFirst({
        where: { memberId: userId, provider: "ebay", status: "active" },
      });
      if (connection) {
        const result = await pullEbayUpdatesForConnection(connection);
        refreshResults = { updated: result.updated.length, checked: result.checked };
        console.log("[ebay import] auto-refresh completed", refreshResults);
      }
    }

    const { listings } = await loadRemoteWithLinkState(userId);
    return NextResponse.json({ 
      listings,
      ...(refreshResults ? { refreshed: refreshResults } : {}),
    });
  } catch (e) {
    const msg = describeEbayThrownError(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

const bodySchema = importPostBodySchema;

/**
 * POST: import selected eBay listings. Each listing is migrated to the Inventory model (so unified
 * inventory updates work), then created as a StoreItem and linked by its eBay SKU for ongoing sync.
 */
export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const canList = await memberHasStorefrontListingAccess(userId);
  if (!canList) {
    return NextResponse.json({ error: "Seller plan required to import listings." }, { status: 403 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.errors[0]?.message : "Invalid input";
    return NextResponse.json({ error: String(msg) }, { status: 400 });
  }

  const ctx = await getMemberConnectionContext(userId, "ebay");
  if (!ctx) {
    return NextResponse.json({ error: "Connect your eBay account first.", code: "NOT_CONNECTED" }, { status: 400 });
  }

  await maybeImportShippingOptionsOnSync(userId, "ebay").catch((e) =>
    console.warn("[ebay import] shipping option sync failed", { error: String(e) })
  );

  const jobId = body.jobId;
  let job = jobId ? await loadOwnedImportJob(jobId, userId) : null;
  if (jobId && !job) {
    return NextResponse.json({ error: "Import job not found." }, { status: 404 });
  }

  let remote;
  try {
    if (job) {
      const captured = await ensureJobSnapshots(job, async (ids) => {
        const allRemote = await getAdapter("ebay").listRemoteListings(ctx);
        const listings = resolveSelectedRemoteListings(allRemote, ids);
        const unmatchedIds = ids.filter(
          (id) => resolveSelectedRemoteListings(allRemote, [id]).length === 0
        );
        return { listings, unmatchedIds };
      });
      const fromSnapshots = captured.snapshots.map(snapshotToListing);
      remote = resolveSelectedRemoteListings(fromSnapshots, body.listingIds);
    } else {
      const allRemote = await getAdapter("ebay").listRemoteListings(ctx);
      remote = resolveSelectedRemoteListings(allRemote, body.listingIds);
    }
  } catch (e) {
    const msg = describeEbayThrownError(e);
    if (job) {
      const skippedOnLoad = body.listingIds.map((id) =>
        withSkipMeta({
          externalListingId: id,
          step: "migration",
          reason: msg,
          hint: ebayErrorActionHint(msg),
        })
      );
      for (const row of skippedOnLoad) {
        await notifyImportJobSkip(job.id, row);
      }
      return NextResponse.json({
        ok: true,
        jobId: job.id,
        imported: [],
        skipped: skippedOnLoad,
        summary: buildImportSummary(0, skippedOnLoad),
        hint: ebayErrorActionHint(msg) ?? msg,
      });
    }
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const titleById = new Map(remote.map((l) => [l.externalListingId, l.title]));
  const photoById = new Map(remote.map((l) => [l.externalListingId, l.photos?.[0]]));
  const imported: (ImportSuccessEntry & {
    categoryAssignment?: {
      category: string;
      subcategory: string | null;
      source: string;
    };
  })[] = [];
  const skipped: ImportSkipEntry[] = [];
  let uncategorizedCount = 0;

  const pushSkip = async (
    externalListingId: string,
    step: ImportSkipEntry["step"],
    reason: string,
    extras?: { title?: string; photo?: string }
  ) => {
    const row = withSkipMeta({
      externalListingId,
      title: extras?.title ?? titleById.get(externalListingId),
      photo: extras?.photo ?? photoById.get(externalListingId),
      step,
      reason,
      hint: ebayErrorActionHint(reason),
    });
    skipped.push(row);
    await notifyImportJobSkip(jobId, row);
  };

  const pushImported = async (
    row: ImportSuccessEntry & {
      categoryAssignment?: {
        category: string;
        subcategory: string | null;
        source: string;
      };
    }
  ) => {
    imported.push(row);
    await notifyImportJobSuccess(jobId, {
      externalListingId: row.externalListingId,
      storeItemId: row.storeItemId,
      title: row.title,
      photo: row.photo,
    });
  };

  if (remote.length === 0) {
    if (jobId) {
      for (const id of body.listingIds) {
        await pushSkip(
          id,
          "migration",
          "Could not match this listing to your active eBay inventory. Refresh and try again."
        );
      }
      return NextResponse.json({
        ok: true,
        jobId,
        imported,
        skipped,
        summary: buildImportSummary(0, skipped),
        hint: skipped[0]?.hint,
      });
    }
    return NextResponse.json(
      {
        error:
          "Could not match the selected listings to your active eBay inventory. Refresh the page and try again.",
        code: "LISTINGS_NOT_FOUND",
      },
      { status: 400 }
    );
  }

  if (remote.length < body.listingIds.length) {
    console.warn("[ebay import] some selected listing ids did not match active listings", {
      requested: body.listingIds.length,
      matched: remote.length,
    });
    const matchedKeys = new Set(
      remote.flatMap((l) => {
        const legacy = resolveEbayLegacyListingId(l.externalListingId) ?? l.externalListingId;
        return [l.externalListingId, legacy, `inw${legacy}`];
      })
    );
    for (const id of body.listingIds) {
      const legacy = resolveEbayLegacyListingId(id) ?? id;
      if (matchedKeys.has(id) || matchedKeys.has(legacy) || matchedKeys.has(`inw${legacy}`)) {
        continue;
      }
      await pushSkip(
        id,
        "migration",
        "Could not match this listing to your active eBay inventory. Refresh and try again."
      );
    }
  }

  for (const listing of remote) {
    const legacyId =
      resolveEbayLegacyListingId(listing.externalListingId) ?? listing.externalListingId;
    const listingPhoto = listing.photos?.[0];
    await notifyImportJobStart(jobId, listing.title);

    let sku: string | undefined;
    try {
      const migration = await migrateEbayListings(ctx.accessToken, [legacyId], {
        knownSkus: new Map([
          [legacyId, listing.sku],
          [listing.externalListingId, listing.sku],
        ]),
      });
      const result = migration.get(legacyId) ?? migration.get(listing.externalListingId);
      if (!result || result.error || !result.sku) {
        await pushSkip(legacyId, "migration", result?.error || "migration_failed", {
          title: listing.title,
          photo: listingPhoto,
        });
        continue;
      }
      sku = result.sku;
    } catch (e) {
      await pushSkip(legacyId, "migration", describeEbayThrownError(e), {
        title: listing.title,
        photo: listingPhoto,
      });
      continue;
    }

    try {
    const existing = await prisma.channelListingLink.findUnique({
      where: { provider_externalListingId: { provider: "ebay", externalListingId: sku } },
      include: {
        storeItem: {
          select: {
            memberId: true,
            id: true,
            title: true,
            description: true,
            category: true,
            subcategory: true,
          },
        },
      },
    });
    if (existing) {
      if (!existing.storeItem) {
        await prisma.channelListingLink.delete({ where: { id: existing.id } }).catch(() => {});
      } else if (
        existing.storeItem.memberId === userId &&
        needsCategoryRepair(existing.storeItem)
      ) {
        const details = await fetchEbayItemDetails(ctx.accessToken, legacyId);
        const ebayCategoryPath =
          details.categoryName?.trim() || listing.category?.trim() || null;
        const itemTitle = details.title ?? listing.title;
        const remoteSplit = splitEbayCategoryPath(ebayCategoryPath);
        const categoryAssignment = await resolveImportCategory({
          provider: "ebay",
          remoteLabel: ebayCategoryPath,
          remoteSubLabel: remoteSplit.subcategory,
          title: itemTitle,
          description: details.description ?? listing.description,
          remoteCategoryId: details.remoteCategoryId ?? listing.remoteCategoryId ?? null,
        });

    if (categoryAssignment?.category && categoryAssignment.subcategory) {
          await prisma.storeItem.update({
            where: { id: existing.storeItem.id },
            data: {
              category: categoryAssignment.category,
              subcategory: categoryAssignment.subcategory,
            },
          });
          await prisma.channelListingLink.update({
            where: { id: existing.id },
            data: {
              remoteCategoryLabel: ebayCategoryPath?.slice(0, 500) ?? null,
              remoteCategorySubLabel: remoteSplit.subcategory?.slice(0, 200) ?? null,
            },
          });
          await pushImported({
            externalListingId: legacyId,
            storeItemId: existing.storeItem.id,
            title: listing.title,
            photo: listingPhoto,
            categoryAssignment: {
              category: categoryAssignment.category,
              subcategory: categoryAssignment.subcategory,
              source: categoryAssignment.source,
            },
          });
          await attachEbayListingShippingOption({
            memberId: userId,
            storeItemId: existing.storeItem.id,
            remoteProfileId: details.remoteShippingProfileId ?? listing.remoteShippingProfileId,
            listing,
          });
          continue;
        }

        await attachEbayListingShippingOption({
          memberId: userId,
          storeItemId: existing.storeItem.id,
          remoteProfileId: details.remoteShippingProfileId ?? listing.remoteShippingProfileId,
          listing,
        });
        await pushSkip(legacyId, "dedupe", "already_linked", {
          title: listing.title,
          photo: listingPhoto,
        });
        continue;
      } else {
        await attachEbayListingShippingOption({
          memberId: userId,
          storeItemId: existing.storeItem.id,
          remoteProfileId: listing.remoteShippingProfileId,
          listing,
        });
        await pushSkip(legacyId, "dedupe", "already_linked", {
          title: listing.title,
          photo: listingPhoto,
        });
        continue;
      }
    }

    const safePriceCents = Math.max(0, Math.round(Number(listing.priceCents) || 0));
    if (safePriceCents < 1) {
      await pushSkip(legacyId, "validation", "invalid_price — listing price must be at least $0.01", {
        title: listing.title,
        photo: listingPhoto,
      });
      continue;
    }

    // Pull full item specifics + category path from GetItem (more reliable than preview).
    const details = await fetchEbayItemDetails(ctx.accessToken, legacyId);
    const ebayCategoryPath =
      details.categoryName?.trim() || listing.category?.trim() || null;
    const itemTitle = details.title ?? listing.title;
    const remoteSplit = splitEbayCategoryPath(ebayCategoryPath);
    const categoryAssignment = await resolveImportCategory({
      provider: "ebay",
      remoteLabel: ebayCategoryPath,
      remoteSubLabel: remoteSplit.subcategory,
      title: itemTitle,
      description: details.description ?? listing.description,
      remoteCategoryId: details.remoteCategoryId ?? listing.remoteCategoryId ?? null,
    });
    const finalResolvedCat = categoryAssignment
      ? {
          category: categoryAssignment.category,
          subcategory: categoryAssignment.subcategory,
          matchedPreset: categoryAssignment.matchedPreset,
          score: categoryAssignment.score,
        }
      : null;
    const remoteCategoryId = details.remoteCategoryId ?? listing.remoteCategoryId ?? null;
    const importedAspects = normalizeListingAspects(details.aspects);
    const aspectsForStorage = importedAspects;
    const importedVariants = details.variants;
    const importQty =
      importedVariants && importedVariants.length > 0
        ? sumVariantQuantities(importedVariants)
        : Math.max(0, Math.round(Number(details.quantity ?? listing.quantity) || 0));

    // Debug logging for import troubleshooting
    console.log("[ebay import] details fetched", {
      legacyId,
      aspectsCount: details.aspects.length,
      photosCount: details.photos.length,
      normalizedAspectsCount: aspectsForStorage.length,
      variants: importedVariants?.length ?? 0,
      ebayCategoryPath,
      categoryAssignment,
      resolvedCategory: finalResolvedCat?.category,
      resolvedSubcategory: finalResolvedCat?.subcategory,
      title: itemTitle?.slice(0, 50),
    });

    // Prefer photos from GetItem (full set) over the preview photos (often just 1 gallery image).
    const photos = (details.photos.length > 0 ? details.photos : listing.photos)
      .map((u) => normalizeEbayPhotoUrl(u))
      .filter((u): u is string => Boolean(u));
    const importedDescription =
      storeListingDescription(details.description) ?? storeListingDescription(listing.description);

    let createdStoreItemId: string | null = null;
    try {
      const storeItem = await prisma.storeItem.create({
        data: {
          memberId: userId,
          title: (details.title ?? listing.title).slice(0, 200),
          description: importedDescription,
          photos,
          priceCents: safePriceCents,
          quantity: importQty,
          status: importQty > 0 ? "active" : "sold_out",
          condition: details.condition ?? "used",
          listingType: "new",
          acceptOffers: details.acceptOffers,
          minOfferCents: details.minOfferCents,
          slug: uniqueSlug(slugify(listing.title)),
          category: finalResolvedCat?.category ?? ebayCategoryPath?.slice(0, 200) ?? null,
          subcategory: finalResolvedCat?.subcategory ?? null,
          ...(aspectsForStorage.length > 0 ? { aspects: aspectsForStorage as object } : {}),
          ...(importedVariants && importedVariants.length > 0
            ? { variants: importedVariants as object }
            : {}),
          ...(remoteCategoryId
            ? { ebayCategoryId: Number(remoteCategoryId) || undefined }
            : {}),
          ...(details.conditionEnum ? { ebayConditionEnum: details.conditionEnum } : {}),
        },
      });
      createdStoreItemId = storeItem.id;
      await attachEbayListingShippingOption({
        memberId: userId,
        storeItemId: storeItem.id,
        remoteProfileId: details.remoteShippingProfileId ?? listing.remoteShippingProfileId,
        listing,
      });
      const hashedItem =
        (await prisma.storeItem.findUnique({ where: { id: storeItem.id } })) ?? storeItem;

      const contentHash = syncContentHash(hashedItem);
      const metaHash = syncMetaHash({
        category: hashedItem.category,
        subcategory: hashedItem.subcategory,
        secondaryCategory: hashedItem.secondaryCategory,
        shippingCostCents: hashedItem.shippingCostCents,
        variants: hashedItem.variants,
      });

      const remoteSplitForLink = splitEbayCategoryPath(ebayCategoryPath);

      try {
        const createdLink = await prisma.channelListingLink.create({
          data: {
            storeItemId: storeItem.id,
            connectionId: ctx.id,
            provider: "ebay",
            externalListingId: sku,
            externalShopId: ctx.externalShopId,
            linkOrigin: "import",
            syncEnabled: true,
            syncStatus: "synced",
            lastPushedAt: new Date(),
            lastInboundAt: new Date(),
            lastPushedHash: contentHash,
            syncBaselineHash: contentHash,
            syncBaselineMetaHash: metaHash,
            syncBaselineVariantsHash: variantsFingerprint(hashedItem.variants),
            syncBaselineQty: hashedItem.quantity,
            syncBaselineAt: new Date(),
            remoteCategoryLabel: ebayCategoryPath?.slice(0, 500) ?? null,
            remoteCategorySubLabel: remoteSplitForLink.subcategory?.slice(0, 200) ?? null,
          },
        });
        void fetchAndCacheEbayInventoryAspects(ctx.accessToken, createdLink.id, sku).catch(() => {});
      } catch (linkErr) {
        await prisma.storeItem.delete({ where: { id: storeItem.id } }).catch(() => {});
        createdStoreItemId = null;
        if (linkErr instanceof Prisma.PrismaClientKnownRequestError && linkErr.code === "P2002") {
          await pushSkip(legacyId, "dedupe", "already_linked", {
          title: listing.title,
          photo: listingPhoto,
        });
          continue;
        }
        throw linkErr;
      }

      if (ebayCategoryPath && finalResolvedCat?.category) {
        void seedCategoryMappingFromImport({
          provider: "ebay",
          remoteCategory: ebayCategoryPath,
          remoteSubcategory: remoteSplitForLink.subcategory,
          mappedCategory: finalResolvedCat.category,
          mappedSubcategory: finalResolvedCat.subcategory,
          confidence: finalResolvedCat.score,
        });
      }
      await pushImported({
        externalListingId: legacyId,
        storeItemId: storeItem.id,
        title: listing.title,
        photo: photos[0] ?? listingPhoto,
        ...(categoryAssignment
          ? {
              categoryAssignment: {
                category: categoryAssignment.category,
                subcategory: categoryAssignment.subcategory,
                source: categoryAssignment.source,
              },
            }
          : {}),
      });
      if (!finalResolvedCat?.category) {
        uncategorizedCount++;
      }
    } catch (e) {
      if (createdStoreItemId) {
        await prisma.storeItem.delete({ where: { id: createdStoreItemId } }).catch(() => {});
      }
      const reason = describeImportError(e);
      console.error("[channels] ebay import failed", { externalListingId: legacyId, reason });
      await pushSkip(legacyId, "create", reason, {
        title: listing.title,
        photo: listingPhoto,
      });
    }
    } catch (e) {
      const reason = describeImportError(e);
      console.error("[channels] ebay import failed", { externalListingId: legacyId, reason });
      await pushSkip(legacyId, "create", reason, {
        title: listing.title,
        photo: listingPhoto,
      });
    }
  }

  const summary = buildImportSummary(imported.length, skipped);
  const topHint =
    imported.length === 0 && skipped.length > 0
      ? skipped.find((s) => s.hint)?.hint ??
        ebayErrorActionHint(skipped[0]?.reason ?? "") ??
        undefined
      : undefined;

  return NextResponse.json({
    ok: true,
    jobId: jobId ?? undefined,
    imported,
    skipped,
    summary,
    hint: topHint,
    uncategorizedCount,
  });
}
