import { prisma } from "database";
import { getMemberConnectionContext } from "@/lib/channels/connection";
import { fetchEbayPolicyOptions } from "@/lib/channels/ebay/account";
import {
  etsyProfileDomesticShippingCostCents,
  fetchEtsyShippingProfileDestinations,
  fetchEtsyShippingProfiles,
  isEtsyCalculatedShippingProfile,
} from "@/lib/channels/shipping-map";
import {
  convertLengthToIn,
  convertWeightToOz,
  isPackageComplete,
  lbsOzToTotalOz,
  totalOzToLbsOz,
  type PackageFields,
} from "@/lib/package-weight";

function shippingOptions() {
  const delegate = prisma.shippingOption;
  if (!delegate) {
    throw new Error(
      "Database client is out of date. Stop and restart the Next.js server, then try again."
    );
  }
  return delegate;
}

export type ShippingOptionSource = "inw" | "ebay" | "etsy";

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
};

export type RemoteShippingProfile = {
  source: "ebay" | "etsy";
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
    source: string;
    remoteProfileId: string | null;
    archivedAt: Date | null;
    lastImportedAt: Date | null;
    _count?: { storeItems: number };
  }
): ShippingOptionDto {
  const { lbs, oz } = totalOzToLbsOz(row.weightOz ?? 0);
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
    source: (row.source as ShippingOptionSource) || "inw",
    remoteProfileId: row.remoteProfileId,
    complete: isPackageComplete(row),
    archivedAt: row.archivedAt?.toISOString() ?? null,
    lastImportedAt: row.lastImportedAt?.toISOString() ?? null,
    listingCount: row._count?.storeItems ?? 0,
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
    remoteProfileId: args.remoteProfileId != null && String(args.remoteProfileId) !== "" ? String(args.remoteProfileId) : null,
    weightOz: weightVal != null ? convertWeightToOz(weightVal, args.weightUnit) : null,
    lengthIn: lengthVal != null ? convertLengthToIn(lengthVal, args.dimensionUnit) : null,
    widthIn: widthVal != null ? convertLengthToIn(widthVal, args.dimensionUnit) : null,
    heightIn: heightVal != null ? convertLengthToIn(heightVal, args.dimensionUnit) : null,
    shippingCostCents: cost,
  };
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
  if (existing.source !== "inw") {
    throw new Error("Imported shipping options can only be edited on the original marketplace.");
  }
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
  const existing = await shippingOptions().findFirst({
    where: { memberId, source: incoming.source, remoteProfileId: incoming.remoteProfileId },
  });
  const merged = mergeImportedShippingOption(existing, incoming);
  const row = existing
    ? await shippingOptions().update({
        where: { id: existing.id },
        data: {
          ...merged,
          archivedAt: null,
          lastImportedAt: new Date(),
        },
      })
    : await shippingOptions().create({
        data: {
          memberId,
          source: incoming.source,
          remoteProfileId: incoming.remoteProfileId,
          ...merged,
          lastImportedAt: new Date(),
        },
      });
  if (row.shippingCostCents != null) {
    await prisma.storeItem.updateMany({
      where: { memberId, shippingOptionId: row.id, shippingCostCents: null },
      data: { shippingCostCents: row.shippingCostCents },
    });
  }
  return row;
}

export async function attachShippingOptionOnImport(args: {
  memberId: string;
  storeItemId: string;
  source: "ebay" | "etsy";
  hint: ListingPackageHint;
}): Promise<void> {
  const prefs = await prisma.memberSyncPreferences.findUnique({
    where: { memberId: args.memberId },
    select: { syncShipping: true },
  });
  if (prefs && prefs.syncShipping === false) return;
  const remoteId = args.hint.remoteProfileId?.trim();
  if (!remoteId) return;
  let option = await shippingOptions().findFirst({
    where: { memberId: args.memberId, source: args.source, remoteProfileId: remoteId },
  });
  if (!option) {
    option = await shippingOptions().create({
      data: {
        memberId: args.memberId,
        source: args.source,
        remoteProfileId: remoteId,
        name: `${args.source === "etsy" ? "Etsy" : "eBay"} shipping`,
        lengthIn: args.hint.lengthIn ?? null,
        widthIn: args.hint.widthIn ?? null,
        heightIn: args.hint.heightIn ?? null,
        weightOz: args.hint.weightOz ?? null,
        shippingCostCents: args.hint.shippingCostCents ?? null,
        lastImportedAt: new Date(),
      },
    });
  } else {
    const merged = mergeImportedShippingOption(option, {
      source: args.source,
      remoteProfileId: remoteId,
      name: option.name,
      lengthIn: args.hint.lengthIn,
      widthIn: args.hint.widthIn,
      heightIn: args.hint.heightIn,
      weightOz: args.hint.weightOz,
      shippingCostCents: args.hint.shippingCostCents,
    });
    option = await shippingOptions().update({
      where: { id: option.id },
      data: merged,
    });
  }
  const listing = await prisma.storeItem.findUnique({
    where: { id: args.storeItemId },
    select: { shippingCostCents: true },
  });
  await prisma.storeItem.update({
    where: { id: args.storeItemId },
    data: {
      shippingOptionId: option.id,
      ...(listing?.shippingCostCents == null && option.shippingCostCents != null
        ? { shippingCostCents: option.shippingCostCents }
        : {}),
    },
  });
}

