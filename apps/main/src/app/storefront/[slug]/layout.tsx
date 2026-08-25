import type { Metadata } from "next";
import {
  getCachedStoreItemPublicPayload,
  storeItemOgDescription,
  storeItemOgImage,
} from "@/lib/get-store-item-public";

type Props = { params: Promise<{ slug: string }>; children: React.ReactNode };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const item = await getCachedStoreItemPublicPayload(slug);
  if (!item) return { title: "Item | Northwest Community" };
  const title = `${item.title} | Northwest Community`;
  const description = storeItemOgDescription(item.description, item.title);
  const images = storeItemOgImage(item.photos, item.title);
  const imageUrl = images?.[0]?.url;
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
