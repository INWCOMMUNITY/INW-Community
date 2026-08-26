/**
 * Listings and shop setup that block channel sync until the seller fills in
 * missing Etsy/eBay fields (origin, category, ship-from ZIP, condition).
 */

import { prisma } from "database";
import { isEbayConditionSyncError } from "./ebay/conditions";
import { parseMissingEbayItemSpecifics } from "./ebay/errors";
import { isEtsyWhoMade, normalizeEtsyWhenMade } from "@/lib/etsy-listing-options";
import { parseStoredAspects } from "@/lib/listing-limits";
import { CHANNEL_PROVIDERS, type ChannelProvider } from "./types";
import { etsyOriginPostalCodeFromConfig } from "./shipping-map";

export type NeedsAttentionFieldType = "select" | "boolean" | "zip" | "category" | "text";

export type NeedsAttentionField = {
  key: string;
  label: string;
  type: NeedsAttentionFieldType;
  value: string | boolean | number | null;
  helpText?: string;
  options?: { value: string; label: string }[];
};

export type NeedsAttentionAction = "fill" | "ebay_condition" | "retry_only";

export type NeedsAttentionItem = {
  id: string;
  kind: "listing" | "shop";
  storeItemId: string | null;
  connectionId: string;
  title: string;
  photo: string | null;
  provider: ChannelProvider;
  summary: string;
  syncError: string | null;
  fields: NeedsAttentionField[];
  action: NeedsAttentionAction;
  canRetry: boolean;
};

const ETSY_ORIGIN_ERROR = /when_made|who_made|is_supply/i;
const ETSY_POSTAL_ERROR =
  /Postal Code is required|shipping-profiles|min\/max delivery days|INW \$0\.00/i;
const ETSY_MARKETPLACE_ERROR = /invalid_marketplace|cannot sell this item on Etsy/i;
const EBAY_VARIATION_SKU_ERROR = /variationInformation|#25002.*variation/i;

export function isEtsyOriginSyncError(error: string | null | undefined): boolean {
  return ETSY_ORIGIN_ERROR.test(error ?? "");
}

export function isEtsyPostalSyncError(error: string | null | undefined): boolean {
  return ETSY_POSTAL_ERROR.test(error ?? "");
}

export function isEtsyMarketplaceSyncError(error: string | null | undefined): boolean {
  return ETSY_MARKETPLACE_ERROR.test(error ?? "");
}

type ListingInput = {
  title: string;
  photos: string[];
  etsyWhoMade: string | null;
  etsyWhenMade: string | null;
  etsyIsSupply: boolean | null;
  etsyTaxonomyId: number | null;
  condition: string | null;
  aspects?: unknown;
};

export function classifyListingNeedsAttention(args: {
  provider: ChannelProvider;
  syncError: string | null;
  item: ListingInput;
}): { summary: string; fields: NeedsAttentionField[]; action: NeedsAttentionAction } | null {
  const { provider, syncError, item } = args;
  const fields: NeedsAttentionField[] = [];
  const reasons: string[] = [];

  if (provider === "etsy") {
    const whoMissing = !isEtsyWhoMade(item.etsyWhoMade);
    const whenMissing = normalizeEtsyWhenMade(item.etsyWhenMade) == null;
    const taxonomyMissing = item.etsyTaxonomyId == null || item.etsyTaxonomyId <= 0;
    const originError = isEtsyOriginSyncError(syncError);

    if (whoMissing || whenMissing || originError) {
      reasons.push(
        originError
          ? "Etsy needs who made it, when it was made, and whether this is a supply — all three together."
          : "Etsy needs who made this item and when it was made."
      );
      fields.push({
        key: "etsyWhoMade",
        label: "Who made it?",
        type: "select",
        value: isEtsyWhoMade(item.etsyWhoMade) ? item.etsyWhoMade : "i_did",
        options: [
          { value: "i_did", label: "I did" },
          { value: "someone_else", label: "Another company or person" },
          { value: "collective", label: "A member of my shop" },
        ],
      });
      fields.push({
        key: "etsyWhenMade",
        label: "When was it made?",
        type: "select",
        value: normalizeEtsyWhenMade(item.etsyWhenMade) ?? "1980s",
        options: [
          { value: "made_to_order", label: "Made to order" },
          { value: "2020_2026", label: "2020–2026" },
          { value: "2010_2019", label: "2010–2019" },
          { value: "2007_2009", label: "2007–2009" },
          { value: "before_2007", label: "Before 2007" },
          { value: "2000_2006", label: "2000–2006" },
          { value: "1990s", label: "1990s" },
          { value: "1980s", label: "1980s" },
          { value: "1970s", label: "1970s" },
          { value: "1960s", label: "1960s" },
          { value: "1950s", label: "1950s" },
          { value: "before_1700", label: "Before 1700" },
        ],
        helpText: "Vintage NES and similar items are usually 1980s.",
      });
      fields.push({
        key: "etsyIsSupply",
        label: "This is a craft supply or tool",
        type: "boolean",
        value: item.etsyIsSupply === true,
        helpText: "Leave off for finished goods like games, clothing, or home items.",
      });
    }

    if (taxonomyMissing || isEtsyMarketplaceSyncError(syncError)) {
      if (taxonomyMissing) {
        reasons.push("Pick an Etsy category so the listing can stay live.");
      }
      if (isEtsyMarketplaceSyncError(syncError)) {
        reasons.push(
          "Etsy will not sell this item under the current category or marketplace rules. Try a different Etsy category, or skip Etsy for this listing."
        );
      }
      if (!fields.some((f) => f.key === "etsyTaxonomyId")) {
        fields.push({
          key: "etsyTaxonomyId",
          label: "Etsy category",
          type: "category",
          value: item.etsyTaxonomyId,
          helpText: "Search Etsy categories (for example “video games”).",
        });
      }
    }
  }

  if (provider === "ebay" && isEbayConditionSyncError(syncError)) {
    return {
      summary: "eBay needs New or Used for this category before the listing can sync.",
      fields: [],
      action: "ebay_condition",
    };
  }

  if (provider === "ebay") {
    const missing = parseMissingEbayItemSpecifics(syncError ?? "");
    if (missing.length > 0) {
      const existing = parseStoredAspects(item.aspects);
      return {
        summary: `eBay needs ${missing.join(", ")} before this listing can go live.`,
        fields: missing.map((name) => ({
          key: `aspect:${name}`,
          label: name,
          type: "text" as const,
          value: existing.find((a) => a.name.toLowerCase() === name.toLowerCase())?.value ?? "",
          helpText: "Required item specific for this eBay category.",
        })),
        action: "fill",
      };
    }
  }

  if (fields.length > 0) {
    return {
      summary: reasons.join(" "),
      fields,
      action: "fill",
    };
  }

  if (provider === "ebay" && EBAY_VARIATION_SKU_ERROR.test(syncError ?? "")) {
    return {
      summary:
        "eBay treated this as a variation listing. Retry sync so INW can push generated SKUs for each variation.",
      fields: [],
      action: "retry_only",
    };
  }

  if (syncError?.trim()) {
    return {
      summary: syncError.trim(),
      fields: [],
      action: "retry_only",
    };
  }

  return null;
}

