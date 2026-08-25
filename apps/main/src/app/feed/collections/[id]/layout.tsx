import type { Metadata } from "next";
import { getListingFeedCollectionById } from "@/lib/listing-feed-collection";

type LayoutProps = {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
};

export async function generateMetadata({ params }: LayoutProps): Promise<Metadata> {
  const { id } = await params;
  const collection = await getListingFeedCollectionById(id);
  return {
    title: collection?.title ?? "Collection",
    robots: { index: false, follow: false },
  };
}

export default function ListingCollectionLayout({ children }: { children: React.ReactNode }) {
  return children;
}
