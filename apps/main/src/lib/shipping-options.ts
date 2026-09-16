import { prisma } from "database";
import {
  isPackageComplete,
  lbsOzToTotalOz,
  totalOzToLbsOz,
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
  complete: boolean;
  archivedAt: string | null;
  listingCount: number;
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
    archivedAt: Date | null;
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
    complete: isPackageComplete(row),
    archivedAt: row.archivedAt?.toISOString() ?? null,
    listingCount: row._count?.storeItems ?? 0,
  };
}

export async function listShippingOptions(memberId: string): Promise<ShippingOptionDto[]> {
  const rows = await shippingOptions().findMany({
    where: { memberId, archivedAt: null },
    orderBy: [{ name: "asc" }],
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

export async function getShippingOptionPrefs(memberId: string) {
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: { offerFreeShippingOnInw: true },
  });
  return {
    offerFreeShippingOnInw: member?.offerFreeShippingOnInw ?? false,
  };
}

export async function updateShippingOptionPrefs(
  memberId: string,
  patch: Partial<{
    offerFreeShippingOnInw: boolean;
  }>
) {
  if (patch.offerFreeShippingOnInw !== undefined) {
    await prisma.member.update({
      where: { id: memberId },
      data: { offerFreeShippingOnInw: patch.offerFreeShippingOnInw },
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
