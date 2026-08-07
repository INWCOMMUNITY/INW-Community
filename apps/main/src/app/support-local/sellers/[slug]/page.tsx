import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "database";
import { prismaWhereMemberSellerPlanAccess } from "@/lib/nwc-paid-subscription";
import { extractBusinessDisplayCity } from "@/lib/city-utils";
import { photosExcludingLogo } from "@/lib/business-photos";
import {
  SellerStorefrontContent,
  type SellerStorefrontData,
} from "@/components/seller/SellerStorefrontContent";

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
  if (!business) return { title: "Seller | Northwest Community" };
  const title = `${business.name} | Northwest Community`;
  const description =
    business.shortDescription ?? `Shop local at ${business.name} on Northwest Community.`;
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

export default async function SellerStorefrontPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const business = await prisma.business.findFirst({
    where: isCuid(slug) ? { id: slug } : { slug },
    include: {
      member: {
        select: {
          id: true,
          createdAt: true,
          sellerLocalDeliveryPolicy: true,
          sellerPickupPolicy: true,
          sellerShippingPolicy: true,
          sellerReturnPolicy: true,
          offerShipping: true,
          offerLocalDelivery: true,
          offerLocalPickup: true,
          acceptMessagesForListings: true,
        },
      },
    },
  });
  if (!business) notFound();

  const sellerSub = await prisma.subscription.findFirst({
    where: prismaWhereMemberSellerPlanAccess(business.memberId),
  });
  if (!sellerSub) notFound();

  const storeItems = await prisma.storeItem.findMany({
    where: {
      memberId: business.memberId,
      status: "active",
      quantity: { gt: 0 },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      slug: true,
      photos: true,
      category: true,
      priceCents: true,
    },
  });

  const cityLine = extractBusinessDisplayCity(business.city) ?? business.city ?? "";
  const addressDisplay = [business.address, cityLine].filter(Boolean).join(", ");
  const googleMapsUrl = addressDisplay
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressDisplay)}`
    : null;

  const hoursRaw = business.hoursOfOperation as Record<string, string> | null | undefined;
  const hoursOfOperation =
    hoursRaw && typeof hoursRaw === "object" && Object.keys(hoursRaw).length > 0 ? hoursRaw : null;

  const seller: SellerStorefrontData = {
    id: business.id,
    name: business.name,
    slug: business.slug,
    shortDescription: business.shortDescription,
    fullDescription: business.fullDescription,
    website: business.website,
    phone: business.phone,
    email: business.email,
    logoUrl: business.logoUrl,
    coverPhotoUrl: business.coverPhotoUrl,
    addressDisplay,
    googleMapsUrl,
    hoursOfOperation,
    galleryPhotos: photosExcludingLogo(business.photos ?? [], business.logoUrl),
    facebookUrl: business.facebookUrl,
    instagramUrl: business.instagramUrl,
    tiktokUrl: business.tiktokUrl,
    memberSince: business.member.createdAt.getFullYear(),
    memberUserId: business.member.id,
    acceptMessagesForListings: business.member.acceptMessagesForListings,
    offerShipping: business.member.offerShipping,
    offerLocalDelivery: business.member.offerLocalDelivery,
    offerLocalPickup: business.member.offerLocalPickup,
    sellerShippingPolicy: business.member.sellerShippingPolicy,
    sellerLocalDeliveryPolicy: business.member.sellerLocalDeliveryPolicy,
    sellerPickupPolicy: business.member.sellerPickupPolicy,
    sellerReturnPolicy: business.member.sellerReturnPolicy,
    storeItems: storeItems.map((item) => ({
      id: item.id,
      title: item.title,
      slug: item.slug,
      photos: item.photos ?? [],
      category: item.category,
      priceCents: item.priceCents,
    })),
  };

  return <SellerStorefrontContent seller={seller} />;
}
