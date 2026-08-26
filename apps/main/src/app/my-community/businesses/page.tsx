import { getServerSession } from "next-auth";
import { prisma } from "database";
import { authOptions } from "@/lib/auth";
import Link from "next/link";
import { SavedBusinessHeartButton } from "@/components/SavedBusinessHeartButton";
import { BackToProfileLink } from "@/components/BackToProfileLink";

function uniqueCategories(categories: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of categories) {
    const label = raw.trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out.slice(0, 2);
}

function businessInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase() || "?";
}

function initialsAvatarColor(name: string) {
  const palette = ["#5d4f40", "#505542", "#3E432F", "#6b5c4a"];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return palette[Math.abs(hash) % palette.length];
}

export default async function MyBusinessesPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;

  const saved = await prisma.savedItem.findMany({
    where: { memberId: session.user.id, type: "business" },
    orderBy: { createdAt: "desc" },
  });

  const businessIds = saved.map((s) => s.referenceId);
  const businesses = businessIds.length
    ? await prisma.business.findMany({
        where: { id: { in: businessIds } },
        select: {
          id: true,
          name: true,
          slug: true,
          logoUrl: true,
          city: true,
          categories: true,
        },
      })
    : [];

  const businessMap = new Map(businesses.map((b) => [b.id, b]));

  return (
    <>
      <BackToProfileLink />
      <h1 className="text-2xl font-bold mb-6">My Businesses</h1>
      {saved.length === 0 ? (
        <p className="text-gray-600">
          You haven&apos;t saved any businesses yet. Browse{" "}
          <Link href="/support-local" className="hover:underline" style={{ color: "var(--color-link)" }}>
            Support Local
          </Link>{" "}
          to find businesses to save.
        </p>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
          {saved.map((s) => {
            const business = businessMap.get(s.referenceId);
            if (!business) return null;
            const categories = uniqueCategories(business.categories ?? []);
            return (
              <li key={s.id}>
                <div className="relative rounded-xl border border-gray-200 bg-white transition hover:bg-gray-50">
                  <SavedBusinessHeartButton
                    referenceId={business.id}
                    className="absolute top-1.5 right-1.5"
                  />
                  <Link
                    href={`/support-local/${business.slug}`}
                    className="flex items-start gap-3 px-4 pb-4 pt-9"
                  >
                    {business.logoUrl ? (
                      <img
                        src={business.logoUrl}
                        alt=""
                        className="w-20 h-20 object-contain rounded-lg bg-white shrink-0 ring-2 ring-[var(--color-earth)]"
                      />
                    ) : (
                      <div
                        className="w-20 h-20 rounded-lg shrink-0 flex items-center justify-center text-white font-semibold ring-2 ring-[var(--color-earth)]"
                        style={{ backgroundColor: initialsAvatarColor(business.name) }}
                      >
                        {businessInitials(business.name)}
                      </div>
                    )}
                    <div className="min-w-0 flex-1 pr-1">
                      <span className="font-semibold block leading-snug">{business.name}</span>
                      {categories.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {categories.map((cat) => (
                            <span
                              key={cat}
                              className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-[var(--color-section-alt)] text-[var(--color-primary)]"
                            >
                              {cat}
                            </span>
                          ))}
                        </div>
                      )}
                      {business.city && (
                        <p className="text-sm text-gray-600 mt-1.5">{business.city}</p>
                      )}
                    </div>
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
