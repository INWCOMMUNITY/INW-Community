import Link from "next/link";
import { prisma } from "database";
import { BadgeCard } from "@/components/BadgeCard";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Community Badges | Northwest Community",
  description: "Earn badges by participating in Northwest Community. See all badges you can unlock.",
};

export default async function CommunityBadgesPage() {
  const badges = await prisma.badge.findMany({
    orderBy: [{ order: "asc" }, { name: "asc" }],
  });

  return (
    <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
      <div className="max-w-[var(--max-width)] mx-auto">
        <h1
          className="text-3xl font-bold mb-2"
          style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
        >
          Community Badges
        </h1>
        <p className="text-gray-600 mb-8 max-w-2xl">
          Earn badges by participating in Northwest Community. Here are all the badges you can unlock.
        </p>

        {/* Badge cards */}
        <h2 className="text-xl font-bold mb-4" style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}>
          All badges
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {badges.map((b) => (
            <BadgeCard key={b.id} badge={b} />
          ))}
        </div>

        {badges.length === 0 && (
          <p className="text-gray-600 text-center py-12">No badges yet. Check back soon!</p>
        )}

        <div className="mt-10 flex flex-wrap gap-4">
          <Link
            href="/my-community"
            className="text-sm font-medium"
            style={{ color: "var(--color-primary)" }}
          >
            ← Back to My Community
          </Link>
          <Link
            href="/my-community/my-badges"
            className="text-sm font-medium"
            style={{ color: "var(--color-primary)" }}
          >
            My Badges →
          </Link>
        </div>
      </div>
    </section>
  );
}
