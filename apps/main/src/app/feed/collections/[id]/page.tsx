import Link from "next/link";
import { notFound } from "next/navigation";
import { getListingFeedCollectionById } from "@/lib/listing-feed-collection";
import { buildProductHref } from "@/lib/product-referrer";

type PageProps = { params: Promise<{ id: string }> };

export default async function ListingFeedCollectionPage({ params }: PageProps) {
  const { id } = await params;
  const collection = await getListingFeedCollectionById(id);
  if (!collection) notFound();

  const { title, items } = collection;

  return (
    <section className="py-12 px-4" style={{ paddingTop: "calc(var(--section-padding) + 0.5in)" }}>
      <div className="max-w-3xl mx-auto">
        <Link
          href="/my-community/feed"
          className="text-sm hover:underline mb-4 inline-block"
          style={{ color: "var(--color-primary)" }}
        >
          ← Community Feed
        </Link>
        <h1
          className="text-3xl font-bold mb-2"
          style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
        >
          {title}
        </h1>
        <p className="text-sm mb-8" style={{ color: "var(--color-text)" }}>
          New listings from this share. Open any item to view or buy it.
        </p>
        {items.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--color-text)" }}>
            These listings are no longer available.
          </p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {items.map((item) => {
              const sold = item.status !== "active" || item.quantity <= 0;
              return (
                <li key={item.id}>
                  <Link
                    href={buildProductHref(item.slug, { type: "feed-collection", collectionId: id })}
                    className="flex gap-3 rounded-xl border-2 bg-white p-3 hover:bg-[var(--color-section-alt)]"
                    style={{ borderColor: "var(--color-primary)" }}
                  >
                    {item.photos[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.photos[0]}
                        alt=""
                        width={88}
                        height={88}
                        className="h-[88px] w-[88px] shrink-0 rounded-lg object-cover"
                      />
                    ) : (
                      <div
                        className="h-[88px] w-[88px] shrink-0 rounded-lg"
                        style={{ backgroundColor: "var(--color-section-alt)" }}
                      />
                    )}
                    <div className="min-w-0">
                      <h2
                        className="font-semibold leading-snug line-clamp-2"
                        style={{ color: "var(--color-heading)" }}
                      >
                        {item.title}
                      </h2>
                      <p className="text-sm mt-1" style={{ color: "var(--color-text)" }}>
                        ${(item.priceCents / 100).toFixed(2)}
                        {sold ? " · Sold" : ""}
                      </p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
