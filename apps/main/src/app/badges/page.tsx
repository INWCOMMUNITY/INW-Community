import Link from "next/link";
import { prisma } from "database";

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
        <h1 className="text-3xl font-bold mb-2" style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}>
          Community Badges
        </h1>
        <p className="text-gray-600 mb-8 max-w-2xl">
          Earn badges by participating in Northwest Community. Here are all the badges you can unlock.
        </p>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {badges.map((b) => (
            <div
              key={b.id}
              className="border rounded-lg p-4 bg-gray-50 hover:bg-gray-100 transition-colors"
            >
              <div className="flex flex-col items-center gap-3 text-center">
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center text-2xl shrink-0"
                  style={{ backgroundColor: "var(--color-cream)" }}
                >
                  🏅
                </div>
                <div className="min-w-0 w-full">
                  <h2 className="font-semibold text-lg" style={{ color: "var(--color-heading)" }}>
                    {b.name}
                  </h2>
                  <span className="text-xs text-gray-500 capitalize">{b.category}</span>
                  <p className="text-gray-600 mt-2 text-sm leading-relaxed">{b.description}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {badges.length === 0 && (
          <p className="text-gray-600 text-center py-12">No badges yet. Check back soon!</p>
        )}

        <div className="mt-8">
          <Link
            href="/my-community"
            className="text-sm"
            style={{ color: "var(--color-primary)" }}
          >
            ← Back to My Community
          </Link>
        </div>
      </div>
    </section>
  );
}
