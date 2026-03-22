import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { prisma } from "database";
import { authOptions } from "@/lib/auth";
import { canViewerSeeFullMemberProfile } from "@/lib/member-profile-access";

export const dynamic = "force-dynamic";

export default async function MemberFavoriteBusinessesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  const viewerId = session?.user?.id ?? null;

  const member = await prisma.member.findUnique({
    where: { id },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      privacyLevel: true,
      savedItems: {
        where: { type: "business" },
        select: { referenceId: true },
      },
    },
  });

  if (!member) notFound();

  const canSee = await canViewerSeeFullMemberProfile(viewerId, member.id, member.privacyLevel);
  if (!canSee) {
    redirect(`/members/${id}`);
  }

  const ids = member.savedItems.map((s) => s.referenceId);
  const businesses =
    ids.length > 0
      ? await prisma.business.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true, slug: true, logoUrl: true },
        })
      : [];

  return (
    <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
      <div className="max-w-2xl mx-auto">
        <div className="rounded-xl border-2 border-[var(--color-primary)] shadow-lg overflow-hidden bg-white">
          <div
            className="flex items-center gap-3 px-4 py-3 border-b-2 border-black"
            style={{ backgroundColor: "var(--color-primary)" }}
          >
            <Link
              href={`/members/${id}`}
              className="p-2 rounded text-white hover:bg-white/10 text-lg leading-none"
              aria-label="Back to profile"
            >
              ←
            </Link>
            <h1 className="flex-1 text-center text-lg font-bold text-white truncate" style={{ fontFamily: "var(--font-heading)" }}>
              {member.firstName}&apos;s favorite businesses
            </h1>
            <span className="w-10" aria-hidden />
          </div>
          <div className="p-4 md:p-6">
            {businesses.length === 0 ? (
              <p className="text-gray-600 text-sm">No saved businesses yet.</p>
            ) : (
              <ul className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {businesses.map((b) => (
                  <li key={b.id}>
                    <Link
                      href={`/support-local/${b.slug}`}
                      className="border rounded-lg p-4 hover:bg-gray-50 flex flex-col items-center text-center transition-colors"
                    >
                      {b.logoUrl ? (
                        <img src={b.logoUrl} alt="" className="w-16 h-16 object-cover rounded mb-2" />
                      ) : (
                        <div className="w-16 h-16 bg-gray-200 rounded flex items-center justify-center text-gray-500 mb-2 font-bold">
                          {b.name[0]}
                        </div>
                      )}
                      <span className="font-medium text-sm">{b.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
