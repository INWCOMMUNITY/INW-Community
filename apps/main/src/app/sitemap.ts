import { MetadataRoute } from "next";
import { prisma } from "database";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://www.inwcommunity.com";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: BASE_URL,
      lastModified: now,
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${BASE_URL}/storefront`,
      lastModified: now,
      changeFrequency: "hourly",
      priority: 0.9,
    },
    {
      url: `${BASE_URL}/support-local`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/events`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.7,
    },
    {
      url: `${BASE_URL}/privacy`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.3,
    },
    {
      url: `${BASE_URL}/terms-of-service`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.3,
    },
  ];

  // Active store items
  const storeItems = await prisma.storeItem.findMany({
    where: {
      status: "active",
      quantity: { gt: 0 },
    },
    select: {
      slug: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 5000,
  });

  const itemPages: MetadataRoute.Sitemap = storeItems.map((item) => ({
    url: `${BASE_URL}/storefront/${item.slug}`,
    lastModified: item.updatedAt,
    changeFrequency: "daily" as const,
    priority: 0.7,
  }));

  // Business pages (seller shops)
  const businesses = await prisma.business.findMany({
    where: {
      status: { in: ["verified", "active", "pending"] },
    },
    select: {
      slug: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 1000,
  });

  const businessPages: MetadataRoute.Sitemap = businesses
    .filter((b) => b.slug)
    .flatMap((biz) => [
      {
        url: `${BASE_URL}/support-local/${biz.slug}`,
        lastModified: biz.updatedAt,
        changeFrequency: "weekly" as const,
        priority: 0.6,
      },
      {
        url: `${BASE_URL}/support-local/sellers/${biz.slug}`,
        lastModified: biz.updatedAt,
        changeFrequency: "daily" as const,
        priority: 0.6,
      },
    ]);

  // Events
  const events = await prisma.event.findMany({
    where: {
      endDate: { gte: now },
    },
    select: {
      slug: true,
      updatedAt: true,
    },
    orderBy: { startDate: "asc" },
    take: 500,
  });

  const eventPages: MetadataRoute.Sitemap = events
    .filter((e) => e.slug)
    .map((event) => ({
      url: `${BASE_URL}/events/${event.slug}`,
      lastModified: event.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.5,
    }));

  return [...staticPages, ...itemPages, ...businessPages, ...eventPages];
}