export async function getShippingOptionPrefs(memberId: string) {
  const [member, prefs, connections] = await Promise.all([
    prisma.member.findUnique({
      where: { id: memberId },
      select: { offerFreeShippingOnInw: true },
    }),
    prisma.memberSyncPreferences.findUnique({
      where: { memberId },
      select: {
        syncShipping: true,
        importEbayShippingOptions: true,
        importEtsyShippingOptions: true,
      },
    }),
    prisma.channelConnection.findMany({
      where: { memberId, status: { not: "disconnected" }, provider: { in: ["ebay", "etsy"] } },
      select: { provider: true, status: true },
    }),
  ]);
  const ebayConnected = connections.some((c) => c.provider === "ebay" && c.status === "active");
  const etsyConnected = connections.some((c) => c.provider === "etsy" && c.status === "active");
  return {
    offerFreeShippingOnInw: member?.offerFreeShippingOnInw ?? false,
    importEbayShippingOptions: prefs?.importEbayShippingOptions ?? false,
    importEtsyShippingOptions: prefs?.importEtsyShippingOptions ?? false,
    syncShipping: prefs?.syncShipping ?? true,
    ebayConnected,
    etsyConnected,
  };
}

export async function updateShippingOptionPrefs(
  memberId: string,
  patch: Partial<{
    offerFreeShippingOnInw: boolean;
    importEbayShippingOptions: boolean;
    importEtsyShippingOptions: boolean;
  }>
) {
  if (patch.offerFreeShippingOnInw !== undefined) {
    await prisma.member.update({
      where: { id: memberId },
      data: { offerFreeShippingOnInw: patch.offerFreeShippingOnInw },
    });
  }
  if (patch.importEbayShippingOptions !== undefined || patch.importEtsyShippingOptions !== undefined) {
    await prisma.memberSyncPreferences.upsert({
      where: { memberId },
      update: {
        ...(patch.importEbayShippingOptions !== undefined
          ? { importEbayShippingOptions: patch.importEbayShippingOptions }
          : {}),
        ...(patch.importEtsyShippingOptions !== undefined
          ? { importEtsyShippingOptions: patch.importEtsyShippingOptions }
          : {}),
      },
      create: {
        memberId,
        ...(patch.importEbayShippingOptions !== undefined
          ? { importEbayShippingOptions: patch.importEbayShippingOptions }
          : {}),
        ...(patch.importEtsyShippingOptions !== undefined
          ? { importEtsyShippingOptions: patch.importEtsyShippingOptions }
          : {}),
      },
    });
  }
  return getShippingOptionPrefs(memberId);
}

export async function importRemoteShippingOptions(
  memberId: string,
  provider: "ebay" | "etsy"
): Promise<{ imported: number; error?: string }> {
  const prefs = await prisma.memberSyncPreferences.findUnique({
    where: { memberId },
    select: { syncShipping: true },
  });
  if (prefs && prefs.syncShipping === false) {
    return { imported: 0, error: "Shipping sync is turned off." };
  }
  const ctx = await getMemberConnectionContext(memberId, provider);
  if (!ctx) return { imported: 0, error: `Connect ${provider === "etsy" ? "Etsy" : "eBay"} first.` };

  const profiles: RemoteShippingProfile[] = [];
  if (provider === "etsy") {
    const shopId = ctx.externalShopId;
    if (!shopId) return { imported: 0, error: "Etsy shop is missing." };
    const remote = await fetchEtsyShippingProfiles(ctx.accessToken, shopId);
    for (const p of remote) {
      if (p.shipping_profile_id == null) continue;
      let shippingCostCents = etsyProfileDomesticShippingCostCents(p);
      if (
        shippingCostCents == null &&
        !isEtsyCalculatedShippingProfile(p)
      ) {
        const dests = await fetchEtsyShippingProfileDestinations(
          ctx.accessToken,
          shopId,
          p.shipping_profile_id
        );
        shippingCostCents = etsyProfileDomesticShippingCostCents({
          ...p,
          shipping_profile_destinations: dests,
        });
      }
      profiles.push({
        source: "etsy",
        remoteProfileId: String(p.shipping_profile_id),
        name: p.title?.trim() || `Etsy profile ${p.shipping_profile_id}`,
        shippingCostCents,
      });
    }
  } else {
    const options = await fetchEbayPolicyOptions(ctx.accessToken);
    for (const p of options.fulfillmentPolicies) {
      profiles.push({
        source: "ebay",
        remoteProfileId: p.id,
        name: p.name?.trim() || `eBay policy ${p.id}`,
        shippingCostCents: p.shippingCostCents ?? null,
      });
    }
  }

  for (const profile of profiles) {
    await upsertImportedShippingOption(memberId, profile);
  }
  return { imported: profiles.length };
}

export async function maybeImportShippingOptionsOnSync(
  memberId: string,
  provider: "ebay" | "etsy"
): Promise<void> {
  const prefs = await prisma.memberSyncPreferences.findUnique({
    where: { memberId },
    select: {
      syncShipping: true,
      importEbayShippingOptions: true,
      importEtsyShippingOptions: true,
    },
  });
  if (!prefs || prefs.syncShipping === false) return;
  if (provider === "ebay" && !prefs.importEbayShippingOptions) return;
  if (provider === "etsy" && !prefs.importEtsyShippingOptions) return;
  await importRemoteShippingOptions(memberId, provider).catch((e) => {
    console.warn("[shipping-options] import during sync failed", {
      memberId,
      provider,
      error: String(e),
    });
  });
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
