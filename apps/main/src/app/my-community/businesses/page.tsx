import { getServerSession } from "next-auth";
import { prisma } from "database";
import { authOptions } from "@/lib/auth";
import Link from "next/link";
import { UnsaveButton } from "@/components/UnsaveButton";

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
      })
    : [];

  const businessMap = new Map(businesses.map((b) => [b.id, b]));

  return (
    <>
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
        <ul className="space-y-4">
          {saved.map((s) => {
            const business = businessMap.get(s.referenceId);
            if (!business) return null;
            return (
              <li
                key={s.id}
                className="border rounded-lg p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
              >
                <div className="flex items-center gap-3">
                  {business.logoUrl && (
                    <img
                      src={business.logoUrl}
                      alt=""
                      className="w-12 h-12 object-contain rounded"
                    />
                  )}
                  <div>
                    <Link
                      href={`/support-local/${business.slug}`}
                      className="font-medium hover:underline"
                      style={{ color: "var(--color-link)" }}
                    >
                      {business.name}
                    </Link>
                    {business.city && (
                      <p className="text-sm text-gray-600">{business.city}</p>
                    )}
                  </div>
                </div>
                <UnsaveButton type="business" referenceId={business.id} />
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
