import { prisma } from "database";
import {
  convertLengthToIn,
  convertWeightToOz,
  isPackageComplete,
  lbsOzToTotalOz,
  totalOzToLbsOz,
  type PackageFields,
} from "@/lib/package-weight";
import { fetchEtsyRemoteShippingProfiles } from "@/lib/etsy/shipping-profiles-import";
import { fetchShopifyRemoteShippingProfiles } from "@/lib/shopify/delivery-profiles";

function shippingOptions() {
  const delegate = prisma.shippingOption;
  if (!delegate) {
    throw new Error(
      "Database client is out of date. Stop and restart the Next.js server, then try again."
    );
  }
  return delegate;
}

export type ShippingOptionSource = "inw" | "etsy" | "shopify";
export type ShippingImportProvider = "etsy" | "shopify";

export type ShippingOptionDto = {
  id: string;
  name: string;
  lengthIn: number | null;
  widthIn: number | null;
  heightIn: number | null;
  weightOz: number | null;
  weightLbs: number;
  weightOzRemainder: number;
  shippingCostCents: number | null;
  source: ShippingOptionSource;
  remoteProfileId: string | null;
  complete: boolean;
  archivedAt: string | null;
  lastImportedAt: string | null;
  listingCount: number;
  /** Local INW edits are always allowed; marketplace link is informational. */
  editable: boolean;
};

export type RemoteShippingProfile = {
  source: ShippingImportProvider;
  remoteProfileId: string;
  name: string;
  lengthIn?: number | null;
  widthIn?: number | null;
  heightIn?: number | null;
  weightOz?: number | null;
  shippingCostCents?: number | null;
};

export type ListingPackageHint = {
  remoteProfileId?: string | null;
  lengthIn?: number | null;
  widthIn?: number | null;
  heightIn?: number | null;
  weightOz?: number | null;
  shippingCostCents?: number | null;
};

export type ShippingOptionMergeFields = PackageFields & {
  name: string;
  shippingCostCents?: number | null;
};

export type ImportedListingShippingPatch = {
  shippingOptionId?: string;
  shippingCostCents?: number;
};

export function parseShippingCostCentsInput(args: {
  shippingCostCents?: number | null;
  shippingCostDollars?: string | number | null;
  required?: boolean;
}): number | undefined {
  if (args.shippingCostCents != null && Number.isFinite(args.shippingCostCents)) {
    const n = Math.round(Number(args.shippingCostCents));
    if (n < 0) throw new Error("Shipping price cannot be negative");
    return n;
  }
  if (args.shippingCostDollars != null && String(args.shippingCostDollars).trim() !== "") {
    const n = Number(String(args.shippingCostDollars).replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(n) || n < 0) throw new Error("Enter a valid shipping price");
    return Math.round(n * 100);
  }
  if (args.required) throw new Error("Shipping price is required");
  return undefined;
}

export function serializeShippingOption(
  row: {
    id: string;
    name: string;
    lengthIn: number | null;
    widthIn: number | null;
    heightIn: number | null;
    weightOz: number | null;
    shippingCostCents?: number | null;
    source?: string | null;
    remoteProfileId?: string | null;
    archivedAt: Date | null;
    lastImportedAt?: Date | null;
    _count?: { storeItems: number };
  }
): ShippingOptionDto {
  const { lbs, oz } = totalOzToLbsOz(row.weightOz ?? 0);
  const source = ((row.source as ShippingOptionSource) || "inw") as ShippingOptionSource;
  const remote = row.remoteProfileId?.trim() || "";
  return {
    id: row.id,
    name: row.name,
    lengthIn: row.lengthIn,
    widthIn: row.widthIn,
    heightIn: row.heightIn,
    weightOz: row.weightOz,
    weightLbs: lbs,
    weightOzRemainder: oz,
    shippingCostCents: row.shippingCostCents ?? null,
    source,
    remoteProfileId: remote || null,
    complete: isPackageComplete(row),
    archivedAt: row.archivedAt?.toISOString() ?? null,
    lastImportedAt: row.lastImportedAt?.toISOString() ?? null,
    listingCount: row._count?.storeItems ?? 0,
    editable: true,
  };
}