export function classifyShopNeedsAttention(args: {
  provider: ChannelProvider;
  originPostalCode: string | null;
  lastError: string | null;
  listingPostalError: boolean;
  hasEtsyListingAttention: boolean;
}): { summary: string; fields: NeedsAttentionField[] } | null {
  if (args.provider !== "etsy") return null;
  if (args.originPostalCode) return null;
  if (
    !args.listingPostalError &&
    !isEtsyPostalSyncError(args.lastError) &&
    !args.hasEtsyListingAttention
  ) {
    return null;
  }
  return {
    summary:
      "Etsy needs your US ship-from ZIP to create an INW shipping profile. Listings stay blocked until this is set.",
    fields: [
      {
        key: "etsyOriginPostalCode",
        label: "Ship-from ZIP",
        type: "zip",
        value: "",
        helpText: "The 5-digit ZIP your Etsy packages ship from.",
      },
    ],
  };
}

export async function listNeedsAttention(memberId: string): Promise<NeedsAttentionItem[]> {
  const [links, connections] = await Promise.all([
    prisma.channelListingLink.findMany({
      where: {
        syncEnabled: true,
        connection: { memberId, status: { not: "disconnected" } },
        OR: [
          { syncStatus: "error" },
          { conflictResolution: "pending" },
          {
            provider: "etsy",
            storeItem: {
              OR: [{ etsyWhoMade: null }, { etsyWhenMade: null }, { etsyTaxonomyId: null }],
            },
          },
        ],
      },
      select: {
        id: true,
        provider: true,
        storeItemId: true,
        connectionId: true,
        syncError: true,
        storeItem: {
          select: {
            title: true,
            photos: true,
            etsyWhoMade: true,
            etsyWhenMade: true,
            etsyIsSupply: true,
            etsyTaxonomyId: true,
            condition: true,
            aspects: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 40,
    }),
    prisma.channelConnection.findMany({
      where: { memberId, status: { not: "disconnected" }, provider: "etsy" },
      select: { id: true, provider: true, lastError: true, config: true, externalShopName: true },
    }),
  ]);

  const out: NeedsAttentionItem[] = [];
  let listingPostalError = false;

  for (const link of links) {
    const provider = link.provider as ChannelProvider;
    if (!CHANNEL_PROVIDERS.includes(provider)) continue;
    const item = link.storeItem;
    if (!item) continue;
    if (provider === "etsy" && isEtsyPostalSyncError(link.syncError)) {
      listingPostalError = true;
    }
    const classified = classifyListingNeedsAttention({
      provider,
      syncError: link.syncError,
      item,
    });
    if (!classified) continue;
    out.push({
      id: link.id,
      kind: "listing",
      storeItemId: link.storeItemId,
      connectionId: link.connectionId,
      title: item.title,
      photo: item.photos[0] ?? null,
      provider,
      summary: classified.summary,
      syncError: link.syncError,
      fields: classified.fields,
      action: classified.action,
      canRetry: true,
    });
  }

  for (const conn of connections) {
    const provider = conn.provider as ChannelProvider;
    const zip = etsyOriginPostalCodeFromConfig(conn.config);
    const shop = classifyShopNeedsAttention({
      provider,
      originPostalCode: zip,
      lastError: conn.lastError,
      listingPostalError,
      hasEtsyListingAttention: out.some((i) => i.kind === "listing" && i.provider === "etsy"),
    });
    if (!shop) continue;
    out.unshift({
      id: `shop:${conn.id}`,
      kind: "shop",
      storeItemId: null,
      connectionId: conn.id,
      title: conn.externalShopName ? `Etsy shop · ${conn.externalShopName}` : "Etsy shop",
      photo: null,
      provider,
      summary: shop.summary,
      syncError: conn.lastError,
      fields: shop.fields,
      action: "fill",
      canRetry: true,
    });
  }

  return out;
}

export async function countNeedsAttention(memberId: string): Promise<number> {
  const items = await listNeedsAttention(memberId);
  return items.length;
}
