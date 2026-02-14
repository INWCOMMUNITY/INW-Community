import { NextResponse } from "next/server";
import { prisma } from "database";

export const dynamic = "force-dynamic";

const DEFAULT_CATEGORIES = [
  { name: "Local News", slug: "local-news" },
  { name: "Events", slug: "events" },
  { name: "Fitness & Health", slug: "fitness-health" },
  { name: "Food & Dining", slug: "food-dining" },
  { name: "Business", slug: "business" },
  { name: "Community", slug: "community" },
  { name: "Other", slug: "other" },
];

export async function GET() {
  const count = await prisma.blogCategory.count();
  if (count === 0) {
    for (const cat of DEFAULT_CATEGORIES) {
      await prisma.blogCategory.upsert({
        where: { slug: cat.slug },
        create: cat,
        update: {},
      });
    }
  }
  const categories = await prisma.blogCategory.findMany({
    orderBy: { name: "asc" },
  });
  return NextResponse.json(categories, {
    headers: {
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
    },
  });
}