export function mergeImportedShippingOption(
  existing: ShippingOptionMergeFields | null,
  incoming: RemoteShippingProfile
): {
  name: string;
  lengthIn: number | null;
  widthIn: number | null;
  heightIn: number | null;
  weightOz: number | null;
  shippingCostCents: number | null;
} {
  return {
    name: incoming.name.trim() || existing?.name || "Imported shipping",
    lengthIn: existing?.lengthIn && existing.lengthIn > 0 ? existing.lengthIn : incoming.lengthIn ?? null,
    widthIn: existing?.widthIn && existing.widthIn > 0 ? existing.widthIn : incoming.widthIn ?? null,
    heightIn: existing?.heightIn && existing.heightIn > 0 ? existing.heightIn : incoming.heightIn ?? null,
    weightOz: existing?.weightOz && existing.weightOz > 0 ? existing.weightOz : incoming.weightOz ?? null,
    shippingCostCents:
      existing?.shippingCostCents != null
        ? existing.shippingCostCents
        : incoming.shippingCostCents ?? null,
  };
}

export function listingPackageFromRemote(args: {
  remoteProfileId?: string | number | null;
  weight?: number | string | null;
  weightUnit?: string | null;
  length?: number | string | null;
  width?: number | string | null;
  height?: number | string | null;
  dimensionUnit?: string | null;
  shippingCostCents?: number | null;
}): ListingPackageHint {
  const num = (v: number | string | null | undefined) => {
    if (v == null || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const weightVal = num(args.weight);
  const lengthVal = num(args.length);
  const widthVal = num(args.width);
  const heightVal = num(args.height);
  const cost =
    args.shippingCostCents != null && Number.isFinite(args.shippingCostCents)
      ? Math.max(0, Math.round(args.shippingCostCents))
      : null;
  return {
    remoteProfileId:
      args.remoteProfileId != null && String(args.remoteProfileId) !== ""
        ? String(args.remoteProfileId)
        : null,
    weightOz: weightVal != null ? convertWeightToOz(weightVal, args.weightUnit) : null,
    lengthIn: lengthVal != null ? convertLengthToIn(lengthVal, args.dimensionUnit) : null,
    widthIn: widthVal != null ? convertLengthToIn(widthVal, args.dimensionUnit) : null,
    heightIn: heightVal != null ? convertLengthToIn(heightVal, args.dimensionUnit) : null,
    shippingCostCents: cost,
  };
}

/**
 * Choose the listing's marketplace shipping option (and its INW price) on import.
 * INW-created packages are left alone. Free-shipping-on-INW keeps the option but charges $0.
 */
export function importedListingShippingPatch(args: {
  importOptionsEnabled: boolean;
  offerFreeShippingOnInw: boolean;
  existingOptionSource?: string | null;
  matchedOption?: { id: string; shippingCostCents: number | null } | null;
}): ImportedListingShippingPatch | null {
  if (args.existingOptionSource === "inw") {
    return args.offerFreeShippingOnInw ? { shippingCostCents: 0 } : null;
  }

  const patch: ImportedListingShippingPatch = {};
  if (args.importOptionsEnabled && args.matchedOption) {
    patch.shippingOptionId = args.matchedOption.id;
    if (args.offerFreeShippingOnInw) {
      patch.shippingCostCents = 0;
    } else if (args.matchedOption.shippingCostCents != null) {
      patch.shippingCostCents = args.matchedOption.shippingCostCents;
    }
  } else if (args.offerFreeShippingOnInw) {
    patch.shippingCostCents = 0;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

export function importedListingShippingPatchAlreadyApplied(
  current: { shippingOptionId?: string | null; shippingCostCents?: number | null },
  patch: ImportedListingShippingPatch
): boolean {
  if (patch.shippingOptionId != null && current.shippingOptionId !== patch.shippingOptionId) {
    return false;
  }
  if (patch.shippingCostCents != null && current.shippingCostCents !== patch.shippingCostCents) {
    return false;
  }
  return true;
}

export async function listShippingOptions(memberId: string): Promise<ShippingOptionDto[]> {
  const rows = await shippingOptions().findMany({
    where: { memberId, archivedAt: null },
    orderBy: [{ source: "asc" }, { name: "asc" }],
    include: { _count: { select: { storeItems: true } } },
  });
  return rows.map(serializeShippingOption);
}

export async function createInwShippingOption(
  memberId: string,
  input: {
    name: string;
    lengthIn: number;
    widthIn: number;
    heightIn: number;
    weightLbs: number;
    weightOz: number;
    shippingCostCents: number;
  }
) {
  const name = input.name.trim();
  if (!name) throw new Error("Name is required");
  const weightOz = lbsOzToTotalOz(input.weightLbs, input.weightOz);
  if (weightOz <= 0) throw new Error("Weight must be greater than 0");
  if (input.lengthIn <= 0 || input.widthIn <= 0 || input.heightIn <= 0) {
    throw new Error("Height, width, and length must be greater than 0");
  }
  if (!Number.isFinite(input.shippingCostCents) || input.shippingCostCents < 0) {
    throw new Error("Shipping price is required");
  }
  const row = await shippingOptions().create({
    data: {
      memberId,
      name,
      lengthIn: input.lengthIn,
      widthIn: input.widthIn,
      heightIn: input.heightIn,
      weightOz,
      shippingCostCents: Math.round(input.shippingCostCents),
      source: "inw",
      remoteProfileId: null,
    },
    include: { _count: { select: { storeItems: true } } },
  });
  return serializeShippingOption(row);
}

export async function updateInwShippingOption(
  memberId: string,
  id: string,
  input: Partial<{
    name: string;
    lengthIn: number;
    widthIn: number;
    heightIn: number;
    weightLbs: number;
    weightOz: number;
    shippingCostCents: number;
  }>
) {
  const existing = await shippingOptions().findFirst({ where: { id, memberId } });
  if (!existing) return null;
  const data: {
    name?: string;
    lengthIn?: number;
    widthIn?: number;
    heightIn?: number;
    weightOz?: number;
    shippingCostCents?: number;
  } = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new Error("Name is required");
    data.name = name;
  }
  if (input.lengthIn !== undefined) data.lengthIn = input.lengthIn;
  if (input.widthIn !== undefined) data.widthIn = input.widthIn;
  if (input.heightIn !== undefined) data.heightIn = input.heightIn;
  if (input.weightLbs !== undefined || input.weightOz !== undefined) {
    data.weightOz = lbsOzToTotalOz(input.weightLbs ?? 0, input.weightOz ?? 0);
  }
  if (input.shippingCostCents !== undefined) {
    if (!Number.isFinite(input.shippingCostCents) || input.shippingCostCents < 0) {
      throw new Error("Enter a valid shipping price");
    }
    data.shippingCostCents = Math.round(input.shippingCostCents);
  }
  const row = await shippingOptions().update({
    where: { id },
    data,
    include: { _count: { select: { storeItems: true } } },
  });
  return serializeShippingOption(row);
}

export async function archiveShippingOption(memberId: string, id: string): Promise<boolean> {
  const existing = await shippingOptions().findFirst({ where: { id, memberId } });
  if (!existing) return false;
  await shippingOptions().update({
    where: { id },
    data: { archivedAt: new Date() },
  });
  return true;
}

export async function upsertImportedShippingOption(memberId: string, incoming: RemoteShippingProfile) {
  const remoteProfileId = String(incoming.remoteProfileId ?? "").trim();
  if (!remoteProfileId) throw new Error("remoteProfileId is required");
  const existing = await shippingOptions().findFirst({
    where: { memberId, source: incoming.source, remoteProfileId },
  });
  const merged = mergeImportedShippingOption(existing, { ...incoming, remoteProfileId });
  const row = existing
    ? await shippingOptions().update({
        where: { id: existing.id },
        data: {
          ...merged,
          archivedAt: null,
          lastImportedAt: new Date(),
        },
        include: { _count: { select: { storeItems: true } } },
      })
    : await shippingOptions().create({
        data: {
          memberId,
          source: incoming.source,
          remoteProfileId,
          ...merged,
          lastImportedAt: new Date(),
        },
        include: { _count: { select: { storeItems: true } } },
      });
  // Listing shipping prices stay on the listing. Importing a profile does not copy or clear them.
  return serializeShippingOption(row);
}

export async function importRemoteShippingOptions(
  memberId: string,
  provider: ShippingImportProvider
): Promise<{ imported: number; updated: number; options: ShippingOptionDto[]; error?: string }> {
  const fetched =
    provider === "etsy"
      ? await fetchEtsyRemoteShippingProfiles(memberId)
      : await fetchShopifyRemoteShippingProfiles(memberId);

  if (fetched.error && fetched.profiles.length === 0) {
    return { imported: 0, updated: 0, options: await listShippingOptions(memberId), error: fetched.error };
  }

  let imported = 0;
  let updated = 0;
  for (const profile of fetched.profiles) {
    const before = await shippingOptions().findFirst({
      where: {
        memberId,
        source: profile.source,
        remoteProfileId: profile.remoteProfileId,
      },
      select: { id: true },
    });
    await upsertImportedShippingOption(memberId, profile);
    if (before) updated += 1;
    else imported += 1;
  }

  return {
    imported,
    updated,
    options: await listShippingOptions(memberId),
    ...(fetched.error ? { error: fetched.error } : {}),
  };
}

export async function getShippingOptionConnectionFlags(memberId: string) {
  const [etsy, shopify] = await Promise.all([
    prisma.etsyConnection.findFirst({
      where: { memberId, status: "ACTIVE" },
      select: { id: true },
    }),
    prisma.shopifyConnection.findFirst({
      where: { memberId, status: "ACTIVE" },
      select: { id: true },
    }),
  ]);
  return {
    etsyConnected: Boolean(etsy),
    shopifyConnected: Boolean(shopify),
  };
}

export async function getShippingOptionPrefs(memberId: string) {
  const [member, connections] = await Promise.all([
    prisma.member.findUnique({
      where: { id: memberId },
      select: {
        offerFreeShippingOnInw: true,
        combineShipping: true,
        combinedShippingMaxCents: true,
        freeShippingMinimumCents: true,
      },
    }),
    getShippingOptionConnectionFlags(memberId),
  ]);
  return {
    offerFreeShippingOnInw: member?.offerFreeShippingOnInw ?? false,
    combineShipping: member?.combineShipping ?? false,
    combinedShippingMaxCents: member?.combinedShippingMaxCents ?? null,
    freeShippingMinimumCents: member?.freeShippingMinimumCents ?? null,
    ...connections,
  };
}

/**
 * Seller shipping rules live on Member only.
 * This must not read or write StoreItem shipping prices.
 */
export async function updateShippingOptionPrefs(
  memberId: string,
  patch: Partial<{
    offerFreeShippingOnInw: boolean;
    combineShipping: boolean;
    combinedShippingMaxCents: number | null;
    freeShippingMinimumCents: number | null;
  }>
) {
  const data: {
    offerFreeShippingOnInw?: boolean;
    combineShipping?: boolean;
    combinedShippingMaxCents?: number | null;
    freeShippingMinimumCents?: number | null;
  } = {};
  if (patch.offerFreeShippingOnInw !== undefined) {
    data.offerFreeShippingOnInw = patch.offerFreeShippingOnInw;
  }
  if (patch.combineShipping !== undefined) data.combineShipping = patch.combineShipping;
  if (patch.combinedShippingMaxCents !== undefined) {
    data.combinedShippingMaxCents = patch.combinedShippingMaxCents;
  }
  if (patch.freeShippingMinimumCents !== undefined && patch.offerFreeShippingOnInw !== true) {
    data.freeShippingMinimumCents = patch.freeShippingMinimumCents;
  }
  if (Object.keys(data).length > 0) {
    await prisma.member.update({
      where: { id: memberId },
      data,
    });
  }
  return getShippingOptionPrefs(memberId);
}

export const shippingOptionPackageSelect = {
  id: true,
  lengthIn: true,
  widthIn: true,
  heightIn: true,
  weightOz: true,
  shippingCostCents: true,
  source: true,
  remoteProfileId: true,
} as const;

export async function getShippingOptionCostCents(
  memberId: string,
  id: string | null | undefined
): Promise<number | null> {
  if (id == null || id === "") return null;
  const row = await shippingOptions().findFirst({
    where: { id, memberId, archivedAt: null },
    select: { shippingCostCents: true },
  });
  return row?.shippingCostCents ?? null;
}

export async function assertMemberShippingOption(
  memberId: string,
  id: string | null | undefined
): Promise<string | null> {
  if (id == null || id === "") return null;
  const row = await shippingOptions().findFirst({
    where: { id, memberId, archivedAt: null },
    select: { id: true },
  });
  if (!row) throw new Error("Shipping option not found");
  return row.id;
}
