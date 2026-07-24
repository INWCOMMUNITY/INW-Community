import type { Metadata } from "next";
import { prisma } from "database";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://www.inwcommunity.com";

function isCuid(s: string): boolean {
  return /^c[a-z0-9]{24}$/.test(s);
}

type Props = {
  params: Promise<{ slug: string }>;
  children: React.ReactNode;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  
  const business = await prisma.business.findFirst({
    where: isCuid(slug) ? { id: slug } : { slug },
    select: {
      id: true,
      name: true,
      slug: true,
      shortDescription: true,
      logoUrl: true,
      members: { select: { id: true } },
    },
  });

  if (!business) {
    return { title: "Seller Not Found" };
  }

  const memberIds = business.members.map((m) => m.id);
  const activeProductCount = memberIds.length > 0
    ? await prisma.storeItem.count({
        where: {
          sellerId: { in: memberIds },
          status: "active",
          quantity: { gt: 0 },
        },
      })
    : 0;

  const hasProducts = activeProductCount > 0;
  const canonicalSlug = business.slug || business.id;
  const canonicalUrl = hasProducts
    ? `${BASE_URL}/support-local/sellers/${canonicalSlug}`
    : `${BASE_URL}/support-local/${canonicalSlug}`;

  return {
    title: `Shop ${business.name} | Northwest Community`,
    description: `Browse products from ${business.name}. ${business.shortDescription || "Shop local from the Northwest Community."}`,
    openGraph: {
      title: `Shop ${business.name}`,
      description: `Browse products from ${business.name}`,
      type: "website",
      images: business.logoUrl ? [{ url: business.logoUrl }] : undefined,
    },
    alternates: {
      canonical: canonicalUrl,
    },
  };
}

export default function SellerShopLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
