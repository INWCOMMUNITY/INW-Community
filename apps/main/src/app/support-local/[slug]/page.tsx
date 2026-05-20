import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { prisma } from "database";
import { BusinessDetailContent, type BusinessDetailData } from "@/components/business/BusinessDetailContent";
import { authOptions } from "@/lib/auth";
import { photosExcludingLogo } from "@/lib/business-photos";
import { extractBusinessDisplayCity } from "@/lib/city-utils";

function isCuid(s: string): boolean {
  return /^c[a-z0-9]{24}$/i.test(s);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const business = await prisma.business.findFirst({
    where: isCuid(slug) ? { id: slug } : { slug },
    select: { name: true, shortDescription: true, logoUrl: true },
  });
  if (!business) return { title: "Business | Northwest Community" };
  const title = `${business.name} | Northwest Community`;
  const description =
    business.shortDescription ?? `Support local — ${business.name} on Northwest Community.`;
  const images = business.logoUrl
    ? [{ url: business.logoUrl, width: 512, height: 512, alt: business.name }]
    : undefined;
  return {
    title,
    description,
    openGraph: { title, description, images },
    twitter: { card: "summary", title, description, images: business.logoUrl ? [business.logoUrl] : undefined },
  };
}

export default async function BusinessDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const business = await prisma.business.findFirst({
    where: isCuid(slug) ? { id: slug } : { slug },
    include: { coupons: true },
  });
  if (!business) notFound();

  const session = await getServerSession(authOptions);
  const saved = session?.user?.id
    ? await prisma.savedItem.findUnique({
        where: {
          memberId_type_referenceId: {
            memberId: session.user.id,
            type: "business",
            referenceId: business.id,
          },
        },
      })
    : null;

  const cityLine = extractBusinessDisplayCity(business.city) ?? business.city ?? "";
  const addressDisplay = [business.address, cityLine].filter(Boolean).join(", ");
  const googleMapsUrl = addressDisplay
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressDisplay)}`
    : null;

  const hoursRaw = business.hoursOfOperation as Record<string, string> | null | undefined;
  const hoursOfOperation =
    hoursRaw && typeof hoursRaw === "object" && Object.keys(hoursRaw).length > 0 ? hoursRaw : null;

  const galleryPhotos = photosExcludingLogo(business.photos ?? [], business.logoUrl);

  const detail: BusinessDetailData = {
    id: business.id,
    name: business.name,
    slug: business.slug,
    shortDescription: business.shortDescription,
    fullDescription: business.fullDescription,
    website: business.website,
    phone: business.phone,
    email: business.email,
    logoUrl: business.logoUrl,
    address: business.address,
    city: business.city,
    addressDisplay,
    googleMapsUrl,
    hoursOfOperation,
    galleryPhotos,
    coupons: business.coupons.map((c) => ({
      id: c.id,
      name: c.name,
      discount: c.discount,
    })),
  };

  return <BusinessDetailContent business={detail} initialSaved={!!saved} />;
}
