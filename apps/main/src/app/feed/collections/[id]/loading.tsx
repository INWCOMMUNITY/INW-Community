import Link from "next/link";

export default function ListingFeedCollectionLoading() {
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
        <p className="text-sm" style={{ color: "var(--color-text)" }}>
          Loading…
        </p>
      </div>
    </section>
  );
}
