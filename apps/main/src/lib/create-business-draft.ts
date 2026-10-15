import { prisma } from "database";
import { normalizeSubcategoriesByPrimary } from "@/lib/business-categories";
import { MAX_BUSINESS_GALLERY_PHOTOS } from "@/lib/upload-limits";
import { prismaWhereMemberSponsorOrSellerPlanAccess } from "@/lib/nwc-paid-subscription";

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalUrl(value: unknown): string | null {
  const text = optionalText(value);
  if (!text) return null;
  return text.startsWith("http") ? text : `https://${text}`;
}

function businessProfileData(data: Record<string, unknown>, categories: string[]) {
  const photos = Array.isArray(data.photos)
    ? (data.photos as unknown[]).filter((url): url is string => typeof url === "string" && url.trim().length > 0).slice(0, MAX_BUSINESS_GALLERY_PHOTOS)
    : [];
  const hours =
    data.hoursOfOperation && typeof data.hoursOfOperation === "object"
      ? (data.hoursOfOperation as Record<string, string>)
      : undefined;
  return {
    name: typeof data.name === "string" ? data.name.trim() : "",
    shortDescription: optionalText(data.shortDescription),
    fullDescription: optionalText(data.fullDescription),
    website: optionalUrl(data.website),
    phone: optionalText(data.phone),
    email: optionalText(data.email),
    logoUrl: optionalText(data.logoUrl),
    coverPhotoUrl: optionalText(data.coverPhotoUrl),
    address: optionalText(data.address),
    city: typeof data.city === "string" ? data.city.trim() : "",
    categories,
    subcategoriesByPrimary: normalizeSubcategoriesByPrimary(categories, data.subcategoriesByPrimary),
    photos,
    hoursOfOperation: hours,
    facebookUrl: optionalUrl(data.facebookUrl),
    instagramUrl: optionalUrl(data.instagramUrl),
    tiktokUrl: optionalUrl(data.tiktokUrl),
  };
}

export async function createBusinessDraftInDb(
  memberId: string,
  data: Record<string, unknown>,
  planId: "subscribe" | "sponsor" | "seller"
): Promise<{ businessId: string } | undefined> {
  const name = typeof data.name === "string" ? data.name.trim() : "";
  const city = typeof data.city === "string" ? data.city.trim() : "";
  const categories = Array.isArray(data.categories)
    ? (data.categories as string[]).filter((c) => typeof c === "string" && c.trim()).slice(0, 2)
    : [];
  if (!name || !city || categories.length === 0) return undefined;

  const activeSub = await prisma.subscription.findFirst({
    where: prismaWhereMemberSponsorOrSellerPlanAccess(memberId),
  });
  if (!activeSub) {
    await prisma.business.deleteMany({ where: { memberId } });
  }

  const profile = businessProfileData(data, categories);

  // Business → Seller: reuse the existing profile and refresh it from this signup.
  if (planId === "seller") {
    const existingBusiness = await prisma.business.findFirst({
      where: { memberId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (existingBusiness) {
      await prisma.business.update({
        where: { id: existingBusiness.id },
        data: profile,
      });
      return { businessId: existingBusiness.id };
    }
  }

  const existingCount = await prisma.business.count({ where: { memberId } });
  if (existingCount >= 2) return undefined;

  let slug = slugify(name);
  let suffix = 0;
  while (await prisma.business.findUnique({ where: { slug } })) {
    slug = `${slugify(name)}-${++suffix}`;
  }

  const business = await prisma.business.create({
    data: {
      memberId,
      ...profile,
      slug,
    },
  });
  return { businessId: business.id };
}
