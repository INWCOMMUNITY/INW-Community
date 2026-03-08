import type { Metadata } from "next";
import { prisma } from "database";

type Props = { params: Promise<{ slug: string }>; children: React.ReactNode };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const item = await prisma.storeItem.findFirst({
    where: { slug, status: "active" },
    select: { title: true, description: true, photos: true },
  });
  if (!item) return { title: "Item | Northwest Community" };
  const title = `${item.title} | Northwest Community`;
  const description = item.description ?? item.title;
  const imageUrl = item.photos?.[0];
  const images = imageUrl
    ? [{ url: imageUrl, width: 1200, height: 630, alt: item.title }]
    : undefined;
  return {
    title,
    description,
    openGraph: { title, description, images },
    twitter: { card: "summary_large_image", title, description, images: imageUrl ? [imageUrl] : undefined },
  };
}

export default function StorefrontItemLayout({ children }: Props) {
  return <>{children}</>;
}
