import { StorefrontListingContent } from "@/components/store/StorefrontListingContent";
import { getCachedStoreItemPublicPayload } from "@/lib/get-store-item-public";
import { listingDisplayPhoto } from "@/lib/listing-display-photo";
import { prisma } from "database";

type Props = { params: Promise<{ slug: string }> };

export default async function ProductDetailPage({ params }: Props) {
  const { slug } = await params;
  const payload = await getCachedStoreItemPublicPayload(slug);
  if (payload) {
    prisma.sellerAnalyticsEvent
      .create({
        data: {
          memberId: payload.memberId,
          storeItemId: payload.id,
          eventType: "listing_view",
          provider: "inwc",
          source: "web",
        },
      })
      .catch(() => {});
  }
  const initialItem = payload ? JSON.parse(JSON.stringify(payload)) : null;
  const hero =
    payload?.photos?.[0] != null
      ? listingDisplayPhoto(payload.photos[0], "hero") ?? payload.photos[0]
      : null;
  return (
    <>
      {hero ? <link rel="preload" as="image" href={hero} fetchPriority="high" /> : null}
      <StorefrontListingContent
        initialItem={initialItem}
        initialUnavailable={Boolean(payload?.unavailable)}
      />
    </>
  );
}
