"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useParams } from "next/navigation";

type CollectionItem = {
  id: string;
  title: string;
  slug: string;
  photos: string[];
  priceCents: number;
  status: string;
  quantity: number;
};

export default function ListingFeedCollectionPage() {
  const params = useParams();
  const id = typeof params?.id === "string" ? params.id : "";
  const [title, setTitle] = useState("New Listings");
  const [items, setItems] = useState<CollectionItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    fetch(`/api/feed/listing-collections/${encodeURIComponent(id)}`)
      .then(async (r) => {
        const data = (await r.json().catch(() => ({}))) as {
          title?: string;
          items?: CollectionItem[];
          error?: string;
        };
        if (cancelled) return;
        if (!r.ok) {
          setError(data.error ?? "Collection not found.");
          setItems([]);
          return;
        }
        setTitle(data.title ?? "New Listings");
        setItems(Array.isArray(data.items) ? data.items : []);
      })
      .catch(() => {
        if (!cancelled) {
          setError("Could not load this collection.");
          setItems([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

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
        {items === null ? (
          <p className="text-sm" style={{ color: "var(--color-text)" }}>
            Loading…
          </p>
        ) : error ? (
          <p className="text-sm" style={{ color: "var(--color-heading)" }}>
            {error}
          </p>
        ) : items.length === 0 ? (
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
                    href={`/storefront/${item.slug}`}
                    className="flex gap-3 rounded-xl border-2 bg-white p-3 hover:bg-[var(--color-section-alt)]"
                    style={{ borderColor: "var(--color-primary)" }}
                  >
                    {item.photos[0] ? (
                      <Image
                        src={item.photos[0]}
                        alt=""
                        width={88}
                        height={88}
                        className="h-[88px] w-[88px] shrink-0 rounded-lg object-cover"
                        quality={90}
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
